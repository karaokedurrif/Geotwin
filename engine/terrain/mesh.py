"""
Generación de malla triangulada a partir de DEM.

Convierte un grid regular de elevaciones en una malla 3D (vértices + triángulos)
con submuestreo adaptativo: más detalle en pendientes fuertes, menos en plano.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
from scipy.spatial import Delaunay

logger = logging.getLogger(__name__)


@dataclass
class TerrainMesh:
    """Malla triangulada del terreno."""

    vertices: np.ndarray  # (N, 3) — [lon, lat, elevation_m]
    faces: np.ndarray  # (M, 3) — índices de triángulos
    normals: np.ndarray | None = None  # (M, 3) — normales por cara
    uv_coords: np.ndarray | None = None  # (N, 2) — coordenadas UV por vértice

    @property
    def vertex_count(self) -> int:
        return len(self.vertices)

    @property
    def face_count(self) -> int:
        return len(self.faces)

    @property
    def bounds(self) -> dict:
        """Bounding box de la malla."""
        mins = self.vertices.min(axis=0)
        maxs = self.vertices.max(axis=0)
        return {
            "min_lon": float(mins[0]),
            "min_lat": float(mins[1]),
            "min_elev": float(mins[2]),
            "max_lon": float(maxs[0]),
            "max_lat": float(maxs[1]),
            "max_elev": float(maxs[2]),
        }


def compute_uv_from_bbox(
    mesh: TerrainMesh,
    bbox: tuple[float, float, float, float],
) -> TerrainMesh:
    """Calcula coordenadas UV para texturizar con una ortofoto.

    Mapea (lon, lat) de cada vértice a (u, v) en [0,1] según el bbox de la textura.
    UV (0,0) = esquina inferior-izquierda; (1,1) = esquina superior-derecha.

    Args:
        mesh: Malla con vértices en coordenadas geográficas.
        bbox: (min_lon, min_lat, max_lon, max_lat) del área de la textura.

    Returns:
        Nuevo TerrainMesh con uv_coords asignados.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    lon_range = max_lon - min_lon
    lat_range = max_lat - min_lat

    if lon_range <= 0 or lat_range <= 0:
        raise ValueError(f"Bbox inválido: {bbox}")

    lons = mesh.vertices[:, 0]
    lats = mesh.vertices[:, 1]

    u = (lons - min_lon) / lon_range
    v = (lats - min_lat) / lat_range

    uv = np.column_stack([
        np.clip(u, 0.0, 1.0),
        np.clip(v, 0.0, 1.0),
    ])

    return TerrainMesh(
        vertices=mesh.vertices,
        faces=mesh.faces,
        normals=mesh.normals,
        uv_coords=uv,
    )


def _compute_slope(elevation: np.ndarray, cell_size: float) -> np.ndarray:
    """Calcula pendiente en grados para cada celda del DEM."""
    dy, dx = np.gradient(elevation, cell_size)
    slope_rad = np.arctan(np.sqrt(dx**2 + dy**2))
    return np.degrees(slope_rad)


def _adaptive_mask(
    elevation: np.ndarray,
    cell_size: float,
    base_step: int = 1,
    slope_threshold: float = 10.0,
) -> np.ndarray:
    """Genera máscara de puntos a incluir con muestreo adaptativo.

    - Zonas con pendiente > threshold: se incluyen todos los puntos (paso 1).
    - Zonas planas: se submuestrean (paso base_step * 2 o 4).

    Returns:
        Máscara booleana (rows, cols).
    """
    slope = _compute_slope(elevation, cell_size)
    rows, cols = elevation.shape
    mask = np.zeros((rows, cols), dtype=bool)

    # Alta pendiente: incluir todos
    high_slope = slope > slope_threshold
    mask[high_slope] = True

    # Baja pendiente: submuestrear
    step = max(base_step * 2, 2)
    low_slope_grid = np.zeros_like(mask)
    low_slope_grid[::step, ::step] = True
    mask |= (low_slope_grid & ~high_slope)

    # Siempre incluir bordes para integridad de la malla
    mask[0, :] = True
    mask[-1, :] = True
    mask[:, 0] = True
    mask[:, -1] = True

    return mask


