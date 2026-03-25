"""Allow running pipeline as: python -m engine --input ... --twin-id ... --output ..."""

import argparse
import json
import logging
import sys
from pathlib import Path

from engine.pipeline import process_twin

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s: %(message)s",
)

parser = argparse.ArgumentParser(description="GeoTwin terrain pipeline")
parser.add_argument("--input", required=True, nargs="+", help="KML/GML/GeoJSON input files")
parser.add_argument("--twin-id", required=True, help="Twin identifier")
parser.add_argument("--output", required=True, help="Output directory")
parser.add_argument("--coverage", default="mdt05", help="DEM source: mdt05 or mdt02")
args = parser.parse_args()

result = process_twin(
    input_files=[Path(f) for f in args.input],
    twin_id=args.twin_id,
    output_dir=Path(args.output),
    coverage=args.coverage,
)

print(json.dumps({
    "success": True,
    "twin_id": result.twin_id,
    "area_ha": result.aoi_metadata.area_ha,
    "face_count": result.face_count,
    "lod_count": result.lod_count,
    "processing_time_s": round(result.processing_time_s, 2),
    "tileset_path": result.tileset_path,
}))

