"""
Ortomosaic pipeline — wrapper around OpenDroneMap (ODM) for generating
orthomosaics, DSM, and point clouds from drone images.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


def run_ortho_pipeline(
    images_dir: str | Path,
    output_dir: str | Path,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Run an orthomosaic pipeline on a directory of geotagged drone images.

    Uses ODM (OpenDroneMap) via docker if available, otherwise falls back
    to basic metadata extraction.

    Returns dict with paths to generated products.
    """
    images_dir = Path(images_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    opts = {
        "dsm": True,
        "dtm": False,
        "orthophoto-resolution": 5,  # cm/px
        "feature-quality": "high",
        "pc-quality": "medium",
        **(options or {}),
    }

    # Try ODM via Docker
    if _has_odm_docker():
        return _run_odm_docker(images_dir, output_dir, opts)

    # Fallback: just catalog the images with metadata
    return _catalog_images(images_dir, output_dir)


def _has_odm_docker() -> bool:
    """Check if ODM Docker image is available."""
    try:
        result = subprocess.run(
            ["docker", "image", "inspect", "opendronemap/odm"],
            capture_output=True,
            timeout=10,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _run_odm_docker(
    images_dir: Path,
    output_dir: Path,
    opts: dict[str, Any],
) -> dict[str, Any]:
    """Run ODM in Docker container."""
    project_dir = output_dir / "odm_project"
    project_images = project_dir / "images"
    project_images.mkdir(parents=True, exist_ok=True)

    # Symlink images into project structure
    for img in images_dir.glob("*"):
        if img.suffix.lower() in (".jpg", ".jpeg", ".tif", ".tiff", ".dng"):
            dest = project_images / img.name
            if not dest.exists():
                os.symlink(img.resolve(), dest)

    cmd = [
        "docker", "run", "--rm",
        "-v", f"{project_dir}:/datasets/project",
        "opendronemap/odm",
        "--project-path", "/datasets",
        "project",
    ]

    if opts.get("dsm"):
        cmd.append("--dsm")
    if opts.get("dtm"):
        cmd.append("--dtm")
    cmd.extend(["--orthophoto-resolution", str(opts.get("orthophoto-resolution", 5))])
    cmd.extend(["--feature-quality", str(opts.get("feature-quality", "high"))])
    cmd.extend(["--pc-quality", str(opts.get("pc-quality", "medium"))])

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=7200)

    products: dict[str, Any] = {"success": result.returncode == 0}

    # Expected output paths
    odm_out = project_dir / "odm_orthophoto" / "odm_orthophoto.tif"
    dsm_out = project_dir / "odm_dem" / "dsm.tif"
    pc_out = project_dir / "odm_georeferencing" / "odm_georeferenced_model.laz"

    if odm_out.exists():
        dest = output_dir / "orthomosaic.tif"
        shutil.copy2(odm_out, dest)
        products["orthomosaic"] = str(dest)

    if dsm_out.exists():
        dest = output_dir / "dsm.tif"
        shutil.copy2(dsm_out, dest)
        products["dsm"] = str(dest)

    if pc_out.exists():
        dest = output_dir / "pointcloud.laz"
        shutil.copy2(pc_out, dest)
        products["pointcloud"] = str(dest)

    if result.returncode != 0:
        products["error"] = result.stderr[-2000:] if result.stderr else "Unknown error"

    return products


def _catalog_images(images_dir: Path, output_dir: Path) -> dict[str, Any]:
    """Fallback: catalog images without ODM processing."""
    from .dji_import import parse_dji_images_to_geojson

    geojson = parse_dji_images_to_geojson(images_dir)
    catalog_path = output_dir / "image_catalog.geojson"
    with open(catalog_path, "w") as f:
        json.dump(geojson, f, indent=2)

    return {
        "success": False,
        "reason": "ODM not available, images cataloged only",
        "image_catalog": str(catalog_path),
        "image_count": len(geojson.get("features", [])),
    }
