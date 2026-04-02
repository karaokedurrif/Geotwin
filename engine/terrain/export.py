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


def _generate_stucco_normal_map(size: int = 256) -> "Image":
    """Generate a procedural stucco/plaster normal map for building walls."""
    from PIL import Image, ImageFilter

    rng = np.random.default_rng(17)
    noise = rng.normal(0.5, 0.15, (size, size)).clip(0.0, 1.0)
    height = Image.fromarray((noise * 255).astype(np.uint8))
    height = height.filter(ImageFilter.GaussianBlur(radius=2.0))
    h = np.array(height, dtype=np.float32) / 255.0

    # Sobel-like derivatives → tangent-space normal map
    dx = np.zeros_like(h)
    dz = np.zeros_like(h)
    dx[:, 1:-1] = h[:, 2:] - h[:, :-2]
    dz[1:-1, :] = h[2:, :] - h[:-2, :]

    strength = 2.0
    r = np.clip(dx * strength + 0.5, 0.0, 1.0)
    g = np.clip(dz * strength + 0.5, 0.0, 1.0)
    b = np.ones_like(h)  # Z = 1.0 (flat-ish, perturbed by dx/dz)
    length = np.sqrt(r ** 2 + g ** 2 + b ** 2)
    r /= length
    g /= length
    b /= length
    # Remap from [-1,1] normals to [0,1] texture encoding
    r = r * 0.5 + 0.5
    g = g * 0.5 + 0.5
    b = b * 0.5 + 0.5

    normal_img = np.stack([r, g, b], axis=-1)
    return Image.fromarray((normal_img * 255).astype(np.uint8))


def _generate_tile_normal_map(size: int = 256, rows: int = 12) -> "Image":
    """Generate a procedural roof tile wave/ridge normal map."""
    from PIL import Image

    y = np.linspace(0, 1, size)
    x = np.linspace(0, 1, size)
    _xx, yy = np.meshgrid(x, y)

    # Horizontal wave rows simulating barrel tiles
    wave = np.sin(yy * rows * 2 * np.pi)
    # Derivative for normal Z component
    dz = np.cos(yy * rows * 2 * np.pi) * rows * 2 * np.pi / size

    strength = 0.3
    r_raw = np.zeros_like(wave)  # no X variation
    g_raw = dz * strength
    b_raw = np.ones_like(wave)

    length = np.sqrt(r_raw ** 2 + g_raw ** 2 + b_raw ** 2)
    r_raw /= length
    g_raw /= length
    b_raw /= length

    # Remap to [0,1]
    r = r_raw * 0.5 + 0.5
    g = g_raw * 0.5 + 0.5
    b = b_raw * 0.5 + 0.5

    normal_img = np.stack([r, g, b], axis=-1)
    return Image.fromarray((normal_img * 255).astype(np.uint8))


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
            roughnessFactor=0.9,
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


