"""
Extrusión 3D de edificios desde huellas catastrales.

Cada edificio se convierte en un mesh 3D (paredes + techo) con
altura real basada en el número de plantas del Catastro.

The footprint is expected in WGS84 (lon, lat). It gets converted to
the same local-meter coordinate system used by the terrain mesh
(X=East, Y=Up, -Z=North) so both align in the GLB viewer.
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

# Building uses that get pitched (gabled) roofs
_PITCHED_ROOF_USES = {"agricultural", "agriculture", "industrial"}
_DEFAULT_PITCH_DEG = 15.0


def _wgs84_to_local(
    coords_lonlat: list[tuple[float, float]],
    origin: dict,
) -> list[tuple[float, float]]:
    """Convert WGS84 (lon, lat) polygon coords → local meters (X=East, Z_2d=North).

    Uses the same origin reference as the terrain mesh so building sits
    on top of the terrain correctly.

    Returns 2D local coords suitable for Shapely extrusion.
    The Z axis swap (Y=up, -Z=north) is applied AFTER extrusion.
    """
    m_lon = origin["m_per_deg_lon"]
    m_lat = origin["m_per_deg_lat"]
    c_lon = origin["centroid_lon"]
    c_lat = origin["centroid_lat"]

    local = []
    for lon, lat in coords_lonlat:
        x = (lon - c_lon) * m_lon       # East
        y = (lat - c_lat) * m_lat       # North (temporarily Y in 2D)
        local.append((x, y))
    return local


def _add_pitched_roof(
    mesh: trimesh.Trimesh,
    pitch_deg: float = 15.0,
) -> trimesh.Trimesh:
    """Replace the flat roof of an extruded box with a gabled (pitched) roof.

    Works in the Y-up local coordinate system:
      X = East, Y = Up, -Z = North.

    The ridge runs along the **longest** horizontal axis of the footprint
    so that a rectangular nave gets a natural gable.  Top-face vertices
    are lifted along the Y axis to form the slope.

    Args:
        mesh: Extruded building trimesh (Y-up, already axis-swapped).
        pitch_deg: Roof pitch angle in degrees (measured from horizontal).

    Returns:
        New trimesh with the pitched roof.
    """
    verts = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces)

    y_max = verts[:, 1].max()
    y_min = verts[:, 1].min()
    roof_tol = 0.1  # vertices within 10cm of top are "roof"
    roof_mask = verts[:, 1] > (y_max - roof_tol)

    if roof_mask.sum() < 3:
        return mesh

    roof_verts = verts[roof_mask]

    # Determine the longest horizontal axis (X or Z)
    x_span = roof_verts[:, 0].max() - roof_verts[:, 0].min()
    z_span = roof_verts[:, 2].max() - roof_verts[:, 2].min()

    pitch_rad = np.radians(pitch_deg)

    if x_span >= z_span:
        # Ridge runs along X → slope along Z
        z_center = (roof_verts[:, 2].max() + roof_verts[:, 2].min()) / 2.0
        half_span = z_span / 2.0
        ridge_rise = half_span * np.tan(pitch_rad)

        for idx in np.where(roof_mask)[0]:
            dz = abs(verts[idx, 2] - z_center)
            # Linear slope from ridge (center) to eave (edge)
            verts[idx, 1] = y_max + ridge_rise * (1.0 - dz / max(half_span, 0.1))
    else:
        # Ridge runs along Z → slope along X
        x_center = (roof_verts[:, 0].max() + roof_verts[:, 0].min()) / 2.0
        half_span = x_span / 2.0
        ridge_rise = half_span * np.tan(pitch_rad)

        for idx in np.where(roof_mask)[0]:
            dx = abs(verts[idx, 0] - x_center)
            verts[idx, 1] = y_max + ridge_rise * (1.0 - dx / max(half_span, 0.1))

    result = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    trimesh.repair.fix_normals(result)

    logger.info(
        "Pitched roof: pitch=%.0f°, ridge_rise=+%.1fm, span=%.1fm, %d roof verts",
        pitch_deg, ridge_rise, max(x_span, z_span), int(roof_mask.sum()),
    )
    return result


def extrude_building(
    footprint: Polygon | dict,
    num_floors: int = 1,
    floor_height: float = 3.0,
    ground_elevation: float = 0.0,
    use: str = "residential",
    origin: dict | None = None,
    metadata: dict | None = None,
) -> trimesh.Trimesh:
    """Genera un mesh 3D extruido del edificio.

    Args:
        footprint: Shapely Polygon o GeoJSON geometry dict (huella 2D en WGS84).
        num_floors: Plantas sobre rasante (min 1).
        floor_height: Metros por planta (Catastro estándar: 3m).
        ground_elevation: Elevación del terreno en la base (del DEM).
        use: Uso catastral (residential, agricultural, industrial, etc.).
        origin: Local origin dict from terrain export (centroid_lon, centroid_lat,
                min_elev, m_per_deg_lon, m_per_deg_lat, z_sign). If provided,
                the footprint is converted from WGS84 to local meters.
        metadata: Dict adicional para guardar en extras del mesh.

    Returns:
        trimesh.Trimesh with the building in local meter coordinates
        (X=East, Y=Elevation, -Z=North) matching the terrain mesh.
    """
    if isinstance(footprint, dict):
        footprint = shape(footprint)

    if not isinstance(footprint, Polygon) or footprint.is_empty:
        raise ValueError("footprint must be a non-empty Polygon")

    num_floors = max(1, num_floors)

    # Realistic floor_height per building use
    # Validated against LiDAR PNOA and Catastro DNPRC data:
    #   Residential: 3.5m/floor (2.5m ceiling + 0.3m slab + foundation/finishes)
    #   Agricultural/industrial: 6.0m/floor (naves/bodegas with high clearance)
    #   Commercial: 4.0m/floor (retail ground floors)
    use_lower = use.lower() if use else ""
    if floor_height == 3.0 and use_lower in ("agricultural", "agriculture", "industrial"):
        floor_height = 6.0  # naves/bodegas: ~6m per "floor"
    elif floor_height == 3.0 and use_lower in ("commercial",):
        floor_height = 4.0
    elif floor_height == 3.0 and use_lower in ("residential",):
        floor_height = 3.5  # Spanish std: slab-to-slab ~3.5m exterior

    height = num_floors * floor_height

    logger.info(
        "Extruding building: %d floors × %.1fm = %.1fm, use=%s, base=%.1fm, "
        "origin=%s",
        num_floors, floor_height, height, use, ground_elevation,
        "local" if origin else "raw-wgs84",
    )

    # ── Convert WGS84 → local meters if origin is provided ──
    if origin is not None:
        exterior_lonlat = list(footprint.exterior.coords)
        local_2d = _wgs84_to_local(
            [(c[0], c[1]) for c in exterior_lonlat],
            origin,
        )
        footprint = Polygon(local_2d)

        if footprint.is_empty or not footprint.is_valid:
            raise ValueError("Footprint became invalid after WGS84 → local conversion")

        # Adjust ground elevation relative to the terrain origin
        ground_elevation = ground_elevation - origin.get("min_elev", 0.0)

    # Extrude the 2D polygon into a 3D prism
    # trimesh extrudes along +Z in 2D space
    mesh = trimesh.creation.extrude_polygon(footprint, height)

    # trimesh extrudes along Z. We need glTF convention: Y=up, -Z=North
    # The 2D polygon was in (X=East, Y=North) → after extrusion Z=up
    # Swap: rotate so Z-up → Y-up and Y-north → -Z-north
    # Transform: (x, y, z) → (x, z, -y)  [Y→-Z, Z→Y]
    verts = np.asarray(mesh.vertices, dtype=np.float64)
    new_verts = np.empty_like(verts)
    new_verts[:, 0] = verts[:, 0]         # X = East (unchanged)
    new_verts[:, 1] = verts[:, 2]         # Y = elevation (was Z in extrusion)
    new_verts[:, 2] = -verts[:, 1]        # -Z = North (was Y in 2D polygon)

    # Shift base to ground elevation (in local Y-up frame)
    new_verts[:, 1] += ground_elevation

    mesh.vertices = new_verts

    # Reverse face winding to fix normals after axis swap
    mesh.faces = mesh.faces[:, ::-1]

    # ── Pitched roof for industrial/agricultural naves ──
    use_lower = use.lower() if use else ""
    if use_lower in _PITCHED_ROOF_USES:
        try:
            mesh = _add_pitched_roof(mesh, pitch_deg=_DEFAULT_PITCH_DEG)
            new_verts = np.asarray(mesh.vertices, dtype=np.float64)
        except Exception as roof_err:
            logger.warning("Pitched roof failed: %s", roof_err)

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
    xs = new_verts[:, 0]
    zs = new_verts[:, 2]
    x_range = xs.max() - xs.min()
    z_range = zs.max() - zs.min()
    u = (xs - xs.min()) / max(x_range, 1e-6)
    v = (zs - zs.min()) / max(z_range, 1e-6)
    uv = np.column_stack([u, v]).astype(np.float32)

    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)

    # Store metadata in mesh extras for downstream use
    if metadata:
        mesh.metadata["extras"] = metadata

    logger.info(
        "Building extruded: %d vertices, %d faces, height=%.1fm, "
        "bbox_local=[%.1f..%.1f, %.1f..%.1f, %.1f..%.1f]",
        len(mesh.vertices), len(mesh.faces), height,
        new_verts[:, 0].min(), new_verts[:, 0].max(),
        new_verts[:, 1].min(), new_verts[:, 1].max(),
        new_verts[:, 2].min(), new_verts[:, 2].max(),
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
