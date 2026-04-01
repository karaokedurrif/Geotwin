"""
Ingestión de DEM — Lectura, recorte por AOI, reproyección.

Soporta GeoTIFF (MDT05/MDT02 del IGN, Copernicus DEM).
Descarga automática desde WCS del IGN si no hay archivo local.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.mask import mask as rasterio_mask
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, calculate_default_transform, reproject
from shapely.geometry import box, mapping, shape

logger = logging.getLogger(__name__)

# ─── Descarga WCS del IGN ────────────────────────────────────────────────────

IGN_WCS_MDT = "https://servicios.idee.es/wcs-inspire/mdt"
IGN_WCS_COVERAGE = {
    "mdt05": "Elevacion4258_5",
    "mdt02": "Elevacion4258_5",  # MDT02 no existe en WCS; fallback a MDT05 (5m)
    "mdt25": "Elevacion4258_25",
}


def download_dem_ign(
    bbox: tuple[float, float, float, float],
    output_path: Path,
    coverage: str = "mdt05",
    resolution_m: float = 5.0,
) -> Path:
    """Descarga un recorte DEM del WCS del IGN.

    Args:
        bbox: (minlon, minlat, maxlon, maxlat) en EPSG:4326.
        output_path: Ruta de salida para el GeoTIFF.
        coverage: Tipo de cobertura ('mdt05' o 'mdt02').
        resolution_m: Resolución deseada en metros.

    Returns:
        Ruta al archivo GeoTIFF descargado.
    """
    import httpx

    coverage_id = IGN_WCS_COVERAGE.get(coverage, IGN_WCS_COVERAGE["mdt05"])
    minlon, minlat, maxlon, maxlat = bbox

    # Calcular tamaño en píxeles a partir de la resolución
    # Grado ≈ 111km en latitud, ≈ 111km * cos(lat) en longitud
    lat_mid = (minlat + maxlat) / 2
    deg_per_m_lat = 1.0 / 111_320
    deg_per_m_lon = 1.0 / (111_320 * np.cos(np.radians(lat_mid)))

    width = int((maxlon - minlon) / (resolution_m * deg_per_m_lon))
    height = int((maxlat - minlat) / (resolution_m * deg_per_m_lat))

    # Limitar a tamaño razonable
    width = min(max(width, 10), 4096)
    height = min(max(height, 10), 4096)

    params = {
        "service": "WCS",
        "version": "2.0.1",
        "request": "GetCoverage",
        "CoverageId": coverage_id,
        "subset": f"Lat({minlat},{maxlat})",
        "subsety": f"Long({minlon},{maxlon})",
        "format": "image/tiff",
        "SCALESIZE": f"x({width}),y({height})",
    }

    # Alternativa más compatible: usar subsets separados
    url = (
        f"{IGN_WCS_MDT}?service=WCS&version=2.0.1&request=GetCoverage"
        f"&CoverageId={coverage_id}"
        f"&subset=Lat({minlat},{maxlat})"
        f"&subset=Long({minlon},{maxlon})"
        f"&format=image/tiff"
    )

    logger.info("Descargando DEM del IGN: %s (%dx%d px)", coverage, width, height)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with httpx.Client(timeout=120.0) as client:
        response = client.get(url)
        response.raise_for_status()

        content_type = response.headers.get("content-type", "")
        if "xml" in content_type.lower():
            msg = f"IGN WCS devolvió XML en vez de GeoTIFF: {response.text[:500]}"
            raise RuntimeError(msg)

        output_path.write_bytes(response.content)

    logger.info("DEM guardado: %s (%.1f KB)", output_path, len(response.content) / 1024)
    return output_path


# ─── Lectura y recorte ───────────────────────────────────────────────────────


def load_dem(dem_path: Path) -> dict[str, Any]:
    """Lee un GeoTIFF DEM y devuelve array + metadatos.

    Returns:
        dict con keys: 'elevation' (2D ndarray), 'transform', 'crs',
        'bounds', 'resolution', 'nodata'.
    """
    with rasterio.open(dem_path) as src:
        elevation = src.read(1).astype(np.float32)
        nodata = src.nodata

        # Reemplazar nodata por NaN
        if nodata is not None:
            elevation[elevation == nodata] = np.nan

        return {
            "elevation": elevation,
            "transform": src.transform,
            "crs": str(src.crs),
            "bounds": src.bounds,
            "resolution": src.res,
            "nodata": nodata,
            "width": src.width,
            "height": src.height,
            "profile": src.profile.copy(),
        }


def crop_dem_by_aoi(
    dem_path: Path,
    aoi_geojson: dict,
    output_path: Path | None = None,
    buffer_m: float = 100.0,
) -> dict[str, Any]:
    """Recorta un DEM por la geometría del AOI con buffer.

    Args:
        dem_path: Ruta al GeoTIFF del DEM.
        aoi_geojson: GeoJSON Feature o Geometry del AOI (EPSG:4326).
        output_path: Si se proporciona, guarda el recorte.
        buffer_m: Buffer en metros alrededor del AOI.

    Returns:
        dict con elevation array recortado + metadatos.
    """
    # Extraer geometría
    geom_dict = aoi_geojson.get("geometry", aoi_geojson)
    geom = shape(geom_dict)

    with rasterio.open(dem_path) as src:
        # Si el DEM no está en EPSG:4326, reproyectar el AOI al CRS del DEM
        if src.crs and str(src.crs) != "EPSG:4326":
            transformer = Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
            from shapely import ops
            geom = ops.transform(transformer.transform, geom)

        # Aplicar buffer (en unidades del CRS)
        if buffer_m > 0:
            # Buffer aproximado: convertir metros a grados si es 4326
            if str(src.crs) == "EPSG:4326":
                buffer_deg = buffer_m / 111_320
                geom = geom.buffer(buffer_deg)
            else:
                geom = geom.buffer(buffer_m)

        # Recortar
        cropped, cropped_transform = rasterio_mask(
            src, [mapping(geom)], crop=True, nodata=src.nodata or -9999
        )

        elevation = cropped[0].astype(np.float32)
        nodata = src.nodata or -9999
        elevation[elevation == nodata] = np.nan

        profile = src.profile.copy()
        profile.update(
            height=elevation.shape[0],
            width=elevation.shape[1],
            transform=cropped_transform,
        )

        # Guardar si se pide
        if output_path:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with rasterio.open(output_path, "w", **profile) as dst:
                dst.write(elevation, 1)
            logger.info("DEM recortado guardado: %s", output_path)

        return {
            "elevation": elevation,
            "transform": cropped_transform,
            "crs": str(src.crs),
            "bounds": rasterio.transform.array_bounds(
                elevation.shape[0], elevation.shape[1], cropped_transform
            ),
            "resolution": src.res,
            "nodata": nodata,
            "width": elevation.shape[1],
            "height": elevation.shape[0],
            "profile": profile,
        }


def reproject_dem(
    dem_data: dict[str, Any],
    target_crs: str = "EPSG:4326",
    output_path: Path | None = None,
) -> dict[str, Any]:
    """Reproyecta un DEM a otro CRS.

    Args:
        dem_data: dict devuelto por load_dem() o crop_dem_by_aoi().
        target_crs: CRS de destino.
        output_path: Si se proporciona, guarda el resultado.

    Returns:
        dict con elevation reproyectado + metadatos actualizados.
    """
    src_crs = dem_data["crs"]
    if src_crs == target_crs:
        return dem_data

    elevation = dem_data["elevation"]
    src_transform = dem_data["transform"]
    height, width = elevation.shape

    dst_transform, dst_width, dst_height = calculate_default_transform(
        src_crs, target_crs, width, height,
        *rasterio.transform.array_bounds(height, width, src_transform),
    )

    dst_elevation = np.empty((dst_height, dst_width), dtype=np.float32)
    dst_elevation.fill(np.nan)

    reproject(
        source=elevation,
        destination=dst_elevation,
        src_transform=src_transform,
        src_crs=src_crs,
        dst_transform=dst_transform,
        dst_crs=target_crs,
        resampling=Resampling.bilinear,
    )

    profile = dem_data["profile"].copy()
    profile.update(
        crs=target_crs,
        transform=dst_transform,
        width=dst_width,
        height=dst_height,
    )

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(output_path, "w", **profile) as dst:
            dst.write(dst_elevation, 1)

    return {
        "elevation": dst_elevation,
        "transform": dst_transform,
        "crs": target_crs,
        "bounds": rasterio.transform.array_bounds(dst_height, dst_width, dst_transform),
        "resolution": (abs(dst_transform.e), abs(dst_transform.a)),
        "nodata": dem_data["nodata"],
        "width": dst_width,
        "height": dst_height,
        "profile": profile,
    }


def upsample_dem_bicubic(
    dem_data: dict[str, Any],
    target_resolution_m: float = 2.0,
) -> dict[str, Any]:
    """Upsample a DEM grid using bicubic interpolation.

    Takes a coarse DEM (e.g. 5m/px from IGN WCS) and resamples it to a
    finer grid using scipy's bicubic interpolation (order=3).  This
    creates a smoother surface for terrain meshing without requiring a
    higher-resolution DEM source.

    Args:
        dem_data: dict from load_dem / crop_dem_by_aoi / get_dem_for_aoi.
        target_resolution_m: Desired output resolution in meters.

    Returns:
        New dem_data dict with upsampled elevation grid and updated
        transform/dimensions.
    """
    from scipy.ndimage import zoom

    elevation = dem_data["elevation"]
    transform = dem_data["transform"]
    src_res_y = abs(transform.e) * 111_320  # approx m/px in latitude
    src_res_x = abs(transform.a) * 111_320 * np.cos(
        np.radians((dem_data["bounds"][1] + dem_data["bounds"][3]) / 2)
    )
    src_res = (src_res_y + src_res_x) / 2.0

    if src_res <= target_resolution_m * 1.1:
        logger.info(
            "DEM already at %.1fm — skipping bicubic upsample (target=%.1fm)",
            src_res, target_resolution_m,
        )
        return dem_data

    factor = src_res / target_resolution_m
    logger.info(
        "Bicubic DEM upsample: %.1fm → %.1fm (factor=%.2fx, %dx%d → %dx%d)",
        src_res, target_resolution_m, factor,
        elevation.shape[1], elevation.shape[0],
        int(elevation.shape[1] * factor), int(elevation.shape[0] * factor),
    )

    # Handle NaN: replace with nearest-neighbor fill before interpolation,
    # then restore NaN positions at the upsampled resolution.
    nan_mask = np.isnan(elevation)
    has_nan = nan_mask.any()
    if has_nan:
        from scipy.ndimage import distance_transform_edt
        ind = distance_transform_edt(nan_mask, return_distances=False, return_indices=True)
        elevation_filled = elevation[tuple(ind)]
    else:
        elevation_filled = elevation

    upsampled = zoom(elevation_filled, factor, order=3).astype(np.float32)

    if has_nan:
        nan_upsampled = zoom(nan_mask.astype(np.float32), factor, order=0) > 0.5
        upsampled[nan_upsampled] = np.nan

    # Update the affine transform to reflect the finer grid
    new_a = transform.a / factor
    new_e = transform.e / factor
    new_transform = rasterio.transform.Affine(
        new_a, transform.b, transform.c,
        transform.d, new_e, transform.f,
    )

    new_h, new_w = upsampled.shape
    profile = dem_data["profile"].copy()
    profile.update(height=new_h, width=new_w, transform=new_transform)

    logger.info(
        "Bicubic upsample complete: %dx%d → %dx%d (%.0f%% more points)",
        elevation.shape[1], elevation.shape[0], new_w, new_h,
        100 * (new_w * new_h) / (elevation.shape[0] * elevation.shape[1]) - 100,
    )

    return {
        "elevation": upsampled,
        "transform": new_transform,
        "crs": dem_data["crs"],
        "bounds": dem_data["bounds"],
        "resolution": (abs(new_e), abs(new_a)),
        "nodata": dem_data["nodata"],
        "width": new_w,
        "height": new_h,
        "profile": profile,
    }


def get_dem_for_aoi(
    aoi_feature: dict,
    bbox: tuple[float, float, float, float],
    cache_dir: Path,
    coverage: str = "mdt05",
    resolution_m: float = 5.0,
    buffer_m: float = 100.0,
) -> dict[str, Any]:
    """Pipeline completo: descarga DEM del IGN y recorta por AOI.

    Cachea el DEM descargado para no redescargar.

    Returns:
        dict con elevation recortado + metadatos.
    """
    # Expandir bbox de descarga con buffer para tener suficientes puntos DEM
    # Especialmente importante para parcelas pequeñas
    lat_mid = (bbox[1] + bbox[3]) / 2
    buf_deg = buffer_m / 111_320
    dl_bbox = (
        bbox[0] - buf_deg / np.cos(np.radians(lat_mid)),
        bbox[1] - buf_deg,
        bbox[2] + buf_deg / np.cos(np.radians(lat_mid)),
        bbox[3] + buf_deg,
    )

    # Hash simple para cache
    bbox_str = f"{dl_bbox[0]:.4f}_{dl_bbox[1]:.4f}_{dl_bbox[2]:.4f}_{dl_bbox[3]:.4f}"
    dem_cached = cache_dir / f"{coverage}_{bbox_str}.tif"

    if not dem_cached.exists():
        download_dem_ign(dl_bbox, dem_cached, coverage=coverage, resolution_m=resolution_m)

    return crop_dem_by_aoi(dem_cached, aoi_feature, buffer_m=buffer_m)
