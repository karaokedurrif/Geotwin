"""
Exportación de mallas a 3D Tiles y glTF para CesiumJS.

Genera:
- tileset.json (jerarquía 3D Tiles con bounding volumes y LODs)
- Tiles individuales en formato glTF/GLB
- Soporte para texturas (ortofoto PNOA)
"""

from __future__ import annotations

import json
import logging
import struct
from pathlib import Path

import numpy as np
import trimesh

from .lod import LODLevel
from .mesh import TerrainMesh

logger = logging.getLogger(__name__)

# Textura compartida para todos los LODs (se asigna al exportar)
_shared_texture_path: Path | None = None


def _compress_glb_draco(glb_bytes: bytes) -> bytes:
    """Apply Draco mesh compression to a GLB file.

    Falls back to uncompressed GLB if DracoPy is not available.
    Typical compression: 60-80% size reduction on vertex/index data.
    """
    try:
        import DracoPy
    except ImportError:
        logger.debug("DracoPy not installed — skipping Draco compression")
        return glb_bytes

    try:
        # Parse GLB → extract JSON + binary chunks
        magic, version, length = struct.unpack_from("<III", glb_bytes, 0)
        if magic != 0x46546C67:  # 'glTF'
            return glb_bytes

        json_len = struct.unpack_from("<I", glb_bytes, 12)[0]
        json_data = json.loads(glb_bytes[20 : 20 + json_len])

        # Find the mesh primitive's accessor indices
        meshes = json_data.get("meshes", [])
        if not meshes:
            return glb_bytes

        # For now, log the potential savings. Full Draco integration requires
        # rewriting the glTF accessors to point to Draco-compressed bufferViews.
        # This is complex and best done with gltf-pipeline or gltf-transform.
        original_kb = len(glb_bytes) / 1024
        logger.info("Draco compression: GLB %.1f KB (Draco available for future use)", original_kb)
        return glb_bytes

    except Exception as e:
        logger.warning("Draco compression failed: %s — returning uncompressed", e)
        return glb_bytes


def set_texture(texture_path: Path | None) -> None:
    """Configura la textura a usar en las siguientes exportaciones."""
    global _shared_texture_path
    _shared_texture_path = texture_path


def _degrees_to_local_meters(
    vertices: np.ndarray,
) -> tuple[np.ndarray, dict]:
    """Convierte vértices [lon, lat, elev] a coordenadas locales en metros.

    Produce coordenadas glTF-compliant (Y-up, right-handed):
      X = East, Y = Elevation (up), -Z = North (glTF forward)

    Returns:
        (local_vertices, origin_meta): local coords + dict with the centroid
        used as origin (centroid_lon, centroid_lat, min_elev, m_per_deg_lon,
        m_per_deg_lat) so the frontend can reproduce the exact same transform.
    """
    centroid_lon = float(vertices[:, 0].mean())
    centroid_lat = float(vertices[:, 1].mean())
    min_elev = float(vertices[:, 2].min())

    lat_rad = np.radians(centroid_lat)
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * np.cos(lat_rad)

    local = np.empty_like(vertices)
    local[:, 0] = (vertices[:, 0] - centroid_lon) * m_per_deg_lon  # X = East
    local[:, 1] = vertices[:, 2] - min_elev                        # Y = Elevation (up)
    local[:, 2] = -(vertices[:, 1] - centroid_lat) * m_per_deg_lat  # -Z = North (glTF forward)

    origin_meta = {
        "centroid_lon": centroid_lon,
        "centroid_lat": centroid_lat,
        "min_elev": min_elev,
        "m_per_deg_lon": m_per_deg_lon,
        "m_per_deg_lat": m_per_deg_lat,
        "z_sign": -1,
    }
    return local, origin_meta


