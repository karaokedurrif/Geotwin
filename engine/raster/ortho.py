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
                    "FORMAT": "image/png",
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
        compress="deflate",
        predictor=2,
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

    Aplica un buffer al bbox (20% o mínimo 50m por lado) para evitar
    bordes negros y artefactos de interpolación en la textura.

    Returns:
        dict con 'path', 'bbox' (buffered), 'width', 'height', 'resolution_cm'.
    """
    # ── Expand bbox: 20% or 50m minimum per side ──
    min_lon, min_lat, max_lon, max_lat = bbox
    lat_mid = (min_lat + max_lat) / 2
    m_per_deg_lon = 111_320 * np.cos(np.radians(lat_mid))
    m_per_deg_lat = 110_574

    width_m = (max_lon - min_lon) * m_per_deg_lon
    height_m = (max_lat - min_lat) * m_per_deg_lat

    buf_m_x = max(width_m * 0.20, 50.0)
    buf_m_y = max(height_m * 0.20, 50.0)

    buf_deg_lon = buf_m_x / m_per_deg_lon
    buf_deg_lat = buf_m_y / m_per_deg_lat

    buffered_bbox = (
        min_lon - buf_deg_lon,
        min_lat - buf_deg_lat,
        max_lon + buf_deg_lon,
        max_lat + buf_deg_lat,
    )
    logger.info(
        "Bbox buffer: +%.0fm x +%.0fm (original %.0fx%.0fm)",
        buf_m_x, buf_m_y, width_m, height_m,
    )

    ortho_path = output_dir / "ortho_pnoa.tif"

    if ortho_path.exists():
        logger.info("Ortofoto ya descargada: %s", ortho_path)
    else:
        download_pnoa_ortho(buffered_bbox, ortho_path, resolution_cm, max_pixels)

    # Leer dimensiones del resultado
    with rasterio.open(ortho_path) as src:
        width = src.width
        height = src.height

    return {
        "path": str(ortho_path),
        "bbox": list(buffered_bbox),
        "width": width,
        "height": height,
        "resolution_cm": resolution_cm,
    }


def extract_texture_image(
    ortho_path: Path,
    output_path: Path | None = None,
    *,
    fmt: str = "PNG",
) -> Path:
    """Extrae la ortofoto como imagen para usar como textura GLB.

    Lee el GeoTIFF y exporta como PNG (lossless, default) o JPEG.
    PNG evita artefactos de compresión en parcelas pequeñas.

    Args:
        ortho_path: Ruta al GeoTIFF de entrada.
        output_path: Ruta de salida (auto-genera si None).
        fmt: 'PNG' (lossless, recomendado <1 ha) o 'JPEG'.

    Returns:
        Ruta a la imagen generada.
    """
    from PIL import Image

    fmt = fmt.upper()
    ext = ".png" if fmt == "PNG" else ".jpg"

    if output_path is None:
        output_path = ortho_path.with_suffix(ext)

    with rasterio.open(ortho_path) as src:
        r = src.read(1)
        g = src.read(2)
        b = src.read(3)

    img = Image.fromarray(np.stack([r, g, b], axis=-1), "RGB")
    if fmt == "PNG":
        img.save(output_path, "PNG", optimize=True)
    else:
        img.save(output_path, "JPEG", quality=95)

    logger.info("Textura %s: %s (%.0f KB)", fmt, output_path, output_path.stat().st_size / 1024)
    return output_path


def cap_texture_size(
    texture_path: Path,
    area_ha: float,
    *,
    force_max_px: int | None = None,
) -> Path:
    """Resize texture to a cap based on parcel area to avoid VRAM saturation.

    Size caps:
    - < 1 ha  → 2048 px (2K) — small parcel, high detail per pixel
    - < 10 ha → 4096 px (4K) — medium
    - < 100 ha → 4096 px (4K) — still manageable
    - ≥ 100 ha → 2048 px (2K) — large area, 2K is sufficient for terrain overview

    For RTX 5080 (16GB VRAM) users can request 8K via force_max_px=8192.

    Args:
        texture_path: Path to the texture image.
        area_ha: Parcel area in hectares.
        force_max_px: Override the automatic cap (e.g., 8192 for RTX 5080).

    Returns:
        Path to the (possibly resized) texture.
    """
    from PIL import Image

    if force_max_px:
        max_px = force_max_px
    elif area_ha < 1:
        max_px = 2048
    elif area_ha < 100:
        max_px = 4096
    else:
        max_px = 2048  # Large parcels: 2K is sufficient for vineyard-scale terrain

    img = Image.open(texture_path)
    w, h = img.size

    if max(w, h) <= max_px:
        logger.info("Texture %dx%d already within %d cap", w, h, max_px)
        return texture_path

    # Resize preserving aspect ratio
    scale = max_px / max(w, h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    img_resized = img.resize((new_w, new_h), Image.LANCZOS)

    # Overwrite the original texture (same format)
    fmt = "PNG" if texture_path.suffix.lower() == ".png" else "JPEG"
    if fmt == "PNG":
        img_resized.save(texture_path, "PNG", optimize=True)
    else:
        img_resized.save(texture_path, "JPEG", quality=95)

    old_kb = (w * h * 3) / 1024  # rough uncompressed estimate
    new_kb = (new_w * new_h * 3) / 1024
    logger.info(
        "Texture capped: %dx%d → %dx%d (cap=%d, VRAM saving ~%.0f KB)",
        w, h, new_w, new_h, max_px, old_kb - new_kb,
    )
    return texture_path


def crop_texture_to_mesh_bbox(
    texture_path: Path,
    ortho_bbox: tuple[float, float, float, float],
    mesh_bbox: tuple[float, float, float, float],
) -> Path:
    """Crop texture image to the mesh's geographic extent.

    The downloaded ortho covers a buffered bbox larger than the mesh.
    This crops the texture to match the mesh bounds exactly so UV
    mapping to [0,1] uses 100 % of the texture pixels.

    Args:
        texture_path: Path to the full texture image (PNG/JPEG).
        ortho_bbox: (min_lon, min_lat, max_lon, max_lat) of the ortho download.
        mesh_bbox: (min_lon, min_lat, max_lon, max_lat) of the mesh vertices.

    Returns:
        Path to the cropped texture (overwrites the input file).
    """
    from PIL import Image

    o_min_lon, o_min_lat, o_max_lon, o_max_lat = ortho_bbox
    m_min_lon, m_min_lat, m_max_lon, m_max_lat = mesh_bbox

    o_lon_range = o_max_lon - o_min_lon
    o_lat_range = o_max_lat - o_min_lat

    if o_lon_range <= 0 or o_lat_range <= 0:
        logger.warning("Invalid ortho bbox for crop, skipping")
        return texture_path

    img = Image.open(texture_path)
    w, h = img.size

    # Geographic → pixel coordinates (image y-axis is inverted: top=0)
    x_min = int(((m_min_lon - o_min_lon) / o_lon_range) * w)
    x_max = int(((m_max_lon - o_min_lon) / o_lon_range) * w)
    y_min = int((1.0 - (m_max_lat - o_min_lat) / o_lat_range) * h)
    y_max = int((1.0 - (m_min_lat - o_min_lat) / o_lat_range) * h)

    # Clamp to image bounds
    x_min = max(0, x_min)
    x_max = min(w, x_max)
    y_min = max(0, y_min)
    y_max = min(h, y_max)

    if x_max <= x_min or y_max <= y_min:
        logger.warning("Crop region empty (%d,%d → %d,%d), skipping", x_min, y_min, x_max, y_max)
        return texture_path

    cropped = img.crop((x_min, y_min, x_max, y_max))

    logger.info(
        "Texture cropped to mesh bbox: %dx%d → %dx%d (was using %.0f%%×%.0f%%)",
        w, h, cropped.size[0], cropped.size[1],
        (x_max - x_min) / w * 100, (y_max - y_min) / h * 100,
    )

    fmt = "PNG" if texture_path.suffix.lower() == ".png" else "JPEG"
    if fmt == "PNG":
        cropped.save(texture_path, "PNG", optimize=True)
    else:
        cropped.save(texture_path, "JPEG", quality=95)

    return texture_path


def download_hires_crop(
    center_lon: float,
    center_lat: float,
    radius_m: float,
    output_path: Path,
    target_px: int = 4096,
) -> Path:
    """Download a high-resolution PNOA ortho crop for a small area.

    Used to create a 4K texture inset around buildings where extra
    sharpness is needed.  The crop is downloaded in a single WMS
    request (small enough for the 4096 limit).

    Args:
        center_lon, center_lat: Center of the crop in EPSG:4326.
        radius_m: Radius in meters around the center.
        output_path: Where to save the GeoTIFF.
        target_px: Target resolution in pixels per side.

    Returns:
        Path to the downloaded GeoTIFF crop.
    """
    m_per_deg_lon = 111_320 * np.cos(np.radians(center_lat))
    m_per_deg_lat = 110_574

    buf_lon = radius_m / m_per_deg_lon
    buf_lat = radius_m / m_per_deg_lat

    crop_bbox = (
        center_lon - buf_lon,
        center_lat - buf_lat,
        center_lon + buf_lon,
        center_lat + buf_lat,
    )

    # Resolution: 200m diameter at 4096px → ~5cm/px
    effective_cm = (2 * radius_m * 100) / target_px
    logger.info(
        "Hi-res crop: center=(%.6f,%.6f) radius=%dm, %dpx → %.1f cm/px",
        center_lon, center_lat, radius_m, target_px, effective_cm,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    download_pnoa_ortho(crop_bbox, output_path, resolution_cm=max(5, int(effective_cm)), max_pixels=target_px)
    return output_path


def composite_hires_inset(
    main_texture_path: Path,
    main_bbox: tuple[float, float, float, float],
    hires_path: Path,
    hires_bbox: tuple[float, float, float, float],
) -> Path:
    """Paste a high-resolution inset onto the main texture.

    Calculates the pixel region in the main texture that corresponds
    to the hi-res crop's geographic extent and pastes the crop (resized
    to match) over it.  This gives the building zone 4K detail without
    needing a multi-material GLB.

    Args:
        main_texture_path: Path to the main texture image (PNG/JPEG).
        main_bbox: Geographic bbox of the main texture (minlon,minlat,maxlon,maxlat).
        hires_path: Path to the hi-res GeoTIFF crop.
        hires_bbox: Geographic bbox of the crop.

    Returns:
        Path to the composited texture (overwrites main_texture_path).
    """
    from PIL import Image

    main_img = Image.open(main_texture_path)
    mw, mh = main_img.size

    m_minlon, m_minlat, m_maxlon, m_maxlat = main_bbox
    h_minlon, h_minlat, h_maxlon, h_maxlat = hires_bbox

    # Pixel coordinates of the hires region within the main image
    # Note: image Y=0 is top = max_lat
    lon_range = m_maxlon - m_minlon
    lat_range = m_maxlat - m_minlat

    px_left = int(((h_minlon - m_minlon) / lon_range) * mw)
    px_right = int(((h_maxlon - m_minlon) / lon_range) * mw)
    px_top = int(((m_maxlat - h_maxlat) / lat_range) * mh)
    px_bottom = int(((m_maxlat - h_minlat) / lat_range) * mh)

    # Clamp to image bounds
    px_left = max(0, px_left)
    px_right = min(mw, px_right)
    px_top = max(0, px_top)
    px_bottom = min(mh, px_bottom)

    paste_w = px_right - px_left
    paste_h = px_bottom - px_top

    if paste_w < 10 or paste_h < 10:
        logger.warning("Hi-res inset too small to paste (%dx%d), skipping", paste_w, paste_h)
        return main_texture_path

    # Load hi-res crop
    with rasterio.open(hires_path) as src:
        r = src.read(1)
        g = src.read(2)
        b = src.read(3)
    hires_img = Image.fromarray(np.stack([r, g, b], axis=-1), "RGB")

    # Resize to match the paste region
    hires_resized = hires_img.resize((paste_w, paste_h), Image.LANCZOS)
    main_img.paste(hires_resized, (px_left, px_top))
    main_img.save(main_texture_path)

    logger.info(
        "Hi-res inset composited: %dx%d crop → (%d,%d)-(%d,%d) in %dx%d main texture",
        hires_img.size[0], hires_img.size[1],
        px_left, px_top, px_right, px_bottom, mw, mh,
    )
    return main_texture_path