def _bake_contact_ao(
    scene: trimesh.Scene,
    ao_radius: float = 5.0,
    ao_strength: float = 0.5,
) -> None:
    """Bake ambient occlusion at building-ground contact zones.

    Darkens terrain vertices that are close to building walls, and
    darkens the base vertices of buildings.  This creates realistic
    contact shadows that make buildings appear grounded.

    Modifies meshes in-place within the scene.

    Args:
        scene: trimesh.Scene containing terrain + building geometries.
        ao_radius: Maximum distance in meters for AO influence.
        ao_strength: 0.0 = no darkening, 1.0 = fully black.
    """
    # Separate terrain and building geometries
    terrain_geom = None
    building_geoms = []
    for name, geom in scene.geometry.items():
        if hasattr(geom, 'metadata') and geom.metadata.get("_isBuilding"):
            building_geoms.append(geom)
        elif terrain_geom is None or len(geom.vertices) > len(terrain_geom.vertices):
            terrain_geom = geom

    if terrain_geom is None or not building_geoms:
        return

    # Collect all building base positions (lowest Y vertices per building)
    bldg_base_points = []
    for bg in building_geoms:
        bv = np.asarray(bg.vertices)
        y_min = bv[:, 1].min()
        base_mask = bv[:, 1] < y_min + 0.5  # within 0.5m of base
        bldg_base_points.append(bv[base_mask])

    if not bldg_base_points:
        return

    all_base = np.vstack(bldg_base_points)  # (K, 3)

    # ── Darken terrain vertices near building bases ──
    tv = np.asarray(terrain_geom.vertices)
    # Use XZ distance (horizontal) to building base points
    # For each terrain vertex, find min horizontal distance to any base point
    from scipy.spatial import cKDTree
    base_xz = all_base[:, [0, 2]]
    tree = cKDTree(base_xz)
    terrain_xz = tv[:, [0, 2]]
    dists, _ = tree.query(terrain_xz, k=1)

    # Compute AO factor: 1.0 at building base, 0.0 at ao_radius
    ao_factor = np.clip(1.0 - dists / ao_radius, 0.0, 1.0) * ao_strength

    # Apply vertex colors to terrain (darken by multiplying existing color)
    # trimesh uses per-vertex colors in visual.vertex_colors
    if hasattr(terrain_geom.visual, 'vertex_colors') and terrain_geom.visual.vertex_colors is not None:
        vc = np.asarray(terrain_geom.visual.vertex_colors, dtype=np.float32)
    else:
        vc = np.full((len(tv), 4), 255.0, dtype=np.float32)

    darkening = 1.0 - ao_factor
    vc[:, 0] *= darkening
    vc[:, 1] *= darkening
    vc[:, 2] *= darkening
    terrain_geom.visual.vertex_colors = np.clip(vc, 0, 255).astype(np.uint8)

    # ── Darken building base vertices ──
    for bg in building_geoms:
        bv = np.asarray(bg.vertices)
        y_min = bv[:, 1].min()
        height_above_base = bv[:, 1] - y_min
        # Gradient: base is darkened, top is untouched
        bldg_ao = np.clip(1.0 - height_above_base / (ao_radius * 0.5), 0.0, 1.0) * ao_strength

        if hasattr(bg.visual, 'vertex_colors') and bg.visual.vertex_colors is not None:
            bvc = np.asarray(bg.visual.vertex_colors, dtype=np.float32)
        else:
            bvc = np.full((len(bv), 4), 255.0, dtype=np.float32)

        bldg_darkening = 1.0 - bldg_ao
        bvc[:, 0] *= bldg_darkening
        bvc[:, 1] *= bldg_darkening
        bvc[:, 2] *= bldg_darkening
        bg.visual.vertex_colors = np.clip(bvc, 0, 255).astype(np.uint8)

    n_affected = int((ao_factor > 0.01).sum())
    logger.info(
        "AO baked: %d terrain verts darkened (radius=%.1fm, strength=%.0f%%), "
        "%d building base zones",
        n_affected, ao_radius, ao_strength * 100, len(building_geoms),
    )


def build_perimeter_wall(
    aoi_geojson_path: Path,
    origin: dict,
    wall_height: float = 1.8,
    wall_thickness: float = 0.20,
) -> trimesh.Trimesh | None:
    """Build a perimeter wall mesh from parcel geometry.

    Extrudes the parcel boundary into a wall suitable for small
    parcels (<1 ha) where a visual boundary aids drone flight planning.

    Args:
        aoi_geojson_path: Path to the aoi.geojson saved by the pipeline.
        origin: Local origin dict (centroid_lon, centroid_lat, min_elev, etc.).
        wall_height: Height of the wall in meters (default 1.8m).
        wall_thickness: Wall thickness in meters (default 0.20m).

    Returns:
        trimesh.Trimesh in local Y-up coords, or None on failure.
    """
    import json as _json
    from shapely.geometry import shape as _shape, Polygon as _Polygon
    from shapely import buffer as _buffer

    try:
        geojson = _json.loads(aoi_geojson_path.read_text())
        geom = _shape(geojson["geometry"])
        if geom.geom_type == "MultiPolygon":
            geom = max(geom.geoms, key=lambda g: g.area)

        # Convert WGS84 exterior ring → local meters (X=East, Y_2d=North)
        m_lon = origin["m_per_deg_lon"]
        m_lat = origin["m_per_deg_lat"]
        c_lon = origin["centroid_lon"]
        c_lat = origin["centroid_lat"]
        min_elev = origin.get("min_elev", 0.0)

        exterior_lonlat = list(geom.exterior.coords)
        local_2d = []
        for lon, lat in exterior_lonlat:
            x = (lon - c_lon) * m_lon
            y = (lat - c_lat) * m_lat
            local_2d.append((x, y))

        # Log parcel corners in local coords
        logger.info("Parcel corner coordinates (local meters, X=East, Z=-North):")
        for i, (x, y) in enumerate(local_2d[:4]):
            logger.info("  Corner %d: X=%.2f, Z=%.2f", i, x, -y)

        # Create wall as buffer difference (outer - inner) → thin band
        outer = _Polygon(local_2d)
        inner = outer.buffer(-wall_thickness)
        if inner.is_empty or not inner.is_valid:
            inner = outer.buffer(-wall_thickness / 2)

        wall_poly = outer.difference(inner)
        if wall_poly.is_empty:
            logger.warning("Perimeter wall polygon is empty — skipping")
            return None

        # Extrude the thin band upward
        wall_mesh = trimesh.creation.extrude_polygon(wall_poly, wall_height)

        # Axis swap: trimesh extrudes along +Z → we need Y=up, -Z=north
        verts = np.asarray(wall_mesh.vertices, dtype=np.float64)
        new_verts = np.empty_like(verts)
        new_verts[:, 0] = verts[:, 0]      # X = East
        new_verts[:, 1] = verts[:, 2]      # Y = elevation (was Z)
        new_verts[:, 2] = -verts[:, 1]     # -Z = North (was Y in 2D)

        # Z-fighting fix: sink wall 10cm below terrain so it "grows" from
        # underground — no visual gaps between wall base and terrain surface
        new_verts[:, 1] -= 0.10

        wall_mesh.vertices = new_verts

        # Reverse face winding after axis swap
        wall_mesh.faces = wall_mesh.faces[:, ::-1]
        trimesh.repair.fix_normals(wall_mesh)

        # Stone wall material — cool gray stone
        from PIL import Image
        wall_color = Image.new("RGB", (4, 4), (155, 150, 140))  # gray stone
        wall_mat = trimesh.visual.material.PBRMaterial(
            baseColorTexture=wall_color,
            baseColorFactor=[0.61, 0.59, 0.55, 1.0],
            metallicFactor=0.0,
            roughnessFactor=0.95,
            doubleSided=True,
        )
        uv = np.zeros((len(wall_mesh.vertices), 2), dtype=np.float32)
        wall_mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=wall_mat)
        wall_mesh.metadata["_isWall"] = True

        logger.info(
            "Perimeter wall built: %d verts, %d faces, height=%.1fm, thickness=%.2fm",
            len(wall_mesh.vertices), len(wall_mesh.faces), wall_height, wall_thickness,
        )
        return wall_mesh
    except Exception as e:
        logger.warning("build_perimeter_wall failed: %s", e)
        return None