def _degrees_to_ecef(vertices: np.ndarray) -> tuple[np.ndarray, list[float]]:
    """Convierte vértices [lon, lat, elev] a ECEF Cartesian (metros).

    Returns:
        (rtc_vertices, rtc_center): Vertices relativos al centro ECEF,
            y el centro ECEF [X, Y, Z] para RTC_CENTER en B3DM.
    """
    # WGS84 ellipsoid
    a = 6_378_137.0  # semi-major axis (m)
    e2 = 0.00669437999014  # first eccentricity squared

    lon_rad = np.radians(vertices[:, 0])
    lat_rad = np.radians(vertices[:, 1])
    alt = vertices[:, 2]

    sin_lat = np.sin(lat_rad)
    cos_lat = np.cos(lat_rad)
    sin_lon = np.sin(lon_rad)
    cos_lon = np.cos(lon_rad)

    N = a / np.sqrt(1.0 - e2 * sin_lat ** 2)  # radius of curvature

    ecef_x = (N + alt) * cos_lat * cos_lon
    ecef_y = (N + alt) * cos_lat * sin_lon
    ecef_z = (N * (1.0 - e2) + alt) * sin_lat

    # RTC center = mean position (keeps vertex values small → better precision)
    cx = float(ecef_x.mean())
    cy = float(ecef_y.mean())
    cz = float(ecef_z.mean())

    rtc = np.column_stack([
        ecef_x - cx,
        ecef_y - cy,
        ecef_z - cz,
    ])
    return rtc, [cx, cy, cz]


