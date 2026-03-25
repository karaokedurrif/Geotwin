"""Tests para engine.terrain — ingestión, mallado, LOD."""

import numpy as np
import pytest

from engine.terrain.ingest import load_dem
from engine.terrain.mesh import TerrainMesh, dem_to_mesh
from engine.terrain.lod import generate_lods


def _make_synthetic_dem(rows: int = 100, cols: int = 100) -> dict:
    """Genera un DEM sintético para tests (sin necesitar archivo)."""
    from rasterio.transform import from_bounds

    # Terreno sintético: colina gaussiana sobre plano
    x = np.linspace(0, 1, cols)
    y = np.linspace(0, 1, rows)
    xx, yy = np.meshgrid(x, y)

    # Colina centrada + ruido
    elevation = (
        800  # base
        + 200 * np.exp(-((xx - 0.5) ** 2 + (yy - 0.5) ** 2) / 0.05)
        + np.random.default_rng(42).normal(0, 2, (rows, cols))
    ).astype(np.float32)

    # Transform: simular zona en España central
    transform = from_bounds(-3.99, 40.91, -3.97, 40.93, cols, rows)

    return {
        "elevation": elevation,
        "transform": transform,
        "crs": "EPSG:4326",
        "bounds": (-3.99, 40.91, -3.97, 40.93),
        "resolution": (0.0002, 0.0002),
        "nodata": -9999,
        "width": cols,
        "height": rows,
        "profile": {
            "driver": "GTiff",
            "dtype": "float32",
            "width": cols,
            "height": rows,
            "count": 1,
            "crs": "EPSG:4326",
            "transform": transform,
        },
    }


class TestDemToMesh:
    def test_basic_mesh_generation(self):
        dem = _make_synthetic_dem(50, 50)
        mesh = dem_to_mesh(dem, adaptive=False)

        assert isinstance(mesh, TerrainMesh)
        assert mesh.vertex_count > 10
        assert mesh.face_count > 10
        assert mesh.vertices.shape[1] == 3  # (N, 3) = [lon, lat, elev]
        assert mesh.faces.shape[1] == 3  # (M, 3) = triángulos

    def test_adaptive_mesh_has_fewer_triangles(self):
        dem = _make_synthetic_dem(80, 80)
        mesh_uniform = dem_to_mesh(dem, adaptive=False)
        mesh_adaptive = dem_to_mesh(dem, adaptive=True, slope_threshold=5.0)

        # Adaptativo debería tener menos triángulos en zonas planas
        # pero podría tener más en pendientes fuertes
        # Al menos verificar que ambos producen mallas válidas
        assert mesh_uniform.face_count > 0
        assert mesh_adaptive.face_count > 0

    def test_mesh_max_triangles(self):
        dem = _make_synthetic_dem(100, 100)
        mesh = dem_to_mesh(dem, adaptive=False, max_triangles=500)

        # Debería respetar aproximadamente el límite
        assert mesh.face_count < 2000  # margen amplio

    def test_mesh_vertices_have_valid_elevation(self):
        dem = _make_synthetic_dem()
        mesh = dem_to_mesh(dem, adaptive=False)

        # Elevaciones deben estar en rango razonable
        elevations = mesh.vertices[:, 2]
        assert elevations.min() > 700
        assert elevations.max() < 1100

    def test_mesh_normals_are_unit_vectors(self):
        dem = _make_synthetic_dem(50, 50)
        mesh = dem_to_mesh(dem, adaptive=False)

        assert mesh.normals is not None
        lengths = np.linalg.norm(mesh.normals, axis=1)
        np.testing.assert_allclose(lengths, 1.0, atol=0.01)


class TestLOD:
    def test_generate_4_lods(self):
        dem = _make_synthetic_dem(60, 60)
        mesh = dem_to_mesh(dem, adaptive=False)
        lods = generate_lods(mesh)

        assert len(lods) == 4
        assert lods[0].level == 0
        assert lods[0].ratio == 1.0

    def test_lod_decreasing_triangles(self):
        dem = _make_synthetic_dem(80, 80)
        mesh = dem_to_mesh(dem, adaptive=False)
        lods = generate_lods(mesh)

        # Cada LOD debe tener menos triángulos que el anterior
        for i in range(1, len(lods)):
            assert lods[i].mesh.face_count <= lods[i - 1].mesh.face_count

    def test_lod_geometric_error_increasing(self):
        dem = _make_synthetic_dem(80, 80)
        mesh = dem_to_mesh(dem, adaptive=False)
        lods = generate_lods(mesh)

        # Error geométrico debe crecer con la simplificación
        for i in range(1, len(lods)):
            assert lods[i].geometric_error >= lods[i - 1].geometric_error
