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
        "geometricError": lods[-1].geometric_error * 2,
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