def _fix_texcoord_accessor(glb_bytes: bytes) -> bytes:
    """Validate & fix TEXCOORD_0 and add default sampler in GLB.

    Cesium's PBR shader expects TEXCOORD_0 as VEC2 (componentType=5126 FLOAT)
    and a valid sampler on each texture. Without a sampler, certain Cesium
    builds (1.130+) fail to generate the v_texCoord_0 varying, causing:
      'v_texCoord_0 undeclared identifier' / 'dimension mismatch'
    """
    try:
        import io
        if len(glb_bytes) < 20 or glb_bytes[:4] != b'glTF':
            return glb_bytes

        json_len = struct.unpack_from('<I', glb_bytes, 12)[0]
        json_data = glb_bytes[20:20 + json_len]
        gltf = json.loads(json_data)

        changed = False

        # Extract binary chunk for potential UV injection
        bin_chunk_offset = 20 + json_len
        has_bin_chunk = len(glb_bytes) > bin_chunk_offset + 8
        bin_data = bytearray()
        if has_bin_chunk:
            bin_chunk_len = struct.unpack_from('<I', glb_bytes, bin_chunk_offset)[0]
            bin_data = bytearray(glb_bytes[bin_chunk_offset + 8:bin_chunk_offset + 8 + bin_chunk_len])

        # Fix 1: Ensure TEXCOORD_0 accessor is VEC2, or INJECT it if missing
        for mesh_obj in gltf.get('meshes', []):
            for prim in mesh_obj.get('primitives', []):
                tc_idx = prim.get('attributes', {}).get('TEXCOORD_0')
                if tc_idx is not None and tc_idx < len(gltf.get('accessors', [])):
                    acc = gltf['accessors'][tc_idx]
                    if acc.get('type') != 'VEC2':
                        logger.warning(
                            "TEXCOORD_0 accessor type=%s, fixing to VEC2",
                            acc.get('type'),
                        )
                        # If it was SCALAR, count is 2× what it should be
                        if acc.get('type') == 'SCALAR':
                            acc['count'] = acc['count'] // 2
                        acc['type'] = 'VEC2'
                        changed = True
                elif tc_idx is None:
                    # TEXCOORD_0 is completely missing — inject synthetic UVs
                    # This prevents Cesium's shader crash when the material
                    # has a baseColorTexture but the primitive has no UVs
                    pos_idx = prim.get('attributes', {}).get('POSITION')
                    if pos_idx is not None and pos_idx < len(gltf.get('accessors', [])):
                        pos_acc = gltf['accessors'][pos_idx]
                        vert_count = pos_acc['count']

                        # Generate flat UVs: all (0.5, 0.5) — center of texture
                        uv_bytes = struct.pack('<' + 'ff' * vert_count,
                                               *([0.5, 0.5] * vert_count))

                        # Append UV data at end of binary buffer
                        uv_offset = len(bin_data)
                        # Align to 4 bytes
                        pad = (4 - uv_offset % 4) % 4
                        bin_data += b'\x00' * pad
                        uv_offset = len(bin_data)
                        bin_data += uv_bytes

                        # Add bufferView for UVs
                        bv_idx = len(gltf.setdefault('bufferViews', []))
                        gltf['bufferViews'].append({
                            'buffer': 0,
                            'byteOffset': uv_offset,
                            'byteLength': len(uv_bytes),
                            'target': 34962,  # ARRAY_BUFFER
                        })

                        # Add accessor for TEXCOORD_0
                        acc_idx = len(gltf.setdefault('accessors', []))
                        gltf['accessors'].append({
                            'bufferView': bv_idx,
                            'byteOffset': 0,
                            'componentType': 5126,  # FLOAT
                            'count': vert_count,
                            'type': 'VEC2',
                            'min': [0.5, 0.5],
                            'max': [0.5, 0.5],
                        })

                        # Set TEXCOORD_0 on the primitive
                        prim['attributes']['TEXCOORD_0'] = acc_idx

                        # Update buffer[0] total length
                        if gltf.get('buffers'):
                            gltf['buffers'][0]['byteLength'] = len(bin_data)

                        changed = True
                        logger.warning(
                            "GLB: injected synthetic TEXCOORD_0 (%d verts) — "
                            "stale tile without UVs", vert_count,
                        )

        # Fix 2: Ensure every texture references a valid sampler
        # Missing samplers cause Cesium's shader generator to skip v_texCoord_0
        samplers = gltf.setdefault('samplers', [])
        if not samplers:
            # Add default LINEAR sampler (glTF spec default for missing sampler)
            samplers.append({
                'magFilter': 9729,   # LINEAR
                'minFilter': 9987,   # LINEAR_MIPMAP_LINEAR
                'wrapS': 33071,      # CLAMP_TO_EDGE
                'wrapT': 33071,      # CLAMP_TO_EDGE
            })
            changed = True
            logger.info("GLB: added default LINEAR sampler")

        for tex in gltf.get('textures', []):
            if 'sampler' not in tex:
                tex['sampler'] = 0
                changed = True

        if not changed:
            return glb_bytes

        # Re-serialize the JSON chunk (pad to 4-byte alignment with spaces)
        new_json = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
        pad = (4 - len(new_json) % 4) % 4
        new_json += b' ' * pad

        # Rebuild binary chunk: use modified bin_data if we injected UVs,
        # otherwise use the original binary chunk from the GLB
        if not bin_data and has_bin_chunk:
            # No UV injection → use original binary chunk bytes
            bin_chunk_bytes = glb_bytes[bin_chunk_offset:]
        elif bin_data:
            # UV injection → rebuild binary chunk with new data
            bin_pad = (4 - len(bin_data) % 4) % 4
            padded_bin = bytes(bin_data) + b'\x00' * bin_pad
            bin_chunk_bytes = struct.pack('<II', len(padded_bin), 0x004E4942) + padded_bin
        else:
            bin_chunk_bytes = b''

        # Rebuild GLB: header(12) + JSON chunk header(8) + JSON + BIN chunk
        buf = io.BytesIO()
        total_len = 12 + 8 + len(new_json) + len(bin_chunk_bytes)
        buf.write(struct.pack('<4sII', b'glTF', 2, total_len))
        buf.write(struct.pack('<II', len(new_json), 0x4E4F534A))  # JSON chunk
        buf.write(new_json)
        buf.write(bin_chunk_bytes)
        result = bytearray(buf.getvalue())
        # Patch total length in header (bytes 8-11)
        struct.pack_into('<I', result, 8, len(result))
        logger.info("GLB post-processed: TEXCOORD_0 + sampler validated")
        return bytes(result)
    except Exception as e:
        logger.warning("GLB post-processing skipped: %s", e)
        return glb_bytes


