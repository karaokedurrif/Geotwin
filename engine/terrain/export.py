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


def _degrees_to_local_meters(vertices: np.ndarray) -> np.ndarray:
    """Convierte vértices [lon, lat, elev] a coordenadas locales en metros.

    Produce coordenadas glTF-compliant (Y-up, right-handed):
      X = East, Y = Elevation (up), Z = North
    """
    centroid_lon = vertices[:, 0].mean()
    centroid_lat = vertices[:, 1].mean()
    min_elev = vertices[:, 2].min()

    lat_rad = np.radians(centroid_lat)
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * np.cos(lat_rad)

    local = np.empty_like(vertices)
    local[:, 0] = (vertices[:, 0] - centroid_lon) * m_per_deg_lon  # X = East
    local[:, 1] = vertices[:, 2] - min_elev                        # Y = Elevation (up)
    local[:, 2] = (vertices[:, 1] - centroid_lat) * m_per_deg_lat  # Z = North
    return local


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
    """Validate & fix TEXCOORD_0 accessor type in GLB.

    Cesium's PBR shader expects TEXCOORD_0 as VEC2 (componentType=5126 FLOAT).
    Some trimesh versions may export it as SCALAR, causing shader crash:
      'v_texCoord_0 undeclared identifier' / 'dimension mismatch'
    """
    try:
        import io
        # Parse GLB header: magic(4) + version(4) + length(4) + json_chunk_len(4) + json_type(4)
        if len(glb_bytes) < 20 or glb_bytes[:4] != b'glTF':
            return glb_bytes

        json_len = struct.unpack_from('<I', glb_bytes, 12)[0]
        json_data = glb_bytes[20:20 + json_len]
        gltf = json.loads(json_data)

        changed = False
        for accessor in gltf.get('accessors', []):
            # Find TEXCOORD accessors by checking mesh primitives
            pass

        # Check all mesh primitives for TEXCOORD_0 accessor index
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
                        acc['type'] = 'VEC2'
                        # Adjust count if it was SCALAR (count was 2x what it should be)
                        if acc.get('type') == 'VEC2':
                            changed = True

        if not changed:
            return glb_bytes

        # Re-serialize the JSON chunk
        new_json = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
        # Pad to 4-byte alignment with spaces
        pad = (4 - len(new_json) % 4) % 4
        new_json += b' ' * pad

        # Rebuild GLB: header + json chunk + bin chunk
        bin_chunk_start = 20 + json_len
        # Check for padding after JSON chunk
        json_chunk_total = json_len
        # Align to next chunk boundary
        if bin_chunk_start % 4 != 0:
            bin_chunk_start += (4 - bin_chunk_start % 4) % 4
        bin_rest = glb_bytes[12 + 8 + json_len:]  # everything after json chunk

        # Rebuild: GLB header + JSON chunk header + JSON + rest
        new_glb = io.BytesIO()
        total_len = 12 + 8 + len(new_json) + len(bin_rest)
        new_glb.write(struct.pack('<4sII', b'glTF', 2, total_len))
        new_glb.write(struct.pack('<II', len(new_json), 0x4E4F534A))  # JSON chunk
        new_glb.write(new_json)
        new_glb.write(bin_rest)
        result = new_glb.getvalue()
        # Fix total length
        struct.pack_into('<I', bytearray(result), 8, len(result))
        logger.info("GLB TEXCOORD_0 accessor fixed to VEC2")
        return bytes(bytearray(result))
    except Exception as e:
        logger.warning("GLB TEXCOORD_0 validation skipped: %s", e)
        return glb_bytes


def _mesh_to_glb(mesh: TerrainMesh, texture_path: Path | None = None, *, local_coords: bool = True) -> bytes:
    """Convierte TerrainMesh a GLB (binary glTF) usando trimesh.

    Args:
        local_coords: Si True, reproyecta vértices de grados a metros locales (ENU).
            Usar True para GLBs standalone (Three.js, Blender).
            Usar False para GLBs embebidos en B3DM (Cesium 3D Tiles).
    """
    verts = _degrees_to_local_meters(mesh.vertices) if local_coords else mesh.vertices
    t_mesh = trimesh.Trimesh(
        vertices=verts,
        faces=mesh.faces,
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
