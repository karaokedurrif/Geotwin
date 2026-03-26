"""
GLB → USDZ converter for Apple AR Quick Look.

Uses trimesh to load GLB and export as USDZ file.
USDZ files can be opened natively on iOS/iPadOS via Safari Quick Look.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def convert_glb_to_usdz(glb_path: Path, output_path: Path | None = None) -> Path:
    """Convert a GLB file to USDZ format for Apple AR.

    Args:
        glb_path: Path to input .glb file.
        output_path: Optional output path. Defaults to same directory as .usdz.

    Returns:
        Path to the generated .usdz file.

    Raises:
        FileNotFoundError: If GLB file doesn't exist.
        RuntimeError: If conversion fails.
    """
    if not glb_path.exists():
        raise FileNotFoundError(f"GLB file not found: {glb_path}")

    if output_path is None:
        output_path = glb_path.with_suffix(".usdz")

    try:
        import trimesh

        mesh = trimesh.load(str(glb_path), force="scene")
        mesh.export(str(output_path), file_type="usdz")

        size_kb = output_path.stat().st_size / 1024
        logger.info("USDZ exported: %s (%.0f KB)", output_path, size_kb)
        return output_path

    except ImportError:
        raise RuntimeError(
            "trimesh is required for USDZ export. Install with: pip install trimesh[easy]"
        )
    except Exception as e:
        raise RuntimeError(f"USDZ conversion failed: {e}") from e
