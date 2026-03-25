"""
DJI image importer — extract GPS, camera metadata from DJI drone images.
Uses EXIF and XMP metadata.
"""
from __future__ import annotations

import json
import os
import re
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class DJIImageMeta:
    filepath: str
    latitude: float
    longitude: float
    altitude_abs: float
    altitude_rel: float
    heading: float
    pitch: float
    roll: float
    camera_model: str
    focal_length_mm: float
    image_width: int
    image_height: int
    timestamp: str


def parse_dji_images(folder: str | Path) -> list[DJIImageMeta]:
    """
    Scan a folder for DJI drone images and extract geospatial metadata.
    Supports JPEG with EXIF/XMP (DJI Phantom, Mavic, Matrice, etc).
    """
    folder = Path(folder)
    results: list[DJIImageMeta] = []

    for f in sorted(folder.glob("*")):
        if f.suffix.lower() not in (".jpg", ".jpeg", ".tif", ".tiff", ".dng"):
            continue
        meta = _parse_single(f)
        if meta:
            results.append(meta)

    return results


def parse_dji_images_to_geojson(folder: str | Path) -> dict[str, Any]:
    """Parse DJI images and return a GeoJSON FeatureCollection of photo positions."""
    images = parse_dji_images(folder)
    features = []
    for img in images:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [img.longitude, img.latitude, img.altitude_abs],
            },
            "properties": {
                "file": os.path.basename(img.filepath),
                "altitude_rel": img.altitude_rel,
                "heading": img.heading,
                "pitch": img.pitch,
                "camera": img.camera_model,
                "focal_length_mm": img.focal_length_mm,
                "timestamp": img.timestamp,
            },
        })
    return {"type": "FeatureCollection", "features": features}


def _parse_single(filepath: Path) -> DJIImageMeta | None:
    """Extract metadata from a single DJI image via EXIF + XMP."""
    try:
        from PIL import Image
        from PIL.ExifTags import TAGS, GPSTAGS
    except ImportError:
        return _parse_xmp_fallback(filepath)

    try:
        img = Image.open(filepath)
    except Exception:
        return None

    exif_data = img._getexif()
    if not exif_data:
        return _parse_xmp_fallback(filepath)

    # Build friendly dict
    exif: dict[str, Any] = {}
    for tag_id, value in exif_data.items():
        tag = TAGS.get(tag_id, tag_id)
        exif[tag] = value

    # GPS info
    gps_info = exif.get("GPSInfo", {})
    gps: dict[str, Any] = {}
    for k, v in gps_info.items():
        gps[GPSTAGS.get(k, k)] = v

    lat = _gps_to_decimal(gps.get("GPSLatitude"), gps.get("GPSLatitudeRef"))
    lon = _gps_to_decimal(gps.get("GPSLongitude"), gps.get("GPSLongitudeRef"))
    alt = float(gps.get("GPSAltitude", 0))

    # Camera info
    camera = str(exif.get("Model", "unknown"))
    focal = float(exif.get("FocalLength", 0))
    w, h = img.size
    timestamp = str(exif.get("DateTimeOriginal", ""))

    # DJI XMP for relative altitude, heading, pitch, roll
    xmp = _extract_xmp(filepath)

    return DJIImageMeta(
        filepath=str(filepath),
        latitude=lat or 0,
        longitude=lon or 0,
        altitude_abs=alt,
        altitude_rel=xmp.get("RelativeAltitude", 0),
        heading=xmp.get("GimbalYawDegree", xmp.get("FlightYawDegree", 0)),
        pitch=xmp.get("GimbalPitchDegree", 0),
        roll=xmp.get("GimbalRollDegree", 0),
        camera_model=camera,
        focal_length_mm=focal,
        image_width=w,
        image_height=h,
        timestamp=timestamp,
    )


def _parse_xmp_fallback(filepath: Path) -> DJIImageMeta | None:
    """Fallback parser using only XMP when Pillow is not available."""
    xmp = _extract_xmp(filepath)
    if not xmp:
        return None

    lat = xmp.get("GpsLatitude") or xmp.get("Latitude", 0)
    lon = xmp.get("GpsLongtitude") or xmp.get("GpsLongitude") or xmp.get("Longitude", 0)

    return DJIImageMeta(
        filepath=str(filepath),
        latitude=float(lat),
        longitude=float(lon),
        altitude_abs=xmp.get("AbsoluteAltitude", 0),
        altitude_rel=xmp.get("RelativeAltitude", 0),
        heading=xmp.get("GimbalYawDegree", xmp.get("FlightYawDegree", 0)),
        pitch=xmp.get("GimbalPitchDegree", 0),
        roll=xmp.get("GimbalRollDegree", 0),
        camera_model="unknown",
        focal_length_mm=0,
        image_width=0,
        image_height=0,
        timestamp="",
    )


def _extract_xmp(filepath: Path) -> dict[str, float]:
    """Extract DJI XMP metadata from image file."""
    result: dict[str, float] = {}
    try:
        with open(filepath, "rb") as f:
            data = f.read(min(65536, os.path.getsize(filepath)))
    except Exception:
        return result

    text = data.decode("latin-1", errors="ignore")

    # DJI XMP tags
    patterns = {
        "RelativeAltitude": r'drone-dji:RelativeAltitude="([^"]+)"',
        "AbsoluteAltitude": r'drone-dji:AbsoluteAltitude="([^"]+)"',
        "GimbalYawDegree": r'drone-dji:GimbalYawDegree="([^"]+)"',
        "GimbalPitchDegree": r'drone-dji:GimbalPitchDegree="([^"]+)"',
        "GimbalRollDegree": r'drone-dji:GimbalRollDegree="([^"]+)"',
        "FlightYawDegree": r'drone-dji:FlightYawDegree="([^"]+)"',
        "GpsLatitude": r'drone-dji:GpsLatitude="([^"]+)"',
        "GpsLongtitude": r'drone-dji:GpsLongtitude="([^"]+)"',
        "GpsLongitude": r'drone-dji:GpsLongitude="([^"]+)"',
    }

    for key, pattern in patterns.items():
        m = re.search(pattern, text)
        if m:
            try:
                result[key] = float(m.group(1).replace("+", ""))
            except ValueError:
                pass

    return result


def _gps_to_decimal(
    coords: tuple | None,
    ref: str | None,
) -> float | None:
    """Convert EXIF GPS coordinates (degrees, minutes, seconds) to decimal."""
    if not coords or not ref:
        return None
    d, m, s = [float(c) for c in coords]
    decimal = d + m / 60 + s / 3600
    if ref in ("S", "W"):
        decimal = -decimal
    return decimal
