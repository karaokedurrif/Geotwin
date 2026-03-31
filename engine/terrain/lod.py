"""
Generación de LOD (Levels of Detail) por decimación cuadrática.

Genera 4 niveles de detalle para streaming eficiente:
- L0: 100% (máximo detalle, solo vista cercana)
- L1: 25%
- L2: 6%
- L3: 1.5% (vista general)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import open3d as o3d

from .mesh import TerrainMesh

logger = logging.getLogger(__name__)

DEFAULT_LOD_RATIOS = [1.0, 0.25, 0.06, 0.015]


def compute_lod_levels(area_ha: float) -> list[float]:
    """Adaptive LOD ratios based on parcel area.

    Small parcels keep more triangles per LOD (every triangle matters).
    Large parcels can afford aggressive decimation.
    """
    if area_ha < 1:
        return [1.0, 0.5]                  # 100%, 50%
    elif area_ha < 10:
        return [1.0, 0.5, 0.15]            # 100%, 50%, 15%
    elif area_ha < 100:
        return [1.0, 0.5, 0.15, 0.05]      # 100%, 50%, 15%, 5%
    else:
        return DEFAULT_LOD_RATIOS           # 100%, 25%, 6%, 1.5%


@dataclass
class LODLevel:
    """Un nivel de detalle de la malla."""

    level: int
    ratio: float
    mesh: TerrainMesh
    geometric_error: float  # Error geométrico estimado (metros)


def _terrain_mesh_to_o3d(mesh: TerrainMesh) -> o3d.geometry.TriangleMesh:
    """Convierte TerrainMesh a Open3D TriangleMesh."""
    o3d_mesh = o3d.geometry.TriangleMesh()
    o3d_mesh.vertices = o3d.utility.Vector3dVector(mesh.vertices)
    o3d_mesh.triangles = o3d.utility.Vector3iVector(mesh.faces)
    if mesh.normals is not None:
        o3d_mesh.triangle_normals = o3d.utility.Vector3dVector(mesh.normals)
    else:
        o3d_mesh.compute_triangle_normals()
    return o3d_mesh


def _o3d_to_terrain_mesh(o3d_mesh: o3d.geometry.TriangleMesh) -> TerrainMesh:
    """Convierte Open3D TriangleMesh a TerrainMesh."""
    vertices = np.asarray(o3d_mesh.vertices)
    faces = np.asarray(o3d_mesh.triangles)
    normals = np.asarray(o3d_mesh.triangle_normals) if o3d_mesh.has_triangle_normals() else None
    # UVs se recomputan después (ver _recompute_uvs)
    return TerrainMesh(vertices=vertices, faces=faces, normals=normals)


def _recompute_uvs(
    decimated: TerrainMesh,
    original: TerrainMesh,
) -> TerrainMesh:
    """Recalcula UVs para una malla decimada.

    Los UVs son un mapeo lineal (lon, lat) → (u, v), así que se pueden
    recalcular directamente usando los mismos bounds del original.
    """
    if original.uv_coords is None:
        return decimated

    bounds = original.bounds
    lon_range = bounds["max_lon"] - bounds["min_lon"]
    lat_range = bounds["max_lat"] - bounds["min_lat"]

    if lon_range <= 0 or lat_range <= 0:
        return decimated

    lons = decimated.vertices[:, 0]
    lats = decimated.vertices[:, 1]

    u = np.clip((lons - bounds["min_lon"]) / lon_range, 0.0, 1.0)
    v = np.clip((lats - bounds["min_lat"]) / lat_range, 0.0, 1.0)

    decimated.uv_coords = np.column_stack([u, v])
    return decimated


def _estimate_geometric_error(original: TerrainMesh, decimated: TerrainMesh) -> float:
    """Estima el error geométrico entre la malla original y la decimada.

    Usa la diferencia media de elevación en los vértices eliminados como proxy.
    Para tiles 3D, un error geométrico mayor → el tile se carga desde más lejos.
    """
    if decimated.face_count >= original.face_count:
        return 0.0

    # Simplificación: error proporcional a la reducción
    reduction = 1.0 - (decimated.face_count / max(original.face_count, 1))

    # Rango de elevación como escala
    elev_range = float(original.vertices[:, 2].max() - original.vertices[:, 2].min())

    # Error estimado: mayor reducción → mayor error
    return elev_range * reduction * 0.1


def generate_lods(
    mesh: TerrainMesh,
    ratios: list[float] | None = None,
) -> list[LODLevel]:
    """Genera múltiples niveles de detalle por decimación cuadrática.

    Args:
        mesh: Malla original (L0).
        ratios: Lista de factores de decimación [1.0, 0.25, 0.06, 0.015].

    Returns:
        Lista de LODLevel ordenada de mayor a menor detalle.
    """
    if ratios is None:
        ratios = DEFAULT_LOD_RATIOS

    o3d_mesh = _terrain_mesh_to_o3d(mesh)
    lods: list[LODLevel] = []

    for i, ratio in enumerate(ratios):
        if ratio >= 1.0:
            # L0 = malla original
            lod_mesh = mesh
            geo_error = 0.0
        else:
            target_tris = max(int(mesh.face_count * ratio), 4)
            logger.info(
                "LOD%d: decimando %d → %d triángulos (ratio %.1f%%)",
                i, mesh.face_count, target_tris, ratio * 100,
            )
            simplified = o3d_mesh.simplify_quadric_decimation(target_tris)
            simplified.compute_triangle_normals()
            lod_mesh = _o3d_to_terrain_mesh(simplified)
            lod_mesh = _recompute_uvs(lod_mesh, mesh)
            geo_error = _estimate_geometric_error(mesh, lod_mesh)

        lods.append(LODLevel(
            level=i,
            ratio=ratio,
            mesh=lod_mesh,
            geometric_error=geo_error,
        ))

        logger.info(
            "LOD%d: %d vértices, %d triángulos, error=%.2fm",
            i, lod_mesh.vertex_count, lod_mesh.face_count, geo_error,
        )

    return lods
