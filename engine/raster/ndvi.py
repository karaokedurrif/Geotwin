"""
Cálculo de NDVI real desde bandas Sentinel-2.

NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)

Soporta lectura de bandas desde:
- Archivos locales (GeoTIFF por banda)
- Copernicus Data Space API (descarga automática)
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import rasterio
from rasterio.mask import mask as rasterio_mask
from shapely.geometry import mapping, shape

logger = logging.getLogger(__name__)


def compute_ndvi(red_band: np.ndarray, nir_band: np.ndarray) -> np.ndarray:
    """Calcula NDVI desde bandas RED (B04) y NIR (B08).

    Returns:
        Array float32 con valores en [-1.0, 1.0]. NaN donde los datos son inválidos.
    """
    red = red_band.astype(np.float32)
    nir = nir_band.astype(np.float32)

    # Evitar división por cero
    denominator = nir + red
    ndvi = np.where(denominator > 0, (nir - red) / denominator, np.nan)

    # Limitar rango válido
    ndvi = np.clip(ndvi, -1.0, 1.0)

    return ndvi


def ndvi_from_geotiffs(
    red_path: Path,
    nir_path: Path,
    aoi_geojson: dict | None = None,
    output_path: Path | None = None,
) -> dict:
    """Calcula NDVI desde GeoTIFFs de bandas RED y NIR.

    Args:
        red_path: Ruta al GeoTIFF de banda B04 (RED).
        nir_path: Ruta al GeoTIFF de banda B08 (NIR).
        aoi_geojson: GeoJSON Feature para recortar resultado. Opcional.
        output_path: Ruta de salida para el NDVI GeoTIFF. Opcional.

    Returns:
        dict con 'ndvi' (2D array), 'transform', 'crs', 'stats'.
    """
    with rasterio.open(red_path) as red_src, rasterio.open(nir_path) as nir_src:
        if aoi_geojson:
            geom_dict = aoi_geojson.get("geometry", aoi_geojson)
            geom = shape(geom_dict)
            red_data, red_transform = rasterio_mask(red_src, [mapping(geom)], crop=True)
            nir_data, _ = rasterio_mask(nir_src, [mapping(geom)], crop=True)
            red_band = red_data[0].astype(np.float32)
            nir_band = nir_data[0].astype(np.float32)
            transform = red_transform
        else:
            red_band = red_src.read(1).astype(np.float32)
            nir_band = nir_src.read(1).astype(np.float32)
            transform = red_src.transform

        crs = str(red_src.crs)

    ndvi = compute_ndvi(red_band, nir_band)

    # Estadísticas
    valid = ~np.isnan(ndvi)
    stats = {
        "mean": float(np.nanmean(ndvi)) if valid.any() else 0.0,
        "std": float(np.nanstd(ndvi)) if valid.any() else 0.0,
        "min": float(np.nanmin(ndvi)) if valid.any() else 0.0,
        "max": float(np.nanmax(ndvi)) if valid.any() else 0.0,
        "valid_pixels": int(valid.sum()),
        "total_pixels": int(ndvi.size),
    }

    logger.info(
        "NDVI calculado: mean=%.3f, min=%.3f, max=%.3f, %d píxeles válidos",
        stats["mean"], stats["min"], stats["max"], stats["valid_pixels"],
    )

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        profile = {
            "driver": "GTiff",
            "dtype": "float32",
            "width": ndvi.shape[1],
            "height": ndvi.shape[0],
            "count": 1,
            "crs": crs,
            "transform": transform,
            "nodata": np.nan,
        }
        with rasterio.open(output_path, "w", **profile) as dst:
            dst.write(ndvi, 1)

    return {
        "ndvi": ndvi,
        "transform": transform,
        "crs": crs,
        "stats": stats,
    }


def ndvi_to_colormap(ndvi: np.ndarray) -> np.ndarray:
    """Convierte NDVI a imagen RGBA con colormap estilo vegetación.

    Colormap:
    - [-1, 0]: Marrón/gris (sin vegetación, agua, suelo)
    - [0, 0.2]: Amarillo (vegetación baja/seca)
    - [0.2, 0.5]: Verde claro
    - [0.5, 0.8]: Verde medio
    - [0.8, 1.0]: Verde oscuro (vegetación densa)

    Returns:
        Array uint8 (H, W, 4) RGBA.
    """
    h, w = ndvi.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    # Normalizar a [0, 1] para lookup
    normalized = (ndvi + 1.0) / 2.0
    normalized = np.clip(normalized, 0, 1)

    # Colores por rango
    # Sin vegetación (NDVI < 0): marrón
    mask_barren = ndvi < 0
    rgba[mask_barren] = [139, 119, 101, 180]

    # Suelo/baja (0-0.2): amarillo
    mask_low = (ndvi >= 0) & (ndvi < 0.2)
    rgba[mask_low] = [204, 187, 68, 180]

    # Media-baja (0.2-0.4): verde claro
    mask_med_low = (ndvi >= 0.2) & (ndvi < 0.4)
    rgba[mask_med_low] = [144, 190, 67, 180]

    # Media (0.4-0.6): verde
    mask_med = (ndvi >= 0.4) & (ndvi < 0.6)
    rgba[mask_med] = [76, 166, 56, 180]

    # Alta (0.6-0.8): verde oscuro
    mask_high = (ndvi >= 0.6) & (ndvi < 0.8)
    rgba[mask_high] = [32, 128, 43, 180]

    # Muy alta (>0.8): verde denso
    mask_very_high = ndvi >= 0.8
    rgba[mask_very_high] = [0, 100, 25, 200]

    # NaN = transparente
    rgba[np.isnan(ndvi)] = [0, 0, 0, 0]

    return rgba