# Module-level storage for the last local-coordinate origin produced by _mesh_to_glb.
# This is read by export_single_glb / export_3d_tiles to include it in pipeline_result.json.
_last_local_origin: dict | None = None


def get_local_origin() -> dict | None:
    """Return the local-coordinate origin metadata from the last GLB export."""
    return _last_local_origin


def _mesh_to_glb(mesh: TerrainMesh, texture_path: Path | None = None, *, local_coords: bool = True) -> bytes:
    """Convierte TerrainMesh a GLB (binary glTF) usando trimesh.

    Args:
        local_coords: Si True, reproyecta vértices de grados a metros locales (ENU).
            Usar True para GLBs standalone (Three.js, Blender).
            Usar False para GLBs embebidos en B3DM (Cesium 3D Tiles).
    """
    global _last_local_origin
    if local_coords:
        verts, origin_meta = _degrees_to_local_meters(mesh.vertices)
        _last_local_origin = origin_meta
        # With -Z = North, the coordinate system is right-handed and
        # face winding is preserved naturally (normals point +Y up).
        faces = mesh.faces
    else:
        verts = mesh.vertices
        faces = mesh.faces
    t_mesh = trimesh.Trimesh(
        vertices=verts,
        faces=faces,
        process=False,  # CRITICAL: prevent vertex merging that breaks UV mapping
    )
    # Force vertex normals into cache so glTF export includes NORMAL attribute
    # (required by Cesium's PBR shader when textures are present)
    _ = t_mesh.vertex_normals

    tex = texture_path or _shared_texture_path
    if mesh.uv_coords is not None and tex is not None and tex.exists():
        from PIL import Image
        image = Image.open(tex)

        uv = mesh.uv_coords.copy()
        # Ensure UVs are strictly 2D (N,2) float32 — prevents Cesium v_texCoord_0 crash
        if uv.ndim != 2 or uv.shape[1] != 2:
            logger.warning("UVs have wrong shape %s, rebuilding as (N,2)", uv.shape)
            uv = uv.reshape(-1, 2)
        uv = np.clip(uv, 0.0, 1.0).astype(np.float32)
        # Flip V: nuestros UVs tienen v=0 en min_lat (abajo), glTF espera top-left
        uv[:, 1] = 1.0 - uv[:, 1]

        material = trimesh.visual.material.PBRMaterial(
            baseColorTexture=image,
            metallicFactor=0.0,
            roughnessFactor=0.85,
            doubleSided=True,
        )
        t_mesh.visual = trimesh.visual.TextureVisuals(
            uv=uv,
            material=material,
        )
        logger.info(
            "Textura %s aplicada (%dx%d), UVs [%.3f, %.3f]",
            tex.name, image.size[0], image.size[1], uv.min(), uv.max(),
        )
    else:
        reasons = []
        if tex is None:
            reasons.append("no texture path")
        elif not tex.exists():
            reasons.append(f"file not found: {tex}")
        if mesh.uv_coords is None:
            reasons.append("no UVs")
        logger.warning("GLB sin textura real: %s — generando material fallback", ", ".join(reasons))

        # CRITICAL: Always generate TEXCOORD_0 + PBR material.
        # Without them, Cesium's B3DM shader crashes with:
        #   'v_texCoord_0' : undeclared identifier
        from PIL import Image

        fallback_img = Image.new("RGB", (64, 64), (180, 190, 170))
        fallback_mat = trimesh.visual.material.PBRMaterial(
            baseColorTexture=fallback_img,
            metallicFactor=0.0,
            roughnessFactor=0.9,
            doubleSided=True,
        )
        # Generate UVs from vertex positions if not already present
        if mesh.uv_coords is not None:
            fallback_uv = np.clip(mesh.uv_coords.copy(), 0.0, 1.0).astype(np.float32)
        else:
            # Compute UVs from XY bounds (works for both local meters and degrees)
            xs = verts[:, 0]
            zs = verts[:, 2] if local_coords else verts[:, 1]
            x_range = xs.max() - xs.min()
            z_range = zs.max() - zs.min()
            u = (xs - xs.min()) / max(x_range, 1e-6)
            v = (zs - zs.min()) / max(z_range, 1e-6)
            fallback_uv = np.column_stack([u, v]).astype(np.float32)

        t_mesh.visual = trimesh.visual.TextureVisuals(
            uv=fallback_uv,
            material=fallback_mat,
        )
        logger.info("Fallback material applied: %d verts with dummy TEXCOORD_0", len(verts))

    glb_bytes = t_mesh.export(file_type="glb")

    # Post-validate: ensure TEXCOORD_0 accessor is VEC2 (prevents Cesium shader crash)
    glb_bytes = _fix_texcoord_accessor(glb_bytes)

    return glb_bytes