def dem_to_mesh(
    dem_data: dict,
    adaptive: bool = True,
    slope_threshold: float = 10.0,
    max_triangles: int | None = None,
) -> TerrainMesh:
    """Convierte datos DEM a malla triangulada.

    Args:
        dem_data: dict devuelto por ingest.load_dem() o ingest.crop_dem_by_aoi().
            Debe contener 'elevation' (2D array), 'transform', 'bounds'.
        adaptive: Si True, usa muestreo adaptativo (menos triángulos en plano).
        slope_threshold: Pendiente (°) a partir de la cual se usa resolución máxima.
        max_triangles: Límite de triángulos. Si se supera, se incrementa el paso.

    Returns:
        TerrainMesh con vértices en [lon, lat, elevation].
    """
    elevation = dem_data["elevation"]
    transform = dem_data["transform"]
    rows, cols = elevation.shape

    logger.info("Generando malla: grid %dx%d (%.0f puntos)", rows, cols, rows * cols)

    # Calcular tamaño de celda en metros (aproximado)
    res_x = abs(transform.a)  # grados/píxel lon
    res_y = abs(transform.e)  # grados/píxel lat
    cell_size_m = res_y * 111_320  # aproximación

    # Decidir paso base según max_triangles
    base_step = 1
    if max_triangles:
        estimated_triangles = rows * cols * 2
        while estimated_triangles / (base_step**2) > max_triangles * 1.5:
            base_step += 1

    # Generar coordenadas de cada píxel
    row_indices, col_indices = np.mgrid[0:rows, 0:cols]
    lons = transform.c + col_indices * transform.a + row_indices * transform.b
    lats = transform.f + col_indices * transform.d + row_indices * transform.e

    # Máscara de puntos a incluir
    if adaptive and base_step <= 4:
        mask = _adaptive_mask(elevation, cell_size_m, base_step, slope_threshold)
    else:
        # Submuestreo uniforme
        mask = np.zeros((rows, cols), dtype=bool)
        mask[::base_step, ::base_step] = True
        mask[0, :] = True
        mask[-1, :] = True
        mask[:, 0] = True
        mask[:, -1] = True

    # Excluir NaN
    valid = ~np.isnan(elevation)
    mask &= valid

    # Extraer puntos
    x = lons[mask]
    y = lats[mask]
    z = elevation[mask]

    logger.info("Puntos seleccionados: %d de %d (%.1f%%)", len(x), rows * cols, 100 * len(x) / (rows * cols))

    # Triangulación Delaunay 2D
    points_2d = np.column_stack([x, y])
    tri = Delaunay(points_2d)

    # Filtrar triángulos degenerados (área ~0)
    v0 = points_2d[tri.simplices[:, 0]]
    v1 = points_2d[tri.simplices[:, 1]]
    v2 = points_2d[tri.simplices[:, 2]]
    areas = 0.5 * np.abs(
        (v1[:, 0] - v0[:, 0]) * (v2[:, 1] - v0[:, 1])
        - (v2[:, 0] - v0[:, 0]) * (v1[:, 1] - v0[:, 1])
    )
    min_area = (res_x * res_y) * 0.001  # 0.1% del área de celda
    valid_faces = areas > min_area
    faces = tri.simplices[valid_faces]

    vertices = np.column_stack([x, y, z])

    logger.info("Malla generada: %d vértices, %d triángulos", len(vertices), len(faces))

    # Calcular normales
    normals = _compute_face_normals(vertices, faces)

    return TerrainMesh(vertices=vertices, faces=faces, normals=normals)


def _compute_face_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Calcula normales por cara."""
    v0 = vertices[faces[:, 0]]
    v1 = vertices[faces[:, 1]]
    v2 = vertices[faces[:, 2]]

    edge1 = v1 - v0
    edge2 = v2 - v0
    normals = np.cross(edge1, edge2)

    # Normalizar
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    lengths[lengths == 0] = 1  # evitar div/0
    normals = normals / lengths

    return normals


def clip_mesh_to_aoi(mesh: TerrainMesh, aoi_geojson: dict) -> TerrainMesh:
    """Recorta la malla a la geometría del AOI.

    Elimina triángulos cuyo centroide está fuera del polígono.
    """
    from shapely.geometry import Point, shape

    geom_dict = aoi_geojson.get("geometry", aoi_geojson)
    polygon = shape(geom_dict)

    # Centroide de cada triángulo
    centroids = mesh.vertices[mesh.faces].mean(axis=1)  # (M, 3)

    # Filtrar por polígono (solo X, Y)
    inside = np.array([
        polygon.contains(Point(c[0], c[1]))
        for c in centroids
    ])

    new_faces = mesh.faces[inside]

    # Re-indexar vértices para eliminar huérfanos
    used_verts = np.unique(new_faces)
    remap = np.full(len(mesh.vertices), -1, dtype=int)
    remap[used_verts] = np.arange(len(used_verts))

    new_vertices = mesh.vertices[used_verts]
    new_faces = remap[new_faces]
    new_normals = mesh.normals[inside] if mesh.normals is not None else None

    logger.info(
        "Malla recortada: %d→%d vértices, %d→%d triángulos",
        mesh.vertex_count, len(new_vertices),
        mesh.face_count, len(new_faces),
    )

    return TerrainMesh(vertices=new_vertices, faces=new_faces, normals=new_normals)
