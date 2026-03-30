"""
Descarga de ortofoto PNOA del IGN para texturizar el terreno.

Utiliza el servicio WMS del IGN (PNOA Máxima Actualidad) para descargar
la ortofoto aérea de la zona del AOI.

Endpoint: https://www.ign.es/wms-inspire/pnoa-ma
"""

from __future__ import annotations

import logging
from pathlib import Path

import httpx
import numpy as np
import rasterio
from rasterio.transform import from_bounds

logger = logging.getLogger(__name__)

# IGN WMS — PNOA Máxima Actualidad
IGN_WMS_PNOA = "https://www.ign.es/wms-inspire/pnoa-ma"


def download_pnoa_ortho(
    bbox: tuple[float, float, float, float],
    output_path: Path,
    resolution_cm: int = 25,
    max_pixels: int = 8192,
) -> Path:
    """Descarga ortofoto PNOA para un bounding box.

    If the desired resolution exceeds the IGN WMS limit of 4096 px per request,
    the image is downloaded in tiles and stitched together locally.

    Args:
        bbox: (min_lon, min_lat, max_lon, max_lat) en EPSG:4326.
        output_path: Ruta para guardar la imagen (JPEG o GeoTIFF).
        resolution_cm: Resolución deseada en cm/px (25 = PNOA estándar).
        max_pixels: Máximo de píxeles en cualquier dimensión.

    Returns:
        Ruta al archivo descargado.
    """
    WMS_MAX = 4096  # IGN hard limit per request

    min_lon, min_lat, max_lon, max_lat = bbox

    # Calcular dimensiones del AOI en metros
    lat_mid = (min_lat + max_lat) / 2
    m_per_deg_lon = 111_320 * np.cos(np.radians(lat_mid))
    m_per_deg_lat = 110_574

    width_m = (max_lon - min_lon) * m_per_deg_lon
    height_m = (max_lat - min_lat) * m_per_deg_lat

    # Calcular píxeles según resolución deseada
    px_per_m = 100 / resolution_cm  # 25cm → 4 px/m
    width_px = int(width_m * px_per_m)
    height_px = int(height_m * px_per_m)

    # Limitar al máximo global
    if width_px > max_pixels or height_px > max_pixels:
        scale = max_pixels / max(width_px, height_px)
        width_px = int(width_px * scale)
        height_px = int(height_px * scale)
        effective_res = max(width_m / width_px, height_m / height_px) * 100
        logger.info(
            "Resolución ajustada a %.0f cm/px (max_pixels=%d)",
            effective_res, max_pixels,
        )

    logger.info(
        "Descargando PNOA: bbox=(%.4f,%.4f,%.4f,%.4f), %dx%d px",
        min_lon, min_lat, max_lon, max_lat, width_px, height_px,
    )

    # Decide tiling: split into tiles of max WMS_MAX px each
    n_cols = max(1, -(-width_px // WMS_MAX))   # ceil division
    n_rows = max(1, -(-height_px // WMS_MAX))

    from PIL import Image
    import io

    full_img = Image.new("RGB", (width_px, height_px))

    lon_range = max_lon - min_lon
    lat_range = max_lat - min_lat

    with httpx.Client(timeout=120.0) as client:
        for row in range(n_rows):
            for col in range(n_cols):
                # Pixel bounds for this tile
                x0 = col * (width_px // n_cols)
                x1 = (col + 1) * (width_px // n_cols) if col < n_cols - 1 else width_px
                y0 = row * (height_px // n_rows)
                y1 = (row + 1) * (height_px // n_rows) if row < n_rows - 1 else height_px
                tw = x1 - x0
                th = y1 - y0

                # Geographic bounds for this tile (lon grows left→right, lat grows bottom→top)
                # y0 is top of image = max_lat side
                t_min_lon = min_lon + (x0 / width_px) * lon_range
                t_max_lon = min_lon + (x1 / width_px) * lon_range
                t_max_lat = max_lat - (y0 / height_px) * lat_range
                t_min_lat = max_lat - (y1 / height_px) * lat_range

                params = {
                    "SERVICE": "WMS",
                    "VERSION": "1.3.0",
                    "REQUEST": "GetMap",
                    "LAYERS": "OI.OrthoimageCoverage",
                    "CRS": "EPSG:4326",
                    "BBOX": f"{t_min_lat},{t_min_lon},{t_max_lat},{t_max_lon}",
                    "WIDTH": str(tw),
                    "HEIGHT": str(th),
                    "FORMAT": "image/jpeg",
                    "STYLES": "",
                }

                # Retry each tile up to 3 times with backoff
                tile_ok = False
                for attempt in range(3):
                    try:
                        resp = client.get(IGN_WMS_PNOA, params=params, timeout=180.0)
                        resp.raise_for_status()

                        content_type = resp.headers.get("content-type", "")
                        if "xml" in content_type or "text" in content_type:
                            logger.error("WMS error: %s", resp.text[:500])
                            raise RuntimeError(f"WMS devolvió error: {resp.text[:200]}")

                        tile_img = Image.open(io.BytesIO(resp.content))
                        full_img.paste(tile_img, (x0, y0))
                        tile_ok = True
                        break
                    except Exception as tile_err:
                        logger.warning(
                            "  Tile %d/%d intento %d/3 falló: %s",
                            row * n_cols + col + 1, n_rows * n_cols,
                            attempt + 1, tile_err,
                        )
                        if attempt < 2:
                            import time as _time
                            _time.sleep(2 * (attempt + 1))

                if not tile_ok:
                    raise RuntimeError(
                        f"WMS tile ({row},{col}) falló tras 3 intentos "
                        f"bbox=({t_min_lat:.4f},{t_min_lon:.4f},{t_max_lat:.4f},{t_max_lon:.4f})"
                    )

                if n_cols * n_rows > 1:
                    logger.info("  Tile %d/%d descargado (%dx%d)",
                                row * n_cols + col + 1, n_rows * n_cols, tw, th)

    img_array = np.array(full_img)  # (H, W, 3) RGB

    # Guardar como GeoTIFF con georreferencia
    output_path.parent.mkdir(parents=True, exist_ok=True)

    transform = from_bounds(min_lon, min_lat, max_lon, max_lat, width_px, height_px)

    with rasterio.open(
        output_path,
        "w",
        driver="GTiff",
        width=width_px,
        height=height_px,
        count=3,
        dtype="uint8",
        crs="EPSG:4326",
        transform=transform,
        compress="jpeg",
        jpeg_quality=90,
    ) as dst:
        for band_i in range(3):
            dst.write(img_array[:, :, band_i], band_i + 1)

    size_kb = output_path.stat().st_size / 1024
    logger.info(
        "PNOA ortofoto guardada: %s (%dx%d, %.0f KB)",
        output_path, width_px, height_px, size_kb,
    )

    return output_path


def get_ortho_for_aoi(
    bbox: tuple[float, float, float, float],
    output_dir: Path,
    resolution_cm: int = 25,
    max_pixels: int = 8192,
) -> dict:
    """Descarga ortofoto PNOA y devuelve metadata.

    Returns:
        dict con 'path', 'bbox', 'width', 'height', 'resolution_cm'.
    """
    ortho_path = output_dir / "ortho_pnoa.tif"

    if ortho_path.exists():
        logger.info("Ortofoto ya descargada: %s", ortho_path)
    else:
        download_pnoa_ortho(bbox, ortho_path, resolution_cm, max_pixels)

    # Leer dimensiones del resultado
    with rasterio.open(ortho_path) as src:
        width = src.width
        height = src.height

    return {
        "path": str(ortho_path),
        "bbox": list(bbox),
        "width": width,
        "height": height,
        "resolution_cm": resolution_cm,
    }


def extract_texture_image(ortho_path: Path, output_path: Path | None = None) -> Path:
    """Extrae la ortofoto como imagen JPEG para usar como textura.

    Lee el GeoTIFF, y exporta como JPEG estándar (sin georreferencia).
    El JPEG es más ligero y compatible con glTF/B3DM como textura.

    Returns:
        Ruta al JPEG generado.
    """
    from PIL import Image

    if output_path is None:
        output_path = ortho_path.with_suffix(".jpg")

    with rasterio.open(ortho_path) as src:
        r = src.read(1)
        g = src.read(2)
        b = src.read(3)

    img = Image.fromarray(np.stack([r, g, b], axis=-1), "RGB")
    img.save(output_path, "JPEG", quality=95)

    logger.info("Textura JPEG: %s (%.0f KB)", output_path, output_path.stat().st_size / 1024)
    return output_path