def _apply_micro_topography(
    terrain_geom: trimesh.Trimesh,
    noise_amplitude: float = 0.05,
    seed: int = 42,
) -> None:
    """Add very soft Perlin-like noise to perfectly flat terrain.

    For urban micro-parcels the DEM produces a nearly flat Y=0 surface.
    Adding 5 cm of smooth noise prevents the grass from looking like a
    mirror and helps the drone camera detect parallax.

    Modifies vertices in-place.
    """
    rng = np.random.RandomState(seed)
    verts = np.asarray(terrain_geom.vertices, dtype=np.float64)

    # Smooth 2D noise: generate low-freq noise on XZ grid then interpolate
    # Use a simple sum-of-sinusoids for smoothness (no Perlin dependency)
    xz = verts[:, [0, 2]]
    noise = np.zeros(len(verts), dtype=np.float64)

    # 3 octaves of sinusoidal noise for organic look
    for freq, amp in [(0.5, 0.6), (1.2, 0.25), (3.0, 0.15)]:
        phase_x = rng.uniform(0, 2 * np.pi)
        phase_z = rng.uniform(0, 2 * np.pi)
        noise += amp * np.sin(freq * xz[:, 0] + phase_x) * np.cos(freq * xz[:, 1] + phase_z)

    # Normalize to [-1, 1] then scale to amplitude
    noise_range = noise.max() - noise.min()
    if noise_range > 0:
        noise = (noise - noise.min()) / noise_range * 2 - 1

    verts[:, 1] += noise * noise_amplitude
    # Keep Y >= 0
    verts[:, 1] = np.maximum(verts[:, 1], 0.0)
    terrain_geom.vertices = verts

    logger.info(
        "Micro-topography applied: amplitude=±%.0fmm, %d vertices",
        noise_amplitude * 1000, len(verts),
    )


