"""
Descarga de bandas Sentinel-2 desde Copernicus Data Space Ecosystem (CDSE).

Usa OAuth2 client credentials para autenticar, OData para buscar productos
y descarga solo las bandas B04 (RED) y B08 (NIR) a resolución 10m.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path

import httpx
import rasterio
from rasterio.mask import mask as rasterio_mask
from shapely.geometry import box, mapping, shape

logger = logging.getLogger(__name__)

# ── CDSE endpoints ────────────────────────────────────────────────────────────
TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
CATALOG_URL = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"
SH_PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"


def _get_token(client_id: str, client_secret: str) -> str:
    """Obtiene access token de CDSE usando client credentials."""
    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=30,
    )
    resp.raise_for_status()
    token = resp.json()["access_token"]
    logger.info("CDSE token obtenido (exp: %s)", resp.json().get("expires_in", "?"))
    return token


def search_sentinel2(
    aoi_geojson: dict,
    *,
    client_id: str | None = None,
    client_secret: str | None = None,
    max_cloud_cover: float = 30.0,
    days_back: int = 90,
    max_results: int = 5,
) -> list[dict]:
    """Busca productos Sentinel-2 L2A que cubran el AOI.

    Returns:
        Lista de productos ordenados por fecha descendente, cada uno con
        'id', 'name', 'date', 'cloud_cover', 'footprint'.
    """
    client_id = client_id or os.environ.get("COPERNICUS_CLIENT_ID", "")
    client_secret = client_secret or os.environ.get("COPERNICUS_CLIENT_SECRET", "")

    geom = shape(aoi_geojson.get("geometry", aoi_geojson))
    bbox = geom.bounds  # (minx, miny, maxx, maxy)

    now = datetime.utcnow()
    date_from = (now - timedelta(days=days_back)).strftime("%Y-%m-%dT00:00:00.000Z")
    date_to = now.strftime("%Y-%m-%dT23:59:59.999Z")

    # OData filter — Sentinel-2 L2A, cloud cover, intersects AOI
    aoi_wkt = f"POLYGON(({bbox[0]} {bbox[1]},{bbox[2]} {bbox[1]},{bbox[2]} {bbox[3]},{bbox[0]} {bbox[3]},{bbox[0]} {bbox[1]}))"

    odata_filter = (
        f"Collection/Name eq 'SENTINEL-2' "
        f"and Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'productType' and att/OData.CSC.StringAttribute/Value eq 'S2MSI2A') "
        f"and OData.CSC.Intersects(area=geography'SRID=4326;{aoi_wkt}') "
        f"and ContentDate/Start gt {date_from} "
        f"and ContentDate/Start lt {date_to} "
        f"and Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq 'cloudCover' and att/OData.CSC.DoubleAttribute/Value le {max_cloud_cover:g})"
    )

    params = {
        "$filter": odata_filter,
        "$orderby": "ContentDate/Start desc",
        "$top": max_results,
        "$expand": "Attributes",
    }

    logger.info("Buscando Sentinel-2 L2A: bbox=%s, cloud<%.0f%%, últimos %d días", bbox, max_cloud_cover, days_back)

    resp = httpx.get(CATALOG_URL, params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    products = []
    for item in data.get("value", []):
        products.append({
            "id": item["Id"],
            "name": item["Name"],
            "date": item.get("ContentDate", {}).get("Start", ""),
            "cloud_cover": _extract_cloud_cover(item),
            "size_mb": round(item.get("ContentLength", 0) / 1e6, 1),
        })

    logger.info("Encontrados %d productos Sentinel-2", len(products))
    return products


def _extract_cloud_cover(item: dict) -> float:
    """Extrae cloud cover de los atributos OData."""
    for attr in item.get("Attributes", []):
        if attr.get("Name") == "cloudCover":
            return float(attr.get("Value", 100))
    return 100.0


def download_bands(
    product_id: str,
    product_name: str,
    output_dir: Path,
    *,
    bands: list[str] | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
    aoi_geojson: dict | None = None,
    date: str | None = None,
) -> dict[str, Path]:
    """Descarga bandas Sentinel-2 usando Sentinel Hub Process API.

    Descarga SOLO los píxeles del AOI (mucho más rápido que descargar el producto completo).

    Args:
        product_id: UUID del producto (para referencia).
        product_name: Nombre del producto (para cache).
        output_dir: Directorio de salida.
        bands: Bandas a descargar (default: ['B04', 'B08']).
        aoi_geojson: GeoJSON del AOI para recortar.
        date: Fecha del producto (YYYY-MM-DD).

    Returns:
        Dict {band_name: path_to_tif} con las bandas descargadas.
    """
    client_id = client_id or os.environ.get("COPERNICUS_CLIENT_ID", "")
    client_secret = client_secret or os.environ.get("COPERNICUS_CLIENT_SECRET", "")
    bands = bands or ["B04", "B08"]

    token = _get_token(client_id, client_secret)
    output_dir.mkdir(parents=True, exist_ok=True)

    band_paths: dict[str, Path] = {}

    if not aoi_geojson or not date:
        raise ValueError("aoi_geojson and date are required for Process API download")

    geom = shape(aoi_geojson.get("geometry", aoi_geojson))
    bbox = geom.bounds  # (minx, miny, maxx, maxy)

    for band in bands:
        target = output_dir / f"{band}_10m.tif"
        if target.exists():
            logger.info("Banda %s ya existe: %s", band, target.name)
            band_paths[band] = target
            continue

        # Sentinel Hub Process API — request single band as GeoTIFF
        evalscript = f"""//VERSION=3
