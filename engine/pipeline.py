"""
Pipeline principal de procesamiento GeoTwin.

Orquesta el flujo completo:
KML/GeoJSON → merge parcelas → DEM → mesh → LOD → 3D Tiles

Este módulo se ejecuta como función directa o como tarea Celery.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from .config import settings
from .terrain.export import export_3d_tiles, export_single_glb
from .terrain.ingest import crop_dem_by_aoi, download_dem_ign, get_dem_for_aoi, load_dem
from .terrain.lod import generate_lods
from .terrain.mesh import clip_mesh_to_aoi, dem_to_mesh
from .vector.aoi import (
    AOIMetadata,
    compute_aoi_metadata,
    merge_parcels,
    parse_geojson,
    parse_kml,
    select_resolution,
)

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    """Resultado del pipeline de procesamiento."""

    twin_id: str
    aoi_metadata: AOIMetadata
    resolution: dict
    tileset_path: str
    glb_path: str
    vertex_count: int
    face_count: int
    lod_count: int
    processing_time_s: float
    steps_completed: list[str]


def process_twin(
    input_files: list[Path],
    twin_id: str,
    output_dir: Path | None = None,
    dem_path: Path | None = None,
    coverage: str = "mdt05",
    on_progress: callable | None = None,
) -> PipelineResult:
    """Pipeline completo: archivos de entrada → 3D Tiles.

    Args:
        input_files: Lista de archivos KML/GML/GeoJSON.
        twin_id: Identificador del twin.
        output_dir: Directorio de salida. Default: settings.tiles_dir / twin_id.
        dem_path: Ruta a DEM local. Si no se proporciona, descarga del IGN.
        coverage: Tipo de DEM del IGN ('mdt05' o 'mdt02').
        on_progress: Callback (step_name, percent) para barra de progreso.

    Returns:
        PipelineResult con rutas y metadatos.
    """
    t0 = time.monotonic()
    steps: list[str] = []

    if output_dir is None:
        output_dir = settings.tiles_dir / twin_id
    output_dir.mkdir(parents=True, exist_ok=True)

    def _progress(step: str, pct: float) -> None:
        steps.append(step)
        logger.info("[%s] %s (%.0f%%)", twin_id, step, pct)
        if on_progress:
            on_progress(step, pct)

    # ─── 1. Parsear y unir parcelas ─────────────────────────────────────
    _progress("Parseando parcelas", 5)

    features: list[dict] = []
    for f in input_files:
        suffix = f.suffix.lower()
        if suffix in (".kml", ".gml", ".xml"):
            features.append(parse_kml(f))
        elif suffix in (".geojson", ".json"):
            features.append(parse_geojson(f))
        else:
            logger.warning("Formato no soportado: %s", f.suffix)

    if not features:
        msg = "No se parsearon parcelas válidas"
        raise ValueError(msg)

    if len(features) > 1:
        _progress("Uniendo parcelas", 10)
        aoi_feature = merge_parcels(features)
    else:
        aoi_feature = features[0]

    # ─── 2. Calcular metadatos del AOI ──────────────────────────────────
    _progress("Calculando metadatos", 15)

    source_crs = aoi_feature.get("properties", {}).get("source_crs")
    aoi_meta = compute_aoi_metadata(aoi_feature, source_crs)
    resolution = select_resolution(aoi_meta.area_ha)

    logger.info(
        "AOI: %.1f ha, centroide (%.4f, %.4f), resolución DEM=%dm",
        aoi_meta.area_ha, aoi_meta.centroid_lon, aoi_meta.centroid_lat,
        resolution["dem_resolution_m"],
    )

    # Guardar AOI como GeoJSON
    aoi_path = output_dir / "aoi.geojson"
    aoi_path.write_text(json.dumps(aoi_feature, indent=2))

    # ─── 3. Obtener DEM ─────────────────────────────────────────────────
    _progress("Obteniendo DEM", 25)

    if dem_path and dem_path.exists():
        dem_data = crop_dem_by_aoi(dem_path, aoi_feature)
    else:
        dem_data = get_dem_for_aoi(
            aoi_feature=aoi_feature,
            bbox=aoi_meta.bbox,
            cache_dir=settings.dem_dir,
            coverage=coverage,
            resolution_m=resolution["dem_resolution_m"],
        )

    _progress("DEM obtenido", 40)

    # ─── 4. Generar malla ───────────────────────────────────────────────
    _progress("Generando malla", 50)

    mesh = dem_to_mesh(
        dem_data,
        adaptive=True,
        slope_threshold=10.0,
        max_triangles=resolution["max_triangles"],
    )

    # Recortar al AOI
    _progress("Recortando malla al AOI", 60)
    mesh = clip_mesh_to_aoi(mesh, aoi_feature)

    # ─── 5. Generar LODs ────────────────────────────────────────────────
    _progress("Generando niveles de detalle", 70)
    lods = generate_lods(mesh)

    # ─── 6. Exportar 3D Tiles ───────────────────────────────────────────
    _progress("Exportando 3D Tiles", 85)
    tileset_path = export_3d_tiles(lods, output_dir, twin_id)

    # También exportar GLB combinado para AR/VR
    glb_path = output_dir / f"{twin_id}.glb"
    export_single_glb(mesh, glb_path)

    # ─── 7. Guardar metadatos ───────────────────────────────────────────
    _progress("Finalizando", 95)

    elapsed = time.monotonic() - t0

    result = PipelineResult(
        twin_id=twin_id,
        aoi_metadata=aoi_meta,
        resolution=resolution,
        tileset_path=str(tileset_path),
        glb_path=str(glb_path),
        vertex_count=mesh.vertex_count,
        face_count=mesh.face_count,
        lod_count=len(lods),
        processing_time_s=elapsed,
        steps_completed=steps,
    )

    # Guardar resumen
    meta_path = output_dir / "pipeline_result.json"
    meta_path.write_text(json.dumps({
        "twin_id": result.twin_id,
        "area_ha": result.aoi_metadata.area_ha,
        "centroid": [result.aoi_metadata.centroid_lon, result.aoi_metadata.centroid_lat],
        "bbox": list(result.aoi_metadata.bbox),
        "resolution": result.resolution,
        "vertex_count": result.vertex_count,
        "face_count": result.face_count,
        "lod_count": result.lod_count,
        "processing_time_s": round(result.processing_time_s, 2),
        "tileset_path": result.tileset_path,
        "glb_path": result.glb_path,
    }, indent=2))

    _progress("Completado", 100)
    logger.info(
        "Pipeline completado: %s — %.1f ha, %d tris, %d LODs en %.1fs",
        twin_id, aoi_meta.area_ha, mesh.face_count, len(lods), elapsed,
    )

    return result


# ─── CLI Entry Point ────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    import sys

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