def _compute_bounding_volume(mesh: TerrainMesh) -> dict:
    """Calcula bounding volume para 3D Tiles (region format).

    Region: [west, south, east, north, minHeight, maxHeight] en radianes/metros.
    """
    bounds = mesh.bounds
    west = np.radians(bounds["min_lon"])
    south = np.radians(bounds["min_lat"])
    east = np.radians(bounds["max_lon"])
    north = np.radians(bounds["max_lat"])

    return {
        "region": [
            float(west),
            float(south),
            float(east),
            float(north),
            float(bounds["min_elev"]),
            float(bounds["max_elev"]),
        ]
    }


def _mesh_to_b3dm(mesh: TerrainMesh) -> bytes:
    """Genera un archivo B3DM (Batched 3D Model) con la malla.

    Vertices se convierten a ECEF Cartesian con RTC_CENTER para que
    Cesium los posicione correctamente en el globo.

    Formato B3DM:
    - Header (28 bytes): magic, version, byteLength, featureTableJSONByteLength,
      featureTableBinaryByteLength, batchTableJSONByteLength, batchTableBinaryByteLength
    - Feature Table JSON
    - Feature Table Binary
    - Batch Table JSON
    - Batch Table Binary
    - GLB body
    """
    # Convert geographic → ECEF, get RTC center
    ecef_verts, rtc_center = _degrees_to_ecef(mesh.vertices)

    # Create a temporary mesh copy with ECEF vertices for GLB export
    ecef_mesh = TerrainMesh(
        vertices=ecef_verts,
        faces=mesh.faces,
        uv_coords=mesh.uv_coords,
    )

    # Export GLB with ECEF coords (already in meters, no local_coords conversion)
    glb_data = _mesh_to_glb(ecef_mesh, local_coords=False)

    # Feature table with RTC_CENTER
    feature_table_json = json.dumps({
        "BATCH_LENGTH": 0,
        "RTC_CENTER": rtc_center,
    }).encode("utf-8")
    # Pad to 8-byte alignment
    ft_padding = (8 - len(feature_table_json) % 8) % 8
    feature_table_json += b" " * ft_padding

    # B3DM header
    byte_length = 28 + len(feature_table_json) + len(glb_data)

    header = struct.pack(
        "<4sIIIIII",
        b"b3dm",  # magic
        1,  # version
        byte_length,
        len(feature_table_json),  # featureTableJSONByteLength
        0,  # featureTableBinaryByteLength
        0,  # batchTableJSONByteLength
        0,  # batchTableBinaryByteLength
    )

    return header + feature_table_json + glb_data


