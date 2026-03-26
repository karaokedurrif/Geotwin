"""
Descarga de imagen RGB (color natural) Sentinel-2 desde CDSE.

Usa Sentinel Hub Process API para descargar B04+B03+B02 como PNG,
recortado al AOI, a resolución ~10m.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import httpx
import numpy as np
from PIL import Image
from shapely.geometry import shape

from .sentinel import SH_PROCESS_URL, _get_token, search_sentinel2

logger = logging.getLogger(__name__)


def get_latest_sentinel_rgb(
    aoi_geojson: dict,
    output_dir: Path,
    *,
    client_id: str | None = None,
    client_secret: str | None = None,
    max_cloud_cover: float = 20.0,
    days_back: int = 30,
) -> dict:
    """Download the latest Sentinel-2 RGB image (true color) for an AOI.

    Returns:
        dict with 'image_path', 'date', 'cloud_cover', 'resolution_m',
        'bands', 'bounds' (lon_min, lat_min, lon_max, lat_max).
    """
    client_id = client_id or os.environ.get("COPERNICUS_CLIENT_ID", "")
    client_secret = client_secret or os.environ.get("COPERNICUS_CLIENT_SECRET", "")

    if not client_id or not client_secret:
        raise RuntimeError("Copernicus credentials not configured")

    # Search for best product
    products = search_sentinel2(
        aoi_geojson,
        client_id=client_id,
        client_secret=client_secret,
        max_cloud_cover=max_cloud_cover,
        days_back=days_back,
        max_results=5,
    )

    if not products:
        # Retry with relaxed cloud cover
        products = search_sentinel2(
            aoi_geojson,
            client_id=client_id,
            client_secret=client_secret,
            max_cloud_cover=50.0,
            days_back=90,
            max_results=3,
        )
        if not products:
            raise RuntimeError(
                f"No Sentinel-2 images found with <50% clouds in last 90 days"
            )

    best = min(products, key=lambda p: p["cloud_cover"])
    date = best["date"][:10]
    logger.info(
        "Selected Sentinel-2 RGB: %s (cloud=%.1f%%)", date, best["cloud_cover"]
    )

    # Compute bbox from geometry
    geom = shape(aoi_geojson.get("geometry", aoi_geojson))
    bbox = geom.bounds  # (minx, miny, maxx, maxy)

    # Compute image dimensions at ~10m resolution
    lat_mid = (bbox[1] + bbox[3]) / 2
    width_m = (bbox[2] - bbox[0]) * 111320 * np.cos(np.radians(lat_mid))
    height_m = (bbox[3] - bbox[1]) * 110574
    width_px = max(1, int(width_m / 10))
    height_px = max(1, int(height_m / 10))

    # Cap at 2500px to avoid huge downloads
    max_dim = 2500
    if max(width_px, height_px) > max_dim:
        scale = max_dim / max(width_px, height_px)
        width_px = max(1, int(width_px * scale))
        height_px = max(1, int(height_px * scale))

    # Evalscript for RGB true color
    evalscript = """//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B03", "B02"], units: "REFLECTANCE" }],
    output: { bands: 3, sampleType: "UINT8" }
  };
}
function evaluatePixel(s) {
  // Brightness gain of 3.5 for visualization
  var gain = 3.5;
  return [
    Math.min(255, Math.max(0, Math.round(s.B04 * 255 * gain))),
    Math.min(255, Math.max(0, Math.round(s.B03 * 255 * gain))),
    Math.min(255, Math.max(0, Math.round(s.B02 * 255 * gain)))
  ];
}"""

    request_body = {
        "input": {
            "bounds": {
                "bbox": list(bbox),
                "properties": {
                    "crs": "http://www.opengis.net/def/crs/EPSG/0/4326"
                },
            },
            "data": [
                {
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "timeRange": {
                            "from": f"{date}T00:00:00Z",
                            "to": f"{date}T23:59:59Z",
                        },
                        "maxCloudCoverage": 100,
                    },
                }
            ],
        },
        "output": {
            "width": width_px,
            "height": height_px,
            "responses": [
                {"identifier": "default", "format": {"type": "image/png"}}
            ],
        },
        "evalscript": evalscript,
    }

    token = _get_token(client_id, client_secret)

    logger.info("Downloading Sentinel-2 RGB %dx%d px...", width_px, height_px)

    resp = httpx.post(
        SH_PROCESS_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "image/png",
        },
        json=request_body,
        timeout=120,
    )
    resp.raise_for_status()

    output_dir.mkdir(parents=True, exist_ok=True)
    png_path = output_dir / "sentinel_rgb.png"
    png_path.write_bytes(resp.content)

    # Write world file for georeferencing
    pgw_path = png_path.with_suffix(".pgw")
    pixel_w = (bbox[2] - bbox[0]) / width_px
    pixel_h = (bbox[3] - bbox[1]) / height_px
    pgw_path.write_text(
        f"{pixel_w}\n0.0\n0.0\n{-pixel_h}\n{bbox[0]}\n{bbox[3]}\n"
    )

    logger.info(
        "Sentinel-2 RGB saved: %s (%dx%d, %.1f KB, date=%s)",
        png_path, width_px, height_px,
        png_path.stat().st_size / 1024, date,
    )

    return {
        "image_path": str(png_path),
        "date": date,
        "cloud_cover": best["cloud_cover"],
        "resolution_m": 10,
        "bands": ["B04", "B03", "B02"],
        "bounds": list(bbox),
        "width": width_px,
        "height": height_px,
    }