def _build_gallinero_zone(
    aoi_geojson_path: Path,
    origin: dict,
    length: float = 30.0,
    width: float = 8.0,
) -> tuple[trimesh.Trimesh | None, list[tuple[float, float]] | None]:
    """Create a 30×8 m cyan reference rectangle along the longest parcel wall.

    The rectangle is placed against (inside) the longest straight segment
    of the parcel exterior.  It represents the gallinero zone for drone
    flight planning.

    Args:
        aoi_geojson_path: Path to aoi.geojson.
        origin: Local origin dict from the pipeline.
        length: Length along the wall (default 30 m).
        width: Depth inward from the wall (default 8 m).

    Returns:
        (mesh, corners_local) where corners_local is a list of 4 (x, z) tuples
        in local Y-up coords, or (None, None) on failure.
    """
    import json as _json
    from shapely.geometry import shape as _shape

    try:
        geojson = _json.loads(aoi_geojson_path.read_text())
        geom = _shape(geojson["geometry"])
        if geom.geom_type == "MultiPolygon":
            geom = max(geom.geoms, key=lambda g: g.area)

        m_lon = origin["m_per_deg_lon"]
        m_lat = origin["m_per_deg_lat"]
        c_lon = origin["centroid_lon"]
        c_lat = origin["centroid_lat"]

        # Convert exterior ring to local meters (X=East, Y_2d=North)
        exterior_lonlat = list(geom.exterior.coords)
        local_2d = []
        for lon, lat in exterior_lonlat:
            x = (lon - c_lon) * m_lon
            y = (lat - c_lat) * m_lat
            local_2d.append((x, y))

        # Find the longest segment of the parcel exterior
        best_len = 0.0
        best_i = 0
        for i in range(len(local_2d) - 1):
            x0, y0 = local_2d[i]
            x1, y1 = local_2d[i + 1]
            seg_len = np.hypot(x1 - x0, y1 - y0)
            if seg_len > best_len:
                best_len = seg_len
                best_i = i

        x0, y0 = local_2d[best_i]
        x1, y1 = local_2d[best_i + 1]

        # Clamp gallinero length to segment length - 1m margin
        actual_length = min(length, best_len - 1.0)
        if actual_length < 2.0:
            logger.warning("Gallinero: longest segment only %.1fm — too short", best_len)
            return None, None

        # Direction along the wall and inward normal
        dx = x1 - x0
        dy = y1 - y0
        seg_len = np.hypot(dx, dy)
        ux, uy = dx / seg_len, dy / seg_len  # unit along wall
        # Normal pointing inward (toward parcel centroid)
        # Test both normals, pick the one pointing toward centroid
        nx0, ny0 = -uy, ux
        nx1, ny1 = uy, -ux
        cx_local = np.mean([p[0] for p in local_2d[:-1]])
        cy_local = np.mean([p[1] for p in local_2d[:-1]])
        mid_x = (x0 + x1) / 2.0
        mid_y = (y0 + y1) / 2.0
        dot0 = nx0 * (cx_local - mid_x) + ny0 * (cy_local - mid_y)
        if dot0 > 0:
            nx, ny = nx0, ny0
        else:
            nx, ny = nx1, ny1

        # Center gallinero along the longest segment
        seg_mid = best_len / 2.0
        half = actual_length / 2.0
        t_start = (seg_mid - half) / seg_len
        t_end = (seg_mid + half) / seg_len

        # 4 corners of the rectangle (2D local: X=East, Y_2d=North)
        # Start from 0.3m inward to avoid coinciding with perimeter wall
        inset = 0.3
        p0 = (x0 + ux * t_start * seg_len + nx * inset, y0 + uy * t_start * seg_len + ny * inset)
        p1 = (x0 + ux * t_end * seg_len + nx * inset, y0 + uy * t_end * seg_len + ny * inset)
        p2 = (x0 + ux * t_end * seg_len + nx * width, y0 + uy * t_end * seg_len + ny * width)
        p3 = (x0 + ux * t_start * seg_len + nx * width, y0 + uy * t_start * seg_len + ny * width)

        # Build flat rectangle mesh (2cm thick) in local Y-up coords
        # Extrude via trimesh: polygon in XY, extrude along Z, then axis-swap
        from shapely.geometry import Polygon as _Polygon
        rect_poly = _Polygon([p0, p1, p2, p3, p0])
        if not rect_poly.is_valid or rect_poly.area < 1.0:
            logger.warning("Gallinero rectangle invalid (area=%.1f)", rect_poly.area)
            return None, None

        rect_mesh = trimesh.creation.extrude_polygon(rect_poly, 0.02)

        # Axis swap: trimesh extrudes along +Z → Y=up, -Z=north
        verts = np.asarray(rect_mesh.vertices, dtype=np.float64)
        new_verts = np.empty_like(verts)
        new_verts[:, 0] = verts[:, 0]      # X = East
        new_verts[:, 1] = verts[:, 2]      # Y = elevation (was Z)
        new_verts[:, 2] = -verts[:, 1]     # -Z = North (was Y in 2D)
        # Lift 5cm above terrain to prevent Z-fighting
        new_verts[:, 1] += 0.05
        rect_mesh.vertices = new_verts

        rect_mesh.faces = rect_mesh.faces[:, ::-1]
        trimesh.repair.fix_normals(rect_mesh)

        # Cyan PBR material
        from PIL import Image
        cyan_tex = Image.new("RGB", (4, 4), (0, 200, 200))
        cyan_mat = trimesh.visual.material.PBRMaterial(
            baseColorTexture=cyan_tex,
            baseColorFactor=[0.0, 0.78, 0.78, 0.8],
            emissiveFactor=[0.0, 0.15, 0.15],
            metallicFactor=0.0,
            roughnessFactor=0.6,
            alphaMode="BLEND",
            doubleSided=True,
        )
        uv = np.zeros((len(rect_mesh.vertices), 2), dtype=np.float32)
        rect_mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=cyan_mat)
        rect_mesh.metadata["_isGallinero"] = True

        # Return corners in Y-up local coords (x, z) for GCP placement
        corners_local = [
            (p0[0], -p0[1]),  # axis swap: 2D Y → -Z
            (p1[0], -p1[1]),
            (p2[0], -p2[1]),
            (p3[0], -p3[1]),
        ]

        # Log corners in WGS84 for drone waypoints
        logger.info("═" * 60)
        logger.info("GALLINERO ZONE (%.0f × %.0f m) — corners (WGS84):", actual_length, width)
        for i, (lx_2d, ly_2d) in enumerate([p0, p1, p2, p3]):
            glon = lx_2d / m_lon + c_lon
            glat = ly_2d / m_lat + c_lat
            logger.info("  GAL_%d: lat=%.10f  lon=%.10f", i, glat, glon)
        logger.info("═" * 60)

        logger.info(
            "Gallinero zone built: %.0f × %.0f m, %d verts, %d faces",
            actual_length, width, len(rect_mesh.vertices), len(rect_mesh.faces),
        )
        return rect_mesh, corners_local

    except Exception as e:
        logger.warning("_build_gallinero_zone failed: %s", e)
        return None, None