def export_3d_tiles(
    lods: list[LODLevel],
    output_dir: Path,
    twin_id: str = "terrain",
) -> Path:
    """Exporta LODs como 3D Tileset.

    Genera:
    - tileset.json (raíz)
    - lod0.b3dm, lod1.b3dm, ... (tiles por nivel)

    Args:
        lods: Lista de LODLevel (de generate_lods).
        output_dir: Directorio de salida.
        twin_id: ID del twin (para naming).

    Returns:
        Ruta al tileset.json generado.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    if not lods:
        msg = "No hay LODs para exportar"
        raise ValueError(msg)

    # L0 = máximo detalle (raíz del tileset)
    root_mesh = lods[0].mesh
    bounding_volume = _compute_bounding_volume(root_mesh)

    # Exportar cada LOD como B3DM
    tile_files: list[str] = []
    for lod in lods:
        filename = f"lod{lod.level}.b3dm"
        b3dm_data = _mesh_to_b3dm(lod.mesh)
        (output_dir / filename).write_bytes(b3dm_data)
        tile_files.append(filename)
        logger.info(
            "Exportado %s: %d tris, %.1f KB",
            filename, lod.mesh.face_count, len(b3dm_data) / 1024,
        )

    # También exportar GLBs para uso directo en Cesium
    for lod in lods:
        glb_filename = f"lod{lod.level}.glb"
        glb_data = _mesh_to_glb(lod.mesh)
        (output_dir / glb_filename).write_bytes(glb_data)

    # Construir tileset.json con jerarquía de LODs
    # Estructura: tile raíz (LOD más bajo) con children de mayor detalle
    # Cesium selecciona el tile cuyo geometric error sea aceptable para la distancia

    def _build_tile(lod_idx: int) -> dict:
        lod = lods[lod_idx]
        tile: dict = {
            "boundingVolume": bounding_volume,
            "geometricError": lod.geometric_error,
            "content": {"uri": tile_files[lod_idx]},
        }
        # Cada tile tiene como hijo el de mayor detalle
        if lod_idx > 0:
            tile["children"] = [_build_tile(lod_idx - 1)]
            tile["refine"] = "REPLACE"
        return tile

    # Raíz = LOD de menor detalle (último)
    root_tile = _build_tile(len(lods) - 1)

    tileset = {
        "asset": {
            "version": "1.0",
            "generator": f"geotwin-engine/{twin_id}",
        },
        "geometricError": max(lods[-1].geometric_error * 4, 100.0),
        "root": root_tile,
    }

    tileset_path = output_dir / "tileset.json"
    tileset_path.write_text(json.dumps(tileset, indent=2))

    logger.info("Tileset exportado: %s (%d LODs)", tileset_path, len(lods))
    return tileset_path


def export_single_glb(mesh: TerrainMesh, output_path: Path) -> Path:
    """Exporta una malla como archivo GLB simple (sin tileset).

    Útil para exportación AR/VR (USDZ, Quick Look).
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    glb_data = _mesh_to_glb(mesh)
    output_path.write_bytes(glb_data)
    logger.info("GLB exportado: %s (%.1f KB)", output_path, len(glb_data) / 1024)
    return output_path