function setup() {{
  return {{
    input: [{{ bands: ["{band}"], units: "DN" }}],
    output: {{ bands: 1, sampleType: "UINT16" }}
  }};
}}
function evaluatePixel(sample) {{
  return [sample.{band}];
}}"""

        request_body = {
            "input": {
                "bounds": {
                    "bbox": list(bbox),
                    "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"},
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
                "width": max(1, int((bbox[2] - bbox[0]) * 111320 / 10)),  # ~10m pixels
                "height": max(1, int((bbox[3] - bbox[1]) * 111320 / 10)),
                "responses": [{"identifier": "default", "format": {"type": "image/tiff"}}],
            },
            "evalscript": evalscript,
        }

        logger.info("Descargando banda %s via Process API (%dx%d px)...",
                     band, request_body["output"]["width"], request_body["output"]["height"])

        resp = httpx.post(
            SH_PROCESS_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "image/tiff",
            },
            json=request_body,
            timeout=120,
        )
        resp.raise_for_status()

        with open(target, "wb") as f:
            f.write(resp.content)

        logger.info("Banda %s descargada: %.1f KB", band, len(resp.content) / 1024)
        band_paths[band] = target

    missing = set(bands) - set(band_paths.keys())
    if missing:
        raise FileNotFoundError(f"Bandas no descargadas: {missing}")

    return band_paths


def get_sentinel2_bands_for_aoi(
    aoi_geojson: dict,
    output_dir: Path,
    *,
    client_id: str | None = None,
    client_secret: str | None = None,
    max_cloud_cover: float = 30.0,
    days_back: int = 90,
) -> dict:
    """Pipeline completo: buscar mejor imagen Sentinel-2 y descargar B04/B08.

    Returns:
        dict con 'product', 'bands' (paths), 'date'.
    """
    products = search_sentinel2(
        aoi_geojson,
        client_id=client_id,
        client_secret=client_secret,
        max_cloud_cover=max_cloud_cover,
        days_back=days_back,
        max_results=3,
    )

    if not products:
        raise RuntimeError(
            f"No se encontraron imágenes Sentinel-2 L2A con <{max_cloud_cover}% nubes "
            f"en los últimos {days_back} días"
        )

    # Pick best product (lowest cloud cover)
    best = min(products, key=lambda p: p["cloud_cover"])
    logger.info(
        "Seleccionado: %s (fecha=%s, nubes=%.1f%%)",
        best["name"][:40], best["date"][:10], best["cloud_cover"],
    )

    band_paths = download_bands(
        best["id"],
        best["name"],
        output_dir,
        client_id=client_id,
        client_secret=client_secret,
        aoi_geojson=aoi_geojson,
        date=best["date"][:10],
    )

    return {
        "product": best,
        "bands": band_paths,
        "date": best["date"][:10],
    }


def compute_ndvi_from_sentinel(
    aoi_geojson: dict,
    output_dir: Path,
    *,
    client_id: str | None = None,
    client_secret: str | None = None,
    max_cloud_cover: float = 30.0,
    days_back: int = 90,
) -> dict:
    """Pipeline completo: buscar Sentinel-2, descargar, calcular NDVI.

    Returns:
        dict con 'ndvi_path', 'colormap_path', 'date', 'stats', 'product_name'.
    """
    import numpy as np
    from .ndvi import compute_ndvi, ndvi_to_colormap

    # 1. Download bands
    sentinel_data = get_sentinel2_bands_for_aoi(
        aoi_geojson,
        output_dir / "sentinel",
        client_id=client_id,
        client_secret=client_secret,
        max_cloud_cover=max_cloud_cover,
        days_back=days_back,
    )

    b04_path = sentinel_data["bands"]["B04"]
    b08_path = sentinel_data["bands"]["B08"]

    # 2. Read bands — Process API returns TIFFs with CRS/transform if set via request
    geom = shape(aoi_geojson.get("geometry", aoi_geojson))
    bbox = geom.bounds

    with rasterio.open(b04_path) as red_src:
        red_band = red_src.read(1).astype(np.float32)
        crs = red_src.crs or rasterio.crs.CRS.from_epsg(4326)
        red_transform = red_src.transform
        # If transform is identity (Process API default), compute from bbox
        if red_transform.a == 1.0 and red_transform.e == -1.0:
            from rasterio.transform import from_bounds
            red_transform = from_bounds(bbox[0], bbox[1], bbox[2], bbox[3],
                                         red_src.width, red_src.height)

    with rasterio.open(b08_path) as nir_src:
        nir_band = nir_src.read(1).astype(np.float32)

    # 3. Compute NDVI
    ndvi = compute_ndvi(red_band, nir_band)

    # Stats
    valid = ~np.isnan(ndvi)
    stats = {
        "mean": float(np.nanmean(ndvi)) if valid.any() else 0.0,
        "std": float(np.nanstd(ndvi)) if valid.any() else 0.0,
        "min": float(np.nanmin(ndvi)) if valid.any() else 0.0,
        "max": float(np.nanmax(ndvi)) if valid.any() else 0.0,
        "valid_pixels": int(valid.sum()),
        "resolution_m": 10,
    }
    logger.info("NDVI real: mean=%.3f, min=%.3f, max=%.3f", stats["mean"], stats["min"], stats["max"])

    # 4. Save NDVI GeoTIFF
    ndvi_path = output_dir / "ndvi_real.tif"
    ndvi_path.parent.mkdir(parents=True, exist_ok=True)

    ndvi_profile = {
        "driver": "GTiff",
        "dtype": "float32",
        "width": ndvi.shape[1],
        "height": ndvi.shape[0],
        "count": 1,
        "crs": crs,
        "transform": red_transform,
        "nodata": np.nan,
        "compress": "deflate",
    }
    with rasterio.open(ndvi_path, "w", **ndvi_profile) as dst:
        dst.write(ndvi, 1)

    # 5. Save colormap PNG for quick preview / overlay
    colormap = ndvi_to_colormap(ndvi)
    colormap_path = output_dir / "ndvi_colormap.png"

    from PIL import Image
    img = Image.fromarray(colormap, "RGBA")
    img.save(colormap_path)

    # 6. Save world file for georeferencing the PNG
    _write_worldfile(colormap_path.with_suffix(".pgw"), red_transform)

    return {
        "ndvi_path": str(ndvi_path),
        "colormap_path": str(colormap_path),
        "date": sentinel_data["date"],
        "stats": stats,
        "product_name": sentinel_data["product"]["name"],
        "crs": str(crs),
        "transform": list(red_transform)[:6],
        "shape": list(ndvi.shape),
    }


def _write_worldfile(path: Path, transform) -> None:
    """Escribe un world file (.pgw/.tfw) para georreferenciar una imagen."""
    with open(path, "w") as f:
        f.write(f"{transform.a}\n")
        f.write(f"{transform.d}\n")
        f.write(f"{transform.b}\n")
        f.write(f"{transform.e}\n")
        f.write(f"{transform.c}\n")
        f.write(f"{transform.f}\n")