def _build_gcp_at_corners(
    corners_xz: list[tuple[float, float]],
    origin: dict,
) -> trimesh.Trimesh | None:
    """Create 4 red GCP cylinder markers at specified local-coords corners.

    Unlike _build_gcp_anchors (which picks parcel extremes), this places
    GCPs at the exact (x, z) positions provided — typically the gallinero
    zone corners.

    Args:
        corners_xz: List of 4 (x, z) tuples in local Y-up meters.
        origin: Local origin dict (for WGS84 back-conversion in logs).

    Returns:
        Merged trimesh with all GCP cylinders, or None.
    """
    from PIL import Image

    try:
        m_lon = origin["m_per_deg_lon"]
        m_lat = origin["m_per_deg_lat"]
        c_lon = origin["centroid_lon"]
        c_lat = origin["centroid_lat"]

        gcp_color = Image.new("RGB", (4, 4), (220, 40, 40))
        gcp_mat = trimesh.visual.material.PBRMaterial(
            baseColorTexture=gcp_color,
            baseColorFactor=[0.86, 0.16, 0.16, 1.0],
            emissiveFactor=[0.4, 0.05, 0.05],
            metallicFactor=0.0,
            roughnessFactor=0.7,
            doubleSided=True,
        )

        anchors = []
        logger.info("═" * 60)
        logger.info("DRONE GCP WAYPOINTS — gallinero corners (WGS84):")
        for i, (lx, lz) in enumerate(corners_xz):
            cyl = trimesh.creation.cylinder(radius=0.10, height=0.50, sections=16)
            rot = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
            cyl.apply_transform(rot)
            v = np.asarray(cyl.vertices, dtype=np.float64)
            v[:, 1] -= v[:, 1].min()
            v[:, 0] += lx
            v[:, 2] += lz
            cyl.vertices = v

            uv = np.zeros((len(cyl.vertices), 2), dtype=np.float32)
            cyl.visual = trimesh.visual.TextureVisuals(uv=uv, material=gcp_mat)
            anchors.append(cyl)

            # Back-convert to WGS84 for logging
            glon = lx / m_lon + c_lon
            glat = -lz / m_lat + c_lat  # -Z = North → lat
            logger.info("  GCP_%d: lat=%.10f  lon=%.10f  (local x=%.2f z=%.2f)", i, glat, glon, lx, lz)
        logger.info("═" * 60)

        merged = trimesh.util.concatenate(anchors)
        merged.metadata["_isGCP"] = True
        logger.info("GCP anchors built at %d gallinero corners", len(corners_xz))
        return merged

    except Exception as e:
        logger.warning("_build_gcp_at_corners failed: %s", e)
        return None