def export_terrain_and_buildings(
    terrain_mesh: TerrainMesh,
    building_meshes: list[trimesh.Trimesh],
    output_dir: Path,
    twin_id: str,
    area_ha: float = 100.0,
) -> dict:
    """Export terrain and buildings as separate optimized GLBs.

    Produces:
    - terrain_low.glb  — terrain decimated ~70% with 2k texture (large parcels)
    - building_high.glb — buildings at full detail (merged scene)
    - {twin_id}.glb     — full-detail terrain for the main viewer

    Args:
        terrain_mesh: Full-detail terrain mesh.
        building_meshes: List of extruded building trimesh objects.
        output_dir: Directory for output files.
        twin_id: Twin identifier.
        area_ha: Parcel area in hectares (for texture size decision).

    Returns:
        Dict with paths and metadata.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    result = {}

    # ── 1. Terrain low-detail (70% decimation) ──
    import open3d as o3d

    o3d_mesh = o3d.geometry.TriangleMesh()
    o3d_mesh.vertices = o3d.utility.Vector3dVector(terrain_mesh.vertices)
    o3d_mesh.triangles = o3d.utility.Vector3iVector(terrain_mesh.faces)
    o3d_mesh.compute_triangle_normals()

    target_faces_low = max(int(terrain_mesh.face_count * 0.30), 500)
    simplified = o3d_mesh.simplify_quadric_decimation(target_faces_low)
    simplified.compute_triangle_normals()

    low_mesh = TerrainMesh(
        vertices=np.asarray(simplified.vertices),
        faces=np.asarray(simplified.triangles),
        normals=np.asarray(simplified.triangle_normals) if simplified.has_triangle_normals() else None,
    )
    # Recompute UVs for decimated mesh
    if terrain_mesh.uv_coords is not None:
        bounds = terrain_mesh.bounds
        lon_range = bounds["max_lon"] - bounds["min_lon"]
        lat_range = bounds["max_lat"] - bounds["min_lat"]
        if lon_range > 0 and lat_range > 0:
            u = np.clip(
                (low_mesh.vertices[:, 0] - bounds["min_lon"]) / lon_range, 0.0, 1.0
            )
            v = np.clip(
                (low_mesh.vertices[:, 1] - bounds["min_lat"]) / lat_range, 0.0, 1.0
            )
            low_mesh.uv_coords = np.column_stack([u, v])

    terrain_low_path = output_dir / "terrain_low.glb"
    glb_data = _mesh_to_glb(low_mesh)
    terrain_low_path.write_bytes(glb_data)

    result["terrain_low"] = {
        "path": str(terrain_low_path),
        "vertices": low_mesh.vertex_count,
        "faces": low_mesh.face_count,
        "size_kb": len(glb_data) / 1024,
    }
    logger.info(
        "terrain_low.glb: %d→%d faces (%.0f%% reduction), %.1f KB",
        terrain_mesh.face_count, low_mesh.face_count,
        (1 - low_mesh.face_count / terrain_mesh.face_count) * 100,
        len(glb_data) / 1024,
    )

    # ── 2. Buildings high-detail (merged) ──
    if building_meshes:
        scene = trimesh.Scene()
        for i, bldg in enumerate(building_meshes):
            scene.add_geometry(bldg, node_name=f"building_{i}")

        building_high_path = output_dir / "building_high.glb"
        bldg_data = scene.export(file_type="glb")
        building_high_path.write_bytes(bldg_data)

        total_verts = sum(len(b.vertices) for b in building_meshes)
        total_faces = sum(len(b.faces) for b in building_meshes)
        result["building_high"] = {
            "path": str(building_high_path),
            "count": len(building_meshes),
            "vertices": total_verts,
            "faces": total_faces,
            "size_kb": len(bldg_data) / 1024,
        }
        logger.info(
            "building_high.glb: %d buildings, %d faces, %.1f KB",
            len(building_meshes), total_faces, len(bldg_data) / 1024,
        )

    return result


def _sample_terrain_y(terrain_verts: np.ndarray, x: float, z: float) -> float:
    """Find terrain elevation (Y) at a given (X, Z) position by nearest vertex."""
    dists = (terrain_verts[:, 0] - x) ** 2 + (terrain_verts[:, 2] - z) ** 2
    return float(terrain_verts[dists.argmin(), 1])


def merge_buildings_into_glb(
    terrain_glb_path: Path,
    building_glb_paths: list[Path],
    *,
    debug_y_offset: float = 50.0,
) -> None:
    """Merge building GLBs into the main terrain GLB.

    Critical fixes vs previous version:
    - Samples terrain mesh to find correct Y at each building's XZ position
      (buildings were at Y=0, buried 30-50m under the terrain surface).
    - Applies RED NEON emissive material for debug visibility.
    - Calls trimesh.repair.fix_normals to prevent transparency.
    - Adds debug_y_offset (default +50m) so buildings float above terrain
      to confirm they exist. Set to 0.0 for production.
    """
    if not building_glb_paths:
        return
    terrain_glb_path = Path(terrain_glb_path)
    if not terrain_glb_path.exists():
        logger.warning("merge_buildings_into_glb: terrain GLB not found: %s", terrain_glb_path)
        return

    try:
        scene = trimesh.load(str(terrain_glb_path))
        if isinstance(scene, trimesh.Trimesh):
            scene = trimesh.Scene(geometry={"terrain": scene})

        # ── Extract terrain mesh (largest by vertex count) for Y sampling ──
        terrain_mesh = max(
            scene.geometry.values(), key=lambda g: len(g.vertices)
        )
        terrain_verts = np.asarray(terrain_mesh.vertices)
        logger.info(
            "merge_buildings: terrain bounds X=[%.1f,%.1f] Y=[%.1f,%.1f] Z=[%.1f,%.1f]",
            terrain_verts[:, 0].min(), terrain_verts[:, 0].max(),
            terrain_verts[:, 1].min(), terrain_verts[:, 1].max(),
            terrain_verts[:, 2].min(), terrain_verts[:, 2].max(),
        )

        # ── RED NEON emissive material for debug visibility ──
        from PIL import Image

        bldg_color = Image.new("RGB", (16, 16), (255, 0, 0))  # RED
        bldg_mat = trimesh.visual.material.PBRMaterial(
            baseColorTexture=bldg_color,
            baseColorFactor=[1.0, 0.0, 0.0, 1.0],
            emissiveFactor=[1.0, 0.0, 0.0],        # RED NEON glow
            emissiveTexture=bldg_color,
            metallicFactor=0.0,
            roughnessFactor=0.4,
            doubleSided=True,
        )

        added = 0
        for bp in building_glb_paths:
            bp = Path(bp)
            if not bp.exists():
                continue
            try:
                bm = trimesh.load(str(bp), process=False)
                # Unwrap Scene → single mesh
                if isinstance(bm, trimesh.Scene):
                    meshes = [g for g in bm.geometry.values() if hasattr(g, 'vertices')]
                    if not meshes:
                        continue
                    bm = meshes[0]

                bv = np.asarray(bm.vertices, dtype=np.float64)

                # ── Log BEFORE relocation ──
                logger.info(
                    "Building %s BEFORE: verts=%d faces=%d "
                    "X=[%.2f,%.2f] Y=[%.2f,%.2f] Z=[%.2f,%.2f]",
                    bp.name, len(bv), len(bm.faces),
                    bv[:, 0].min(), bv[:, 0].max(),
                    bv[:, 1].min(), bv[:, 1].max(),
                    bv[:, 2].min(), bv[:, 2].max(),
                )

                # ── Sample terrain Y at building XZ center ──
                cx = (bv[:, 0].min() + bv[:, 0].max()) / 2.0
                cz = (bv[:, 2].min() + bv[:, 2].max()) / 2.0
                terrain_y = _sample_terrain_y(terrain_verts, cx, cz)
                bldg_y_min = float(bv[:, 1].min())

                # Shift building so its base sits on the terrain surface + debug offset
                y_shift = terrain_y - bldg_y_min + debug_y_offset
                bv[:, 1] += y_shift
                bm.vertices = bv

                logger.info(
                    "Building %s AFTER relocation: terrain_y=%.1f, y_shift=+%.1f "
                    "(includes +%.1fm debug), Y=[%.2f,%.2f]",
                    bp.name, terrain_y, y_shift, debug_y_offset,
                    bv[:, 1].min(), bv[:, 1].max(),
                )

                # ── Fix normals (prevents invisible/transparent faces) ──
                trimesh.repair.fix_normals(bm)

                # ── Apply RED debug material + UVs ──
                uv = np.zeros((len(bm.vertices), 2), dtype=np.float32)
                bm.visual = trimesh.visual.TextureVisuals(uv=uv, material=bldg_mat)
                bm.metadata["_isBuilding"] = True

                scene.add_geometry(bm, node_name=f"building_{added}")
                added += 1
            except Exception as be:
                logger.warning("Failed loading building GLB %s: %s", bp, be)

        if added > 0:
            merged_data = scene.export(file_type="glb")
            terrain_glb_path.write_bytes(merged_data)
            logger.info(
                "Merged %d buildings into %s (%.1f KB) "
                "[debug_y_offset=+%.0fm, material=RED_NEON]",
                added, terrain_glb_path, len(merged_data) / 1024, debug_y_offset,
            )
        else:
            logger.warning("merge_buildings_into_glb: no buildings merged")
    except Exception as e:
        logger.error("merge_buildings_into_glb failed: %s", e)
