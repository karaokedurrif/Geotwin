"""
Flight planner — calculate grid/crosshatch waypoints over an AOI polygon.
"""
from __future__ import annotations

import math
import uuid
from typing import Any

from .models import FlightPlan, FlightPlanType


def plan_grid_flight(
    aoi_geojson: dict[str, Any],
    altitude_agl: float = 80.0,
    overlap: float = 75.0,
    sidelap: float = 65.0,
    speed: float = 8.0,
    sensor_width_mm: float = 13.2,
    focal_length_mm: float = 8.8,
    image_width_px: int = 5472,
    image_height_px: int = 3648,
    plan_type: FlightPlanType = FlightPlanType.GRID,
) -> FlightPlan:
    """
    Generate a grid or crosshatch flight plan over a GeoJSON polygon.

    Returns a FlightPlan with waypoints, estimated duration, photo count, and GSD.
    """
    # Extract bounding box from AOI
    bbox = _geojson_bbox(aoi_geojson)
    if not bbox:
        return FlightPlan(aoi_geojson=aoi_geojson)

    west, south, east, north = bbox

    # Calculate GSD (ground sample distance) in cm/px
    gsd_m = (sensor_width_mm * altitude_agl) / (focal_length_mm * image_width_px)
    gsd_cm = gsd_m * 100

    # Footprint on ground (meters)
    footprint_w = gsd_m * image_width_px  # width along track
    footprint_h = gsd_m * image_height_px  # height across track

    # Line spacing (across-track) based on sidelap
    line_spacing = footprint_h * (1 - sidelap / 100)
    # Photo spacing (along-track) based on overlap
    photo_spacing = footprint_w * (1 - overlap / 100)

    # Convert bbox dimensions to meters (approximate at latitude)
    lat_mid = (south + north) / 2
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(lat_mid))

    width_m = (east - west) * m_per_deg_lon
    height_m = (north - south) * m_per_deg_lat

    # Number of flight lines
    n_lines = max(1, int(math.ceil(height_m / line_spacing)) + 1)
    # Number of photos per line
    n_photos_per_line = max(1, int(math.ceil(width_m / photo_spacing)) + 1)

    # Generate waypoints (grid pattern with serpentine)
    waypoints: list[list[float]] = []
    lat_step = (north - south) / max(n_lines - 1, 1)

    for i in range(n_lines):
        lat = south + i * lat_step
        if i % 2 == 0:
            # West to east
            waypoints.append([west, lat, altitude_agl])
            waypoints.append([east, lat, altitude_agl])
        else:
            # East to west (serpentine)
            waypoints.append([east, lat, altitude_agl])
            waypoints.append([west, lat, altitude_agl])

    # Crosshatch: add perpendicular lines
    if plan_type == FlightPlanType.CROSSHATCH:
        n_cols = max(1, int(math.ceil(width_m / line_spacing)) + 1)
        lon_step = (east - west) / max(n_cols - 1, 1)
        for j in range(n_cols):
            lon = west + j * lon_step
            if j % 2 == 0:
                waypoints.append([lon, south, altitude_agl])
                waypoints.append([lon, north, altitude_agl])
            else:
                waypoints.append([lon, north, altitude_agl])
                waypoints.append([lon, south, altitude_agl])

    # Estimate total flight distance and duration
    total_distance_m = 0.0
    for k in range(1, len(waypoints)):
        dx = (waypoints[k][0] - waypoints[k - 1][0]) * m_per_deg_lon
        dy = (waypoints[k][1] - waypoints[k - 1][1]) * m_per_deg_lat
        total_distance_m += math.sqrt(dx * dx + dy * dy)

    duration_min = (total_distance_m / speed) / 60 if speed > 0 else 0
    total_photos = n_lines * n_photos_per_line
    if plan_type == FlightPlanType.CROSSHATCH:
        total_photos *= 2

    return FlightPlan(
        type=plan_type,
        altitude_agl=altitude_agl,
        overlap=overlap,
        sidelap=sidelap,
        speed=speed,
        gsd=round(gsd_cm, 2),
        aoi_geojson=aoi_geojson,
        estimated_duration_min=round(duration_min, 1),
        estimated_photos=total_photos,
        waypoints=waypoints,
    )


def _geojson_bbox(geojson: dict[str, Any]) -> tuple[float, float, float, float] | None:
    """Extract bounding box [west, south, east, north] from GeoJSON."""
    geometry = geojson.get("geometry") or (geojson.get("features", [{}])[0].get("geometry") if geojson.get("features") else None)
    if not geometry:
        return None

    coords = geometry.get("coordinates", [])
    if geometry["type"] == "Polygon":
        ring = coords[0]
    elif geometry["type"] == "MultiPolygon":
        ring = coords[0][0]
    else:
        return None

    west = min(c[0] for c in ring)
    east = max(c[0] for c in ring)
    south = min(c[1] for c in ring)
    north = max(c[1] for c in ring)

    return (west, south, east, north)