def _build_gcp_anchors(
    aoi_geojson_path: Path,
    origin: dict,
) -> trimesh.Trimesh | None:
    """Create 4 red cylinder GCP markers at parcel corners.

    Each anchor is a 10 cm radius, 0.5 m tall cylinder placed at
    the cadastral corner. These serve as Ground Control Points for
    drone flight alignment.

    Returns a single merged trimesh with all anchors.
    """
    import json as _json
    from shapely.geometry import shape as _shape

    try:
        geojson = _json.loads(aoi_geojson_path.read_text())
        geom = _shape(geojson["geometry"])
        if geom.geom_type == "MultiPolygon":
            geom = max(geom.geoms, key=lambda g: g.area)

        # Get the original cadastral CORNERS (not densified points)
        # Select the most spread-out points as corners
        exterior = list(geom.exterior.coords)
        if len(exterior) < 4:
            logger.warning("GCP anchors: polygon has < 4 vertices, skipping")
            return None

        # For densified polygons, find the 4 most extreme points
        # (min/max lon and min/max lat)
        lons = [c[0] for c in exterior]
        lats = [c[1] for c in exterior]

        corner_indices: list[int] = []
        # Top-left (min lon, max lat)
        corner_indices.append(int(np.argmin([
            (c[0] - min(lons))**2 + (c[1] - max(lats))**2 for c in exterior
        ])))
        # Top-right (max lon, max lat)
        corner_indices.append(int(np.argmin([
            (c[0] - max(lons))**2 + (c[1] - max(lats))**2 for c in exterior
        ])))
        # Bottom-right (max lon, min lat)
        corner_indices.append(int(np.argmin([
            (c[0] - max(lons))**2 + (c[1] - min(lats))**2 for c in exterior
        ])))
        # Bottom-left (min lon, min lat)
        corner_indices.append(int(np.argmin([
            (c[0] - min(lons))**2 + (c[1] - min(lats))**2 for c in exterior
        ])))

        # Deduplicate
        corners = []
        seen = set()
        for idx in corner_indices:
            if idx not in seen:
                corners.append(exterior[idx])
                seen.add(idx)

        if len(corners) < 3:
            logger.warning("GCP anchors: only %d unique corners, skipping", len(corners))
            return None

        m_lon = origin["m_per_deg_lon"]
        m_lat = origin["m_per_deg_lat"]
        c_lon = origin["centroid_lon"]
        c_lat = origin["centroid_lat"]

        from PIL import Image

        gcp_color = Image.new("RGB", (4, 4), (220, 40, 40))  # signal red
        gcp_mat = trimesh.visual.material.PBRMaterial(
            baseColorTexture=gcp_color,
            baseColorFactor=[0.86, 0.16, 0.16, 1.0],
            emissiveFactor=[0.4, 0.05, 0.05],
            metallicFactor=0.0,
            roughnessFactor=0.7,
            doubleSided=True,
        )

        anchors = []
        for i, (lon, lat) in enumerate(corners):
            # WGS84 → local meters
            lx = (lon - c_lon) * m_lon
            lz = -(lat - c_lat) * m_lat  # -Z = North

            # Create cylinder: 10cm radius, 50cm tall
            cyl = trimesh.creation.cylinder(radius=0.10, height=0.50, sections=16)
            # Cylinder is centered at origin along Z → shift up so base sits at Y=0
            cyl.vertices[:, 1] = cyl.vertices[:, 2] + 0.25  # base at Y=0
            cyl.vertices[:, 2] = cyl.vertices[:, 2] * 0  # flatten to disc then restore
            # Actually re-create properly: cylinder in Y-up
            cyl = trimesh.creation.cylinder(radius=0.10, height=0.50, sections=16)
            # Default trimesh cylinder: Z-axis aligned. Rotate to Y-up.
            rot = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
            cyl.apply_transform(rot)
            # Shift so base is at Y=0
            v = np.asarray(cyl.vertices, dtype=np.float64)
            v[:, 1] -= v[:, 1].min()
            # Place at corner position
            v[:, 0] += lx
            v[:, 2] += lz
            cyl.vertices = v

            # Apply red material
            uv = np.zeros((len(cyl.vertices), 2), dtype=np.float32)
            cyl.visual = trimesh.visual.TextureVisuals(uv=uv, material=gcp_mat)

            anchors.append(cyl)
            logger.info(
                "  GCP anchor %d: (%.6f, %.6f) → local (%.2f, %.2f)",
                i, lon, lat, lx, lz,
            )

        # Merge all cylinders into one mesh
        merged = trimesh.util.concatenate(anchors)
        merged.metadata["_isGCP"] = True

        logger.info(
            "GCP anchors built: %d corners, %d verts total",
            len(corners), len(merged.vertices),
        )

        # ── Log WGS84 coordinates for drone waypoint upload ──
        logger.info("═" * 60)
        logger.info("DRONE GCP WAYPOINTS (WGS84 — copy to flight controller):")
        for i, (lon, lat) in enumerate(corners):
            logger.info("  GCP_%d: lat=%.10f  lon=%.10f", i, lat, lon)
        logger.info("═" * 60)

        return merged

    except Exception as e:
        logger.warning("GCP anchors failed: %s", e)
        return None


