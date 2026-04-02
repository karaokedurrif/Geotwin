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

import numpy as np

from .config import settings
from .terrain.export import export_3d_tiles, export_single_glb, get_local_origin, set_texture
from .terrain.ingest import crop_dem_by_aoi, download_dem_ign, get_dem_for_aoi, load_dem, upsample_dem_bicubic
from .terrain.lod import generate_lods
from .terrain.mesh import clip_mesh_to_aoi, compute_uv_from_bbox, dem_to_mesh
from .vector.aoi import (
    AOIMetadata,
    compute_aoi_metadata,
    densify_coords,
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
    ndvi: dict | None = None  # NDVI real stats if available
    ortho: dict | None = None  # Ortofoto PNOA metadata if available


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

    # ─── 2b. Re-densificar geometría para parcelas pequeñas ─────────────
    # parse_kml densifica a 2.0m; para <0.5ha necesitamos 0.3m
    if aoi_meta.area_ha < 0.5:
        _progress("Re-densificando geometría (parcela <0.5 ha)", 17)
        geom = aoi_feature["geometry"]
        if geom["type"] == "Polygon":
            geom["coordinates"] = [
                densify_coords([tuple(c) for c in ring], max_distance_m=0.3)
                for ring in geom["coordinates"]
            ]
        elif geom["type"] == "MultiPolygon":
            geom["coordinates"] = [
                [
                    densify_coords([tuple(c) for c in ring], max_distance_m=0.3)
                    for ring in polygon
                ]
                for polygon in geom["coordinates"]
            ]
        new_vc = sum(
            len(ring)
            for ring in (geom["coordinates"] if geom["type"] == "Polygon" else
                         [r for p in geom["coordinates"] for r in p])
        )
        logger.info(
            "Re-densificado: %d → %d vértices (max_distance_m=0.3)",
            aoi_meta.vertex_count, new_vc,
        )

    # Guardar AOI como GeoJSON
    aoi_path = output_dir / "aoi.geojson"
    aoi_path.write_text(json.dumps(aoi_feature, indent=2))

    # ─── 3. Obtener DEM ─────────────────────────────────────────────────
    _progress("Obteniendo DEM", 25)

    effective_coverage = coverage

    if dem_path and dem_path.exists():
        dem_data = crop_dem_by_aoi(dem_path, aoi_feature)
    else:
        dem_data = get_dem_for_aoi(
            aoi_feature=aoi_feature,
            bbox=aoi_meta.bbox,
            cache_dir=settings.dem_dir,
            coverage=effective_coverage,
            resolution_m=resolution["dem_resolution_m"],
        )

    _progress("DEM obtenido", 40)

    # ─── 3b. Bicubic upsample DEM for higher mesh density ──────────────
    # IGN WCS only provides 5m/px.  Bicubic interpolation gives a smooth
    # 2m/px grid that yields 6× more triangles without a new DEM source.
    dem_data = upsample_dem_bicubic(dem_data, target_resolution_m=2.0)

    # ─── 4. Generar malla ───────────────────────────────────────────────
    _progress("Generando malla", 50)

    mesh = dem_to_mesh(
        dem_data,
        adaptive=True,
        slope_threshold=2.0,
        max_triangles=resolution["max_triangles"],
    )

    # Recortar al AOI
    _progress("Recortando malla al AOI", 60)
    mesh = clip_mesh_to_aoi(mesh, aoi_feature)

    # ─── Subdivision for mesh density ──────────────────────────────────
    # For micro parcels (<0.5 ha, ~1300m²) → 10K verts is enough —
    # flat terrain + maquette texture means geometry density is irrelevant.
    # For small parcels (0.5-1 ha) → target 10K vertices
    # Standard parcels → only subdivide if below 2000 vertices
    if aoi_meta.area_ha < 0.5:
        target_verts = 10_000  # Flat terrain: 10K clean mesh, texture does the work
    elif aoi_meta.area_ha < 1.0:
        target_verts = 10_000
    else:
        target_verts = 2_000

    if mesh.vertex_count < target_verts:
        logger.info(
            "Malla con solo %d vértices (target %d) — subdividiendo",
            mesh.vertex_count, target_verts,
        )
        import trimesh as _trimesh

        t = _trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces)
        max_passes = 2  # 2 passes ≈ 7K verts — enough for flat maquette terrain
        for _pass in range(max_passes):
            if len(t.vertices) >= target_verts:
                break
            t = t.subdivide()
            logger.info("  Subdivision pass %d: %d verts", _pass + 1, len(t.vertices))

        # Post-subdivision decimation: trim to exact target for clean geometry
        if len(t.vertices) > target_verts * 1.05:
            try:
                target_faces = int(len(t.faces) * target_verts / len(t.vertices))
                t_dec = t.simplify_quadric_decimation(target_faces)
                logger.info(
                    "  Decimation: %d → %d verts (target %d)",
                    len(t.vertices), len(t_dec.vertices), target_verts,
                )
                t = t_dec
            except Exception as dec_err:
                logger.warning("  Decimation failed (non-critical): %s", dec_err)

        from .terrain.mesh import TerrainMesh, _compute_face_normals

        mesh = TerrainMesh(
            vertices=np.asarray(t.vertices),
            faces=np.asarray(t.faces),
            normals=_compute_face_normals(np.asarray(t.vertices), np.asarray(t.faces)),
        )
        logger.info("Subdividida: %d vértices, %d triángulos", mesh.vertex_count, mesh.face_count)

    # ── Flatten terrain: force all elevations to minimum (tabla rasa) ──
    # For small parcels the DEM noise creates visible waves when Y is
    # exaggerated in the viewer.  A perfectly flat plane is required.
    if aoi_meta.area_ha < 1.0:
        min_elev = float(mesh.vertices[:, 2].min())
        mesh.vertices[:, 2] = min_elev
        logger.info("Terrain flattened: all Z forced to %.2f m (tabla rasa)", min_elev)

    # ─── 4b. Ortofoto PNOA (textura del terreno) ───────────────────────
    ortho_result = None
    texture_path = None
    try:
        _progress("Descargando ortofoto PNOA", 63)
        from .raster.ortho import extract_texture_image, get_ortho_for_aoi, cap_texture_size

        # Resolución adaptativa según el tamaño de la parcela
        if aoi_meta.area_ha < 0.5:
            ortho_res_cm = 5    # Ultra HD para parcelas muy pequeñas
            ortho_max_pixels = 16384  # Mayor resolución para parcelas diminutas
        elif aoi_meta.area_ha < 1:
            ortho_res_cm = 5    # Ultra HD
            ortho_max_pixels = 8192
        elif aoi_meta.area_ha < 10:
            ortho_res_cm = 5    # HD para parcelas pequeñas
            ortho_max_pixels = 8192
        elif aoi_meta.area_ha < 50:
            ortho_res_cm = 5    # HD para parcelas medianas
            ortho_max_pixels = 8192
        elif aoi_meta.area_ha < 200:
            ortho_res_cm = 10
            ortho_max_pixels = 8192
        else:
            ortho_res_cm = 25   # Parcelas enormes
            ortho_max_pixels = 8192

        # Retry up to 2 times with increasing timeout
        last_error = None
        for attempt in range(3):
            try:
                ortho_result = get_ortho_for_aoi(
                    bbox=aoi_meta.bbox,
                    output_dir=output_dir,
                    resolution_cm=ortho_res_cm,
                    max_pixels=ortho_max_pixels,
                )
                last_error = None
                break
            except Exception as retry_err:
                last_error = retry_err
                logger.warning(
                    "Ortofoto PNOA intento %d/3 falló: %s",
                    attempt + 1, retry_err,
                )
                if attempt < 2:
                    import time as _time
                    _time.sleep(2 * (attempt + 1))

        if last_error is not None:
            raise last_error

        # Extraer textura — PNG lossless para parcelas <1ha, JPEG para grandes
        from pathlib import Path as P
        ortho_tif = P(ortho_result["path"])

        # ── Sharp texture extraction from GeoTIFF at mesh bbox ──
        # Instead of extracting the full ortho to PNG then cropping (which
        # produced tiny ~1K textures), we read directly from the GeoTIFF
        # at the mesh's geographic extent with cubic resampling to 4K+.
        from .raster.ortho import extract_sharp_texture
        mb = mesh.bounds
        mesh_geo_bbox = (mb["min_lon"], mb["min_lat"], mb["max_lon"], mb["max_lat"])

        # Target texture size based on parcel area
        if aoi_meta.area_ha < 0.5:
            sharp_target_px = 4096  # 4K clean for drone micro parcels
        elif aoi_meta.area_ha < 1.0:
            sharp_target_px = 4096  # 4K balanced for small urban parcels
        elif aoi_meta.area_ha < 10.0:
            sharp_target_px = 4096
        else:
            sharp_target_px = 8192

        tex_ext = ".png"  # PNG lossless for max quality in GLB
        texture_path = ortho_tif.with_suffix(tex_ext)
        # Disable sharpening for small parcels — preserve raw grain for drone
        extract_sharp_texture(
            ortho_tif, mesh_geo_bbox, texture_path,
            target_max_px=sharp_target_px,
            disable_sharpening=(aoi_meta.area_ha < 1.0),
        )

        # ── Hi-res 4K inset composite — only for large parcels ──
        # For small parcels (<1 ha), extract_sharp_texture already downloads
        # at max density (1.4 cm/px for 57m). The hires_crop at 100m radius
        # would be LOWER resolution (~5 cm/px) and degrade the texture.
        if aoi_meta.area_ha >= 1.0:
            try:
                from .raster.ortho import download_hires_crop, composite_hires_inset

                hires_tif = output_dir / "ortho_hires_crop.tif"
                hires_bbox_center_lon = aoi_meta.centroid_lon
                hires_bbox_center_lat = aoi_meta.centroid_lat

                download_hires_crop(
                    hires_bbox_center_lon, hires_bbox_center_lat,
                    radius_m=100.0,
                    output_path=hires_tif,
                    target_px=4096,
                )

                import math as _math
                _m_lon = 111_320 * _math.cos(_math.radians(hires_bbox_center_lat))
                _buf_lon = 100.0 / _m_lon
                _buf_lat = 100.0 / 110_574.0
                hires_bbox = (
                    hires_bbox_center_lon - _buf_lon,
                    hires_bbox_center_lat - _buf_lat,
                    hires_bbox_center_lon + _buf_lon,
                    hires_bbox_center_lat + _buf_lat,
                )

                composite_hires_inset(
                    texture_path,
                    mesh_geo_bbox,  # composite against mesh bbox (not ortho bbox)
                    hires_tif,
                    hires_bbox,
                )
                logger.info("Hi-res 4K inset applied for building zone (100m radius)")
            except Exception as hires_err:
                logger.warning("Hi-res crop failed (non-critical): %s", hires_err)
        else:
            logger.info(
                "Small parcel (%.2f ha) — skipping hires composite "
                "(extract_sharp_texture already at max density)",
                aoi_meta.area_ha,
            )

        # ── Clay Mode: raw ortho without filters or blending ──
        # Pure satellite texture → ground reads as aerial photograph on
        # the maquette base.  Buildings use white clay instead.
        logger.info("Clay Mode: raw PNOA ortho (no blend) → %s", texture_path.name if texture_path else "N/A")

        # Assign UVs against mesh geographic bounds → guaranteed [0, 1] full coverage
        mesh = compute_uv_from_bbox(mesh, mesh_geo_bbox)
        set_texture(texture_path)

        logger.info(
            "Ortofoto PNOA: %dx%d px, textura=%s",
            ortho_result["width"], ortho_result["height"], texture_path,
        )
    except Exception as e:
        logger.error(
            "Ortofoto PNOA FALLÓ para %.1f ha (bbox=%s): %s",
            aoi_meta.area_ha, aoi_meta.bbox, e,
        )
        # Always compute UVs even without real ortho — prevents Cesium shader crash
        # The export layer (_mesh_to_glb) will generate a fallback flat material
        mb = mesh.bounds
        mesh_geo_bbox_fb = (mb["min_lon"], mb["min_lat"], mb["max_lon"], mb["max_lat"])
        mesh = compute_uv_from_bbox(mesh, mesh_geo_bbox_fb)
        ortho_result = None
        texture_path = None
        set_texture(None)
        logger.warning(
            "UVs asignados sin textura — export.py generará material fallback"
        )

    # ─── 4c. Z-offset anti Z-fighting (parcelas < 1 ha) ───────────────
    if aoi_meta.area_ha < 1.0:
        z_offset = 0.05  # metros
        mesh.vertices[:, 2] += z_offset
        logger.info(
            "Z-offset +%.2fm aplicado (parcela %.2f ha < 1 ha) para evitar Z-fighting",
            z_offset, aoi_meta.area_ha,
        )

    # ─── 5. Generar LODs ────────────────────────────────────────────────
    _progress("Generando niveles de detalle", 70)
    from .terrain.lod import compute_lod_levels
    adaptive_ratios = compute_lod_levels(aoi_meta.area_ha)
    lods = generate_lods(mesh, ratios=adaptive_ratios)
    logger.info(
        "LOD adaptativos para %.1f ha: %s",
        aoi_meta.area_ha, [f"{r:.0%}" for r in adaptive_ratios],
    )

    # ─── 6. Exportar 3D Tiles ───────────────────────────────────────────
    _progress("Exportando 3D Tiles", 85)
    tileset_path = export_3d_tiles(lods, output_dir, twin_id)

    # También exportar GLB combinado para AR/VR
    glb_path = output_dir / f"{twin_id}.glb"
    export_single_glb(mesh, glb_path)

    # ─── 6b. Export split assets (terrain_low + building_high) ──────────
    from .terrain.export import export_terrain_and_buildings
    split_result = {}
    try:
        # Collect any building meshes from the autotwin flow
        building_meshes = []
        bldg_dir_files = list(output_dir.glob("building_*.glb"))
        if bldg_dir_files:
            import trimesh as _tri
            for bf in bldg_dir_files:
                try:
                    bm = _tri.load(str(bf), process=False)
                    if hasattr(bm, 'vertices'):
                        building_meshes.append(bm)
                except Exception:
                    pass

        split_result = export_terrain_and_buildings(
            terrain_mesh=mesh,
            building_meshes=building_meshes,
            output_dir=output_dir,
            twin_id=twin_id,
            area_ha=aoi_meta.area_ha,
        )
        logger.info("Split export: %s", list(split_result.keys()))
    except Exception as split_err:
        logger.warning("Split export failed (non-critical): %s", split_err)

    # Limpiar textura compartida después de exportar
    set_texture(None)

    # ─── 7. NDVI real desde Sentinel-2 (opcional — SKIP for <1ha) ──────
    ndvi_result = None
    if aoi_meta.area_ha < 1.0:
        logger.info(
            "Sentinel NDVI skipped for small parcel (%.2f ha < 1 ha) — "
            "100%% ortho coverage preferred",
            aoi_meta.area_ha,
        )
    else:
        copernicus_id = settings.copernicus_client_id
        copernicus_secret = settings.copernicus_client_secret

        if copernicus_id and copernicus_secret:
            try:
                _progress("Calculando NDVI real (Sentinel-2)", 90)
                from .raster.sentinel import compute_ndvi_from_sentinel

                ndvi_result = compute_ndvi_from_sentinel(
                    aoi_feature,
                    output_dir,
                    client_id=copernicus_id,
                    client_secret=copernicus_secret,
                    max_cloud_cover=30.0,
                    days_back=120,
                )
                logger.info(
                    "NDVI real: mean=%.3f, fecha=%s",
                    ndvi_result["stats"]["mean"], ndvi_result["date"],
                )
            except Exception as e:
                logger.warning("NDVI real no disponible: %s", e)
                ndvi_result = None
        else:
            logger.info("NDVI real omitido: credenciales Copernicus no configuradas")

    # ─── 8. Guardar metadatos ───────────────────────────────────────────
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
        ndvi={
            "date": ndvi_result["date"],
            "stats": ndvi_result["stats"],
            "ndvi_path": ndvi_result["ndvi_path"],
            "colormap_path": ndvi_result["colormap_path"],
        } if ndvi_result else None,
        ortho={
            "path": ortho_result["path"],
            "bbox": ortho_result["bbox"],
            "width": ortho_result["width"],
            "height": ortho_result["height"],
            "textured": True,
        } if ortho_result else None,
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
        "textured": result.ortho is not None,
        "ortho": {
            "bbox": result.ortho["bbox"],
            "width": result.ortho["width"],
            "height": result.ortho["height"],
            "texture": str(Path(result.ortho["path"]).with_suffix(".png").name),
        } if result.ortho else None,
        "local_origin": get_local_origin(),
        "split_assets": split_result if split_result else None,
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

