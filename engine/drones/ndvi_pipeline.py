"""
NDVI pipeline for multispectral drone imagery.
Processes RED and NIR bands to produce NDVI rasters and statistics.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any


def compute_ndvi_from_bands(
    red_path: str | Path,
    nir_path: str | Path,
    output_path: str | Path,
) -> dict[str, Any]:
    """
    Compute NDVI from separate RED and NIR band rasters.

    Uses rasterio + numpy.  Output is a single-band GeoTIFF with NDVI values [-1, 1].
    Returns stats dict with min, max, mean, median.
    """
    import numpy as np
    import rasterio
    from rasterio.transform import from_bounds

    with rasterio.open(red_path) as red_ds:
        red = red_ds.read(1).astype("float32")
        profile = red_ds.profile.copy()
        transform = red_ds.transform
        crs = red_ds.crs

    with rasterio.open(nir_path) as nir_ds:
        nir = nir_ds.read(1).astype("float32")

    # Avoid division by zero
    denominator = nir + red
    ndvi = np.where(denominator > 0, (nir - red) / denominator, 0.0)
    ndvi = np.clip(ndvi, -1.0, 1.0).astype("float32")

    # Write output
    out_profile = profile.copy()
    out_profile.update(dtype="float32", count=1, nodata=-9999, compress="deflate")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with rasterio.open(output_path, "w", **out_profile) as dst:
        dst.write(ndvi, 1)

    # Compute statistics
    valid = ndvi[ndvi > -1]
    stats = {
        "min": float(np.min(valid)) if valid.size else 0,
        "max": float(np.max(valid)) if valid.size else 0,
        "mean": float(np.mean(valid)) if valid.size else 0,
        "median": float(np.median(valid)) if valid.size else 0,
        "std": float(np.std(valid)) if valid.size else 0,
        "pixels": int(valid.size),
        "output_path": str(output_path),
    }
    return stats


def compute_ndvi_from_multiband(
    image_path: str | Path,
    output_path: str | Path,
    red_band: int = 1,
    nir_band: int = 4,
) -> dict[str, Any]:
    """
    Compute NDVI from a multiband raster (e.g., MicaSense composite).

    Band indices are 1-based.
    """
    import numpy as np
    import rasterio

    with rasterio.open(image_path) as ds:
        red = ds.read(red_band).astype("float32")
        nir = ds.read(nir_band).astype("float32")
        profile = ds.profile.copy()

    denominator = nir + red
    ndvi = np.where(denominator > 0, (nir - red) / denominator, 0.0)
    ndvi = np.clip(ndvi, -1.0, 1.0).astype("float32")

    out_profile = profile.copy()
    out_profile.update(dtype="float32", count=1, nodata=-9999, compress="deflate")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with rasterio.open(output_path, "w", **out_profile) as dst:
        dst.write(ndvi, 1)

    valid = ndvi[ndvi > -1]
    return {
        "min": float(np.min(valid)) if valid.size else 0,
        "max": float(np.max(valid)) if valid.size else 0,
        "mean": float(np.mean(valid)) if valid.size else 0,
        "median": float(np.median(valid)) if valid.size else 0,
        "std": float(np.std(valid)) if valid.size else 0,
        "pixels": int(valid.size),
        "output_path": str(output_path),
    }


def ndvi_to_png(
    ndvi_tif_path: str | Path,
    output_png: str | Path,
    colormap: str = "RdYlGn",
) -> str:
    """
    Render NDVI GeoTIFF as a colored PNG using matplotlib colormap.
    Returns path to the generated PNG.
    """
    import numpy as np
    import rasterio
    from matplotlib import cm, colors
    from PIL import Image

    with rasterio.open(ndvi_tif_path) as ds:
        ndvi = ds.read(1)

    # Normalize NDVI [-1,1] to [0,1] for colormap
    norm = colors.Normalize(vmin=-0.2, vmax=0.9)
    cmap = cm.get_cmap(colormap)
    rgba = cmap(norm(ndvi))
    rgb = (rgba[:, :, :3] * 255).astype(np.uint8)

    img = Image.fromarray(rgb)
    os.makedirs(os.path.dirname(output_png), exist_ok=True)
    img.save(str(output_png))
    return str(output_png)
