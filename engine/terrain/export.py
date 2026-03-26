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
    """Convierte vértices [lon, lat, elev] a coordenadas locales ENU en metros.

    Centra el mesh en su centroide y escala lon/lat a metros usando
    la proyección local aproximada (válida para áreas < 500 km).
    """
    centroid_lon = vertices[:, 0].mean()
    centroid_lat = vertices[:, 1].mean()
    min_elev = vertices[:, 2].min()

    lat_rad = np.radians(centroid_lat)
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * np.cos(lat_rad)

    local = np.empty_like(vertices)
    local[:, 0] = (vertices[:, 0] - centroid_lon) * m_per_deg_lon  # East
    local[:, 1] = (vertices[:, 1] - centroid_lat) * m_per_deg_lat  # North
    local[:, 2] = vertices[:, 2] - min_elev                        # Up (from ground)
    return local


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

        # trimesh TextureVisuals: UV (0,0) = top-left en imagen,
        # pero nuestros UVs tienen v=0 en min_lat (abajo).
        # Flip V para que coincida con la orientación de la imagen.
        uv = mesh.uv_coords.copy()
        uv[:, 1] = 1.0 - uv[:, 1]

        material = trimesh.visual.material.PBRMaterial(
            baseColorTexture=image,
            metallicFactor=0.0,
            roughnessFactor=1.0,
        )
        t_mesh.visual = trimesh.visual.TextureVisuals(
            uv=uv,
            material=material,
        )

    return t_mesh.export(file_type="glb")


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

    Formato B3DM:
    - Header (28 bytes): magic, version, byteLength, featureTableJSONByteLength,
      featureTableBinaryByteLength, batchTableJSONByteLength, batchTableBinaryByteLength
    - Feature Table JSON
    - Feature Table Binary
    - Batch Table JSON
    - Batch Table Binary
    - GLB body
    """
    glb_data = _mesh_to_glb(mesh, local_coords=False)

    # Feature table: BATCH_LENGTH = 0 (no features)
    feature_table_json = json.dumps({"BATCH_LENGTH": 0}).encode("utf-8")
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
