"""
Soporte para fincas colindantes: unión de hasta 3 parcelas catastrales.

Descarga cada parcela del WFS de Catastro, verifica colindancia y genera
un único GeoJSON Feature con el polígono unificado.
"""

from __future__ import annotations

import logging
import math

from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Transformer
from shapely.ops import transform as shapely_transform

from .refcat import fetch_parcel_by_refcat

logger = logging.getLogger(__name__)

MAX_PARCELS = 3
MAX_ADJACENCY_DISTANCE_M = 5.0


async def fetch_and_merge_parcels(
    refcats: list[str],
    srs: str = "EPSG:4326",
) -> dict:
    """Download up to 3 cadastral parcels and merge into a single polygon.

    Args:
        refcats: List of 1-3 referencia catastral strings.
        srs: Target SRS (always EPSG:4326 for output).

    Returns:
        GeoJSON Feature with the merged polygon and combined properties.

    Raises:
        ValueError: If parcels are not adjacent (>5 m apart) or too many.
        RuntimeError: If any WFS fetch fails.
    """
    if not refcats:
        raise ValueError("At least one referencia catastral is required.")
    if len(refcats) > MAX_PARCELS:
        raise ValueError(f"Maximum {MAX_PARCELS} parcels allowed, got {len(refcats)}.")

    # De-duplicate
    seen: set[str] = set()
    unique_refcats: list[str] = []
    for rc in refcats:
        rc_upper = rc.strip().upper()
        if rc_upper not in seen:
            seen.add(rc_upper)
            unique_refcats.append(rc_upper)

    if len(unique_refcats) == 1:
        # Single parcel — just return it directly
        feature = await fetch_parcel_by_refcat(unique_refcats[0], srs)
        feature["properties"]["refcats"] = unique_refcats
        feature["properties"]["merged"] = False
        return feature

    # Fetch all parcels
    features: list[dict] = []
    polygons = []
    metadata = []

    for rc in unique_refcats:
        logger.info("Fetching parcel %s for merge...", rc)
        feature = await fetch_parcel_by_refcat(rc, srs)
        features.append(feature)
        geom = shape(feature["geometry"])
        polygons.append(geom)
        metadata.append({
            "refcat": rc,
            "area_m2": feature["properties"].get("area_m2", 0),
            "area_ha": feature["properties"].get("area_ha", 0),
        })

    # Project to UTM (EPSG:25830) for accurate distance/area calculations
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:25830", always_xy=True)
    projected = [shapely_transform(to_utm.transform, p) for p in polygons]

    # Verify adjacency: all pairs must be within MAX_ADJACENCY_DISTANCE_M
    for i in range(len(projected)):
        for j in range(i + 1, len(projected)):
            dist = projected[i].distance(projected[j])
            if dist > MAX_ADJACENCY_DISTANCE_M:
                raise ValueError(
                    f"Parcels {unique_refcats[i]} and {unique_refcats[j]} are not "
                    f"adjacent (distance: {dist:.1f} m). Maximum allowed: "
                    f"{MAX_ADJACENCY_DISTANCE_M} m."
                )

    # Merge polygons (in WGS84)
    merged = unary_union(polygons)

    # Compute area of merged polygon in UTM
    merged_utm = shapely_transform(to_utm.transform, merged)
    total_area_m2 = merged_utm.area

    # Compute centroid in WGS84
    centroid = merged.centroid

    result = {
        "type": "Feature",
        "geometry": mapping(merged),
        "properties": {
            "refcats": unique_refcats,
            "parcels": metadata,
            "area_m2": total_area_m2,
            "area_ha": total_area_m2 / 10_000,
            "centroid": [centroid.x, centroid.y],
            "merged": True,
        },
    }

    logger.info(
        "Merged %d parcels: %s → %.2f ha, %d vertices",
        len(unique_refcats),
        ", ".join(unique_refcats),
        total_area_m2 / 10_000,
        len(merged.exterior.coords) if merged.geom_type == "Polygon" else sum(
            len(p.exterior.coords) for p in merged.geoms
        ),
    )

    return result


def split_large_parcel(
    polygon,
    max_block_m: float = 500,
) -> list:
    """Split a large polygon into grid blocks for parallel processing.

    Each block is a Shapely polygon representing the intersection of the
    input polygon with a max_block_m × max_block_m grid cell.

    Args:
        polygon: Shapely geometry in EPSG:4326.
        max_block_m: Maximum block side length in meters.

    Returns:
        List of Shapely polygons (blocks) that cover the input polygon.
    """
    from shapely.geometry import box as shapely_box

    # Project to UTM for metric grid
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:25830", always_xy=True)
    to_wgs = Transformer.from_crs("EPSG:25830", "EPSG:4326", always_xy=True)

    poly_utm = shapely_transform(to_utm.transform, polygon)
    minx, miny, maxx, maxy = poly_utm.bounds

    blocks = []
    x = minx
    while x < maxx:
        y = miny
        while y < maxy:
            cell = shapely_box(x, y, x + max_block_m, y + max_block_m)
            intersection = poly_utm.intersection(cell)
            if not intersection.is_empty and intersection.area > 1.0:
                # Convert back to WGS84
                block_wgs = shapely_transform(to_wgs.transform, intersection)
                blocks.append(block_wgs)
            y += max_block_m
        x += max_block_m

    logger.info(
        "Split polygon (%.0f m²) into %d blocks of max %d m",
        poly_utm.area,
        len(blocks),
        max_block_m,
    )

    return blocks
