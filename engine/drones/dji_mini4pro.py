"""
DJI Mini 4 Pro — drone profile and flight planning parameters.

Specs:
  - Sensor: 1/1.3" CMOS, 48 MP (8064×6048), 9.7mm diagonal
  - Focal length: 6.72 mm (equiv 24mm)
  - FOV: 82.1°
  - Max flight time: 34 min (standard battery), 45 min (Plus battery)
  - Max wind resistance: 10.7 m/s (Level 5)
  - Weight: 249 g (below EU C0 limit)
  - MSDK V5 compatible (since March 2025)
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Camera sensor specs
SENSOR_WIDTH_MM = 9.7 * (8064 / 6048)  # ~12.93mm (4:3 aspect from 1/1.3" diagonal)
SENSOR_HEIGHT_MM = 9.7 * (6048 / 8064)  # ~7.28mm
FOCAL_LENGTH_MM = 6.72
IMAGE_WIDTH_48MP = 8064
IMAGE_HEIGHT_48MP = 6048
IMAGE_WIDTH_12MP = 4032
IMAGE_HEIGHT_12MP = 3024

# Flight constraints
MAX_FLIGHT_TIME_MIN = 34  # standard battery
MAX_FLIGHT_TIME_PLUS_MIN = 45  # Intelligent Flight Battery Plus
MAX_WIND_MS = 10.7
MAX_ALTITUDE_M = 120  # EASA EU default
WEIGHT_G = 249


@dataclass
class Mini4ProGSD:
    gsd_cm: float
    footprint_w_m: float
    footprint_h_m: float
    altitude_m: float
    megapixels: int


def compute_gsd(altitude_m: float, megapixels: int = 48) -> Mini4ProGSD:
    """Calculate ground sample distance at a given altitude.

    Args:
        altitude_m: Altitude AGL in meters.
        megapixels: 48 (max) or 12 (standard).

    Returns:
        Mini4ProGSD with GSD and footprint dimensions.
    """
    if megapixels == 48:
        img_w, img_h = IMAGE_WIDTH_48MP, IMAGE_HEIGHT_48MP
    else:
        img_w, img_h = IMAGE_WIDTH_12MP, IMAGE_HEIGHT_12MP

    gsd_m = (SENSOR_WIDTH_MM * altitude_m) / (FOCAL_LENGTH_MM * img_w)
    footprint_w = gsd_m * img_w
    footprint_h = gsd_m * img_h

    return Mini4ProGSD(
        gsd_cm=round(gsd_m * 100, 2),
        footprint_w_m=round(footprint_w, 1),
        footprint_h_m=round(footprint_h, 1),
        altitude_m=altitude_m,
        megapixels=megapixels,
    )


def estimate_flight(
    area_ha: float,
    altitude_m: float = 60.0,
    overlap: float = 80.0,
    sidelap: float = 70.0,
    speed_ms: float = 5.0,
    megapixels: int = 48,
    battery_type: str = "standard",
) -> dict:
    """Estimate photos, flight time, and batteries needed.

    Args:
        area_ha: Area in hectares.
        altitude_m: Altitude AGL.
        overlap: Forward overlap %.
        sidelap: Side overlap %.
        speed_ms: Flight speed m/s.
        megapixels: 48 or 12.
        battery_type: 'standard' or 'plus'.

    Returns:
        Dict with estimated_photos, flight_min, batteries, gsd_cm.
    """
    gsd = compute_gsd(altitude_m, megapixels)

    photo_spacing = gsd.footprint_w_m * (1 - overlap / 100)
    line_spacing = gsd.footprint_h_m * (1 - sidelap / 100)

    area_m2 = area_ha * 10_000
    side = math.sqrt(area_m2)

    n_lines = max(1, math.ceil(side / line_spacing) + 1)
    n_photos_per_line = max(1, math.ceil(side / photo_spacing) + 1)
    total_photos = n_lines * n_photos_per_line

    total_distance = n_lines * side + n_lines * line_spacing
    flight_sec = total_distance / speed_ms if speed_ms > 0 else 0
    # Add 20% overhead for turns + takeoff/landing
    flight_min = (flight_sec / 60) * 1.2

    max_time = MAX_FLIGHT_TIME_PLUS_MIN if battery_type == "plus" else MAX_FLIGHT_TIME_MIN
    # Usable time ~80% of max (reserve)
    usable_min = max_time * 0.80
    batteries = max(1, math.ceil(flight_min / usable_min))

    return {
        "gsd_cm": gsd.gsd_cm,
        "footprint_w_m": gsd.footprint_w_m,
        "footprint_h_m": gsd.footprint_h_m,
        "estimated_photos": total_photos,
        "flight_min": round(flight_min, 1),
        "batteries": batteries,
        "battery_type": battery_type,
        "max_flight_time_min": max_time,
        "line_spacing_m": round(line_spacing, 1),
        "photo_spacing_m": round(photo_spacing, 1),
        "n_lines": n_lines,
    }


# Flight planner defaults for the Mini 4 Pro
MINI4PRO_PLANNER_DEFAULTS = {
    "sensor_width_mm": SENSOR_WIDTH_MM,
    "focal_length_mm": FOCAL_LENGTH_MM,
    "image_width_px": IMAGE_WIDTH_48MP,
    "image_height_px": IMAGE_HEIGHT_48MP,
    "altitude_agl": 60.0,
    "overlap": 80.0,
    "sidelap": 70.0,
    "speed": 5.0,
}
