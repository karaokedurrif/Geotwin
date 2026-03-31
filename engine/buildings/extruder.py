"""
Extrusión 3D de edificios desde huellas catastrales.

Cada edificio se convierte en un mesh 3D (paredes + techo) con
altura real basada en el número de plantas del Catastro.
"""

from __future__ import annotations

import logging

import numpy as np
import trimesh
from PIL import Image
from shapely.geometry import Polygon, shape

logger = logging.getLogger(__name__)

# Colores por uso catastral (RGB 0-255)
_USE_COLORS: dict[str, tuple[int, int, int]] = {
    "residential": (235, 220, 190),       # crema
    "agricultural": (190, 185, 170),       # gris piedra
    "industrial": (140, 140, 145),         # gris oscuro
    "commercial": (200, 195, 175),         # beige
    "publicService": (180, 190, 200),      # gris azulado
}
_DEFAULT_COLOR = (200, 195, 185)

# Roughness por uso catastral
_USE_ROUGHNESS: dict[str, float] = {
    "residential": 0.7,
    "agricultural": 0.9,
    "industrial": 0.95,
    "commercial": 0.75,
    "publicService": 0.8,
}


def extrude_building(
    footprint: Polygon | dict,
    num_floors: int = 1,
    floor_height: float = 3.0,
    ground_elevation: float = 0.0,
    use: str = "residential",
    metadata: dict | None = None,
) -> trimesh.Trimesh:
    """Genera un mesh 3D extruido del edificio.

    Args:
        footprint: Shapely Polygon o GeoJSON geometry dict (huella 2D).
        num_floors: Plantas sobre rasante.
        floor_height: Metros por planta (Catastro estándar: 3m).
        ground_elevation: Elevación del terreno en la base (del DEM).
        use: Uso catastral (residential, agricultural, industrial, etc.).
        metadata: Dict adicional para guardar en extras del mesh.

    Returns:
        trimesh.Trimesh con el edificio extruido y material PBR.
    """
    if isinstance(footprint, dict):
        footprint = shape(footprint)

    if not isinstance(footprint, Polygon) or footprint.is_empty:
        raise ValueError("footprint must be a non-empty Polygon")

    num_floors = max(1, num_floors)
    height = num_floors * floor_height

    logger.info(
        "Extruding building: %d floors × %.1fm = %.1fm, use=%s, base=%.1fm",
        num_floors, floor_height, height, use, ground_elevation,
    )

    # Extrude the 2D polygon into a 3D prism
    mesh = trimesh.creation.extrude_polygon(footprint, height)

    # Move base to ground elevation
    mesh.vertices[:, 2] += ground_elevation

    # Apply material based on use
    color = _USE_COLORS.get(use, _DEFAULT_COLOR)
    roughness = _USE_ROUGHNESS.get(use, 0.85)

    # Create a small solid-color texture (avoids Cesium shader crash)
    tex_img = Image.new("RGB", (4, 4), color)
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=tex_img,
        metallicFactor=0.0,
        roughnessFactor=roughness,
        doubleSided=True,
    )

    # Generate UVs for the extruded mesh
    verts = np.asarray(mesh.vertices)
    xs = verts[:, 0]
    ys = verts[:, 1]
    x_range = xs.max() - xs.min()
    y_range = ys.max() - ys.min()
    u = (xs - xs.min()) / max(x_range, 1e-6)
    v = (ys - ys.min()) / max(y_range, 1e-6)
    uv = np.column_stack([u, v]).astype(np.float32)

    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)

    # Store metadata in mesh extras for downstream use
    if metadata:
        mesh.metadata["extras"] = metadata

    logger.info(
        "Building extruded: %d vertices, %d faces, height=%.1fm",
        len(mesh.vertices), len(mesh.faces), height,
    )
    return mesh


def merge_buildings_with_terrain(
    terrain_mesh: trimesh.Trimesh,
    building_meshes: list[trimesh.Trimesh],
) -> trimesh.Scene:
    """Combina terreno + edificios en una escena glTF.

    Each building is a separate node with its own material.
    Exports as GLB with multiple meshes.

    Args:
        terrain_mesh: The terrain mesh (already textured).
        building_meshes: List of extruded building meshes.

    Returns:
        trimesh.Scene ready for GLB export.
    """
    scene = trimesh.Scene()
    scene.add_geometry(terrain_mesh, node_name="terrain")

    for i, bldg in enumerate(building_meshes):
        scene.add_geometry(bldg, node_name=f"building_{i}")

    logger.info(
        "Scene merged: 1 terrain + %d buildings",
        len(building_meshes),
    )
    return scene