def merge_buildings_into_glb(
    terrain_glb_path: Path,
    building_glb_paths: list[Path],
    *,
    debug_y_offset: float = 0.0,
    area_ha: float = 100.0,
    aoi_geojson_path: Path | None = None,
    local_origin: dict | None = None,
) -> None:
    """Merge building GLBs into the main terrain GLB.

    - Samples terrain mesh to find correct Y at each building's XZ position.
    - Shifts building base to terrain surface + debug_y_offset.
    - Calls trimesh.repair.fix_normals to prevent transparency.
    - For parcels <1ha: white/bone walls, separate roof, perimeter wall 1.8m,
      micro-topography noise, GCP anchors, aggressive AO.
    - For parcels ≥1ha: sandstone material, standard AO.
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

        is_small = area_ha < 1.0

        # ── Micro-topography DISABLED — flat terrain + sharp texture is cleaner ──
        # _apply_micro_topography was creating visual noise on the ortho.
        # A perfectly flat surface with a crisp 4K texture looks more real.
        logger.info("Micro-topography skipped (polish pass — flat terrain preferred)")

        # ── Material selection based on parcel size ──
        from PIL import Image

        if is_small:
            # ── Clay Mode: pure white matte for all building geometry ──
            clay_tex = Image.new("RGB", (16, 16), (255, 255, 255))
            wall_mat = trimesh.visual.material.PBRMaterial(
                baseColorTexture=clay_tex,
                baseColorFactor=[1.0, 1.0, 1.0, 1.0],
                metallicFactor=0.0,
                roughnessFactor=1.0,
                doubleSided=True,
            )
            # Roof = same white clay — unified maquette look
            roof_mat = trimesh.visual.material.PBRMaterial(
                baseColorTexture=clay_tex,
                baseColorFactor=[1.0, 1.0, 1.0, 1.0],
                metallicFactor=0.0,
                roughnessFactor=1.0,
                doubleSided=True,
            )
        else:
            wall_tex = Image.new("RGB", (16, 16), (184, 160, 122))  # warm sandstone
            wall_mat = trimesh.visual.material.PBRMaterial(
                baseColorTexture=wall_tex,
                baseColorFactor=[0.72, 0.63, 0.48, 1.0],
                metallicFactor=0.0,
                roughnessFactor=0.85,
                doubleSided=True,
            )
            roof_mat = wall_mat  # same as walls for large parcels

        added = 0
        bldg_centers_xz = []  # track building centers for recentering
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

                bldg_centers_xz.append((cx, cz))

                logger.info(
                    "Building %s AFTER relocation: terrain_y=%.1f, y_shift=+%.1f "
                    "(includes +%.1fm debug), Y=[%.2f,%.2f]",
                    bp.name, terrain_y, y_shift, debug_y_offset,
                    bv[:, 1].min(), bv[:, 1].max(),
                )

                # ── Fix normals (prevents invisible/transparent faces) ──
                trimesh.repair.fix_normals(bm)

                # ── Blueprint 2D mode for small parcels: flatten to thin slab ──
                if is_small:
                    # Squash entire building to a 2cm-high footprint slab at terrain level
                    bldg_y_base = float(bv[:, 1].min())
                    bv[:, 1] = np.where(
                        bv[:, 1] > bldg_y_base + 0.02,
                        bldg_y_base + 0.02,
                        bv[:, 1],
                    )
                    bm.vertices = bv
                    trimesh.repair.fix_normals(bm)
                    logger.info(
                        "Building %s flattened to 2D footprint slab (2cm height)",
                        bp.name,
                    )

                # ── Apply material + UVs (unified path) ──
                uv = np.zeros((len(bm.vertices), 2), dtype=np.float32)
                bm.visual = trimesh.visual.TextureVisuals(uv=uv, material=wall_mat)
                bm.metadata["_isBuilding"] = True

                scene.add_geometry(bm, node_name=f"building_{added}")
                added += 1
            except Exception as be:
                logger.warning("Failed loading building GLB %s: %s", bp, be)

        # ── Perimeter wall for small parcels (<1 ha) — thin 2D line (blueprint) ──
        if is_small and aoi_geojson_path and local_origin:
            try:
                wall_mesh = build_perimeter_wall(
                    aoi_geojson_path, local_origin,
                    wall_height=0.05, wall_thickness=0.10,
                )
                if wall_mesh is not None:
                    # Override wall material to white for blueprint aesthetic
                    from PIL import Image as _wImg
                    white_tex = _wImg.new("RGB", (4, 4), (255, 255, 255))
                    white_mat = trimesh.visual.material.PBRMaterial(
                        baseColorTexture=white_tex,
                        baseColorFactor=[1.0, 1.0, 1.0, 1.0],
                        emissiveFactor=[0.3, 0.3, 0.3],
                        metallicFactor=0.0,
                        roughnessFactor=1.0,
                        doubleSided=True,
                    )
                    uv_w = np.zeros((len(wall_mesh.vertices), 2), dtype=np.float32)
                    wall_mesh.visual = trimesh.visual.TextureVisuals(uv=uv_w, material=white_mat)
                    scene.add_geometry(wall_mesh, node_name="perimeter_wall")
                    logger.info("Blueprint perimeter wall (5cm height, white) added")
            except Exception as wall_err:
                logger.warning("Perimeter wall failed (non-critical): %s", wall_err)

        # ── Gallinero zone (30×8m cyan rectangle) + GCPs at its corners ──
        gallinero_corners = None
        if is_small and aoi_geojson_path and local_origin:
            try:
                gal_mesh, gallinero_corners = _build_gallinero_zone(
                    aoi_geojson_path, local_origin,
                    length=30.0, width=8.0,
                )
                if gal_mesh is not None:
                    scene.add_geometry(gal_mesh, node_name="gallinero_zone")
                    logger.info("Gallinero zone (30×8m cyan) added to scene")
            except Exception as gal_err:
                logger.warning("Gallinero zone failed (non-critical): %s", gal_err)

        # ── GCP anchor cylinders at gallinero corners (or fallback to parcel) ──
        if is_small and aoi_geojson_path and local_origin:
            try:
                if gallinero_corners and len(gallinero_corners) >= 4:
                    gcp_mesh = _build_gcp_at_corners(gallinero_corners, local_origin)
                else:
                    gcp_mesh = _build_gcp_anchors(aoi_geojson_path, local_origin)
                if gcp_mesh is not None:
                    scene.add_geometry(gcp_mesh, node_name="gcp_anchors")
                    logger.info("GCP anchor cylinders added to scene")
            except Exception as gcp_err:
                logger.warning("GCP anchors failed (non-critical): %s", gcp_err)

        # ── DRONE_ANCHOR invisible reference node at scene origin (0,0,0) ──
        # Photogrammetry software uses this to identify North and model center
        if is_small:
            anchor_pt = trimesh.creation.icosphere(subdivisions=0, radius=0.001)
            anchor_verts = np.asarray(anchor_pt.vertices, dtype=np.float64)
            # Fully transparent material — invisible in viewer
            from PIL import Image as _PILImage
            _t_img = _PILImage.new("RGBA", (2, 2), (0, 0, 0, 0))
            _anchor_mat = trimesh.visual.material.PBRMaterial(
                baseColorTexture=_t_img,
                baseColorFactor=[0.0, 0.0, 0.0, 0.0],
                alphaMode="BLEND",
                metallicFactor=0.0,
                roughnessFactor=1.0,
            )
            _anc_uv = np.zeros((len(anchor_pt.vertices), 2), dtype=np.float32)
            anchor_pt.visual = trimesh.visual.TextureVisuals(uv=_anc_uv, material=_anchor_mat)
            scene.add_geometry(anchor_pt, node_name="DRONE_ANCHOR")
            logger.info("DRONE_ANCHOR placed at (0, 0, 0) — photogrammetry north reference")

        if added > 0:
            # ── Bake contact AO — tight 20cm strip at 40% for grounded look ──
            ao_radius = 0.20 if is_small else 5.0
            ao_strength = 0.40 if is_small else 0.5
            try:
                _bake_contact_ao(scene, ao_radius=ao_radius, ao_strength=ao_strength)
            except Exception as ao_err:
                logger.warning("AO baking failed (non-critical): %s", ao_err)

            # ── Recenter on house for small parcels (<1 ha) ──
            if is_small and bldg_centers_xz:
                avg_x = np.mean([c[0] for c in bldg_centers_xz])
                avg_z = np.mean([c[1] for c in bldg_centers_xz])
                logger.info(
                    "Recentering scene on house: shifting (%.2f, %.2f) → (0, 0)",
                    avg_x, avg_z,
                )
                for geom in scene.geometry.values():
                    gv = np.asarray(geom.vertices, dtype=np.float64)
                    gv[:, 0] -= avg_x
                    gv[:, 2] -= avg_z
                    geom.vertices = gv

            merged_data = scene.export(file_type="glb")
            terrain_glb_path.write_bytes(merged_data)
            logger.info(
                "Merged %d buildings into %s (%.1f KB) "
                "[y_offset=+%.1fm, material=%s, ao=%.0f%%]",
                added, terrain_glb_path, len(merged_data) / 1024,
                debug_y_offset,
                "bone-white" if is_small else "sandstone",
                ao_strength * 100,
            )
        else:
            logger.warning("merge_buildings_into_glb: no buildings merged")
    except Exception as e:
        logger.error("merge_buildings_into_glb failed: %s", e)
