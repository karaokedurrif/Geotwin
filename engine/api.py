"""
FastAPI wrapper para el engine de procesamiento GeoTwin.

Endpoints:
  POST /process          — Lanzar pipeline (async background task)
  GET  /jobs/{job_id}    — Estado de un job
  GET  /health           — Health check
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import asdict
from enum import Enum
from pathlib import Path
from threading import Thread
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import settings
from .pipeline import PipelineResult, process_twin

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="GeoTwin Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ─── In-memory job store ────────────────────────────────────────────────────

class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class JobState(BaseModel):
    job_id: str
    twin_id: str
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    current_step: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None


# Simple dict store — sufficient for single-instance deployment
_jobs: dict[str, JobState] = {}


# ─── Request / Response models ──────────────────────────────────────────────

class ProcessRequest(BaseModel):
    twin_id: str = Field(..., pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    input_file: str = Field(..., description="Path to KML/GML/GeoJSON file")
    dem_path: str | None = Field(None, description="Optional local DEM path")
    coverage: str = Field("mdt05", pattern=r"^(mdt05|mdt02)$")


class ProcessResponse(BaseModel):
    job_id: str
    twin_id: str
    status: JobStatus


class JobResponse(BaseModel):
    job_id: str
    twin_id: str
    status: JobStatus
    progress: float
    current_step: str
    result: dict[str, Any] | None = None
    error: str | None = None


# ─── Worker thread ──────────────────────────────────────────────────────────

def _run_pipeline(job_id: str, req: ProcessRequest) -> None:
    """Execute pipeline in background thread."""
    job = _jobs[job_id]
    job.status = JobStatus.RUNNING

    def on_progress(step: str, pct: float) -> None:
        job.current_step = step
        job.progress = pct

    try:
        input_path = Path(req.input_file)
        if not input_path.exists():
            raise FileNotFoundError(f"Input file not found: {req.input_file}")

        dem_path = Path(req.dem_path) if req.dem_path else None

        result = process_twin(
            input_files=[input_path],
            twin_id=req.twin_id,
            dem_path=dem_path,
            coverage=req.coverage,
            on_progress=on_progress,
        )

        # ── Building extrusion ──
        # Reverse-geocode centroid → refcat → fetch buildings → extrude
        building_info: list[dict] = []
        try:
            import asyncio
            from .cadastre.refcat import refcat_from_coords, fetch_buildings_by_refcat
            from .buildings.extruder import extrude_building
            from .terrain.export import get_local_origin

            c_lon = result.aoi_metadata.centroid_lon
            c_lat = result.aoi_metadata.centroid_lat

            loop = asyncio.new_event_loop()
            refcat = loop.run_until_complete(refcat_from_coords(c_lon, c_lat))
            buildings = []
            if refcat:
                buildings = loop.run_until_complete(fetch_buildings_by_refcat(refcat))
            loop.close()

            if buildings:
                on_progress("Extruyendo edificios 3D", 92)
                import math

                local_origin = get_local_origin()
                if local_origin is None:
                    lat_rad = math.radians(c_lat)
                    local_origin = {
                        "centroid_lon": c_lon,
                        "centroid_lat": c_lat,
                        "min_elev": 0.0,
                        "m_per_deg_lon": 111_320.0 * math.cos(lat_rad),
                        "m_per_deg_lat": 111_320.0,
                        "z_sign": -1,
                    }

                output_dir = Path(result.glb_path).parent
                dem_tif = output_dir / "dem.tif"
                dem_elevations: dict[int, float] = {}

                if dem_tif.exists():
                    try:
                        import rasterio
                        with rasterio.open(str(dem_tif)) as src:
                            for i, bldg_f in enumerate(buildings):
                                from shapely.geometry import shape as _shape
                                bc = _shape(bldg_f["geometry"]).centroid
                                try:
                                    row, col = src.index(bc.x, bc.y)
                                    elev = float(src.read(1)[row, col])
                                    if elev > -1000:
                                        dem_elevations[i] = elev
                                except (IndexError, ValueError):
                                    pass
                    except Exception as de:
                        logger.warning("DEM sampling failed: %s", de)

                for i, bldg_feature in enumerate(buildings):
                    try:
                        n_floors = max(1, bldg_feature["properties"].get(
                            "numberOfFloorsAboveGround", 1
                        ))
                        base_elev = dem_elevations.get(
                            i, local_origin.get("min_elev", 0.0)
                        )
                        bldg_mesh = extrude_building(
                            footprint=bldg_feature["geometry"],
                            num_floors=n_floors,
                            ground_elevation=base_elev,
                            use=bldg_feature["properties"].get(
                                "currentUse", "agricultural"
                            ),
                            origin=local_origin,
                        )
                        bldg_glb_path = output_dir / f"building_{i}.glb"
                        bldg_mesh.export(str(bldg_glb_path), file_type="glb")
                        building_info.append({
                            "index": i,
                            "floors": n_floors,
                            "use": bldg_feature["properties"].get("currentUse"),
                            "glb_path": str(bldg_glb_path),
                            "base_elevation": base_elev,
                        })
                        logger.info(
                            "Building %d extruded: %d floors, base=%.1fm, path=%s",
                            i, n_floors, base_elev, bldg_glb_path,
                        )
                    except Exception as be:
                        logger.warning("Building %d extrusion failed: %s", i, be)

                logger.info(
                    "Pipeline %s: %d buildings extruded for refcat=%s",
                    req.twin_id, len(building_info), refcat,
                )
            else:
                logger.info(
                    "Pipeline %s: no buildings found (refcat=%s)",
                    req.twin_id, refcat,
                )
        except Exception as bldg_exc:
            logger.warning("Building extrusion phase failed: %s", bldg_exc)

        # ── Merge buildings into main terrain GLB ──
        if building_info:
            try:
                from .terrain.export import merge_buildings_into_glb
                bldg_paths = [Path(bi["glb_path"]) for bi in building_info]
                merge_buildings_into_glb(Path(result.glb_path), bldg_paths)
            except Exception as merge_exc:
                logger.warning("Building merge failed: %s", merge_exc)

        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.current_step = "Completado"
        job.result = {
            "twin_id": result.twin_id,
            "area_ha": result.aoi_metadata.area_ha,
            "centroid": [result.aoi_metadata.centroid_lon, result.aoi_metadata.centroid_lat],
            "vertex_count": result.vertex_count,
            "face_count": result.face_count,
            "lod_count": result.lod_count,
            "processing_time_s": round(result.processing_time_s, 2),
            "tileset_path": result.tileset_path,
            "glb_path": result.glb_path,
            "buildings": building_info,
            "ndvi": result.ndvi,
            "ortho": result.ortho,
        }
        logger.info("Job %s completed: %s", job_id, result.twin_id)

    except Exception as exc:
        job.status = JobStatus.FAILED
        job.error = str(exc)
        logger.error("Job %s failed: %s", job_id, exc)


# ─── Endpoints ──────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "geotwin-engine", "version": "0.1.0"}


@app.post("/process", response_model=ProcessResponse)
def process(req: ProcessRequest):
    """Enqueue terrain processing job."""
    job_id = uuid.uuid4().hex[:12]
    job = JobState(job_id=job_id, twin_id=req.twin_id)
    _jobs[job_id] = job

    thread = Thread(target=_run_pipeline, args=(job_id, req), daemon=True)
    thread.start()

    return ProcessResponse(job_id=job_id, twin_id=req.twin_id, status=JobStatus.QUEUED)


@app.get("/jobs/{job_id}", response_model=JobResponse)
def get_job(job_id: str):
    """Get job status and result."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/ndvi/{twin_id}")
def get_ndvi_status(twin_id: str):
    """Check if NDVI data exists for a twin."""
    import re
    if not re.match(r"^[a-zA-Z0-9_-]{1,64}$", twin_id):
        raise HTTPException(status_code=400, detail="Invalid twinId")

    tiles_dir = settings.tiles_dir / twin_id
    ndvi_tif = tiles_dir / "ndvi_real.tif"
    colormap = tiles_dir / "ndvi_colormap.png"

    if ndvi_tif.exists():
        import json
        result_file = tiles_dir / "pipeline_result.json"
        ndvi_info = {}
        if result_file.exists():
            data = json.loads(result_file.read_text())
            ndvi_info = data.get("ndvi", {}) or {}

        return {
            "available": True,
            "twin_id": twin_id,
            "ndvi_tif": str(ndvi_tif),
            "colormap_png": str(colormap) if colormap.exists() else None,
            **ndvi_info,
        }

    return {"available": False, "twin_id": twin_id}


@app.get("/sentinel-latest/{twin_id}")
def get_sentinel_latest(twin_id: str):
    """Download/serve latest Sentinel-2 RGB image for a twin."""
    import re
    import json
    if not re.match(r"^[a-zA-Z0-9_-]{1,64}$", twin_id):
        raise HTTPException(status_code=400, detail="Invalid twinId")

    tiles_dir = settings.tiles_dir / twin_id
    tiles_dir.mkdir(parents=True, exist_ok=True)
    rgb_png = tiles_dir / "sentinel_rgb.png"
    meta_file = tiles_dir / "sentinel_rgb_meta.json"

    # Return cached if fresh (< 5 days old)
    if rgb_png.exists() and meta_file.exists():
        import time
        age_days = (time.time() - rgb_png.stat().st_mtime) / 86400
        if age_days < 5:
            meta = json.loads(meta_file.read_text())
            return {"available": True, "cached": True, **meta}

    # Load geometry from twin data
    geojson_path = settings.data_dir / "twins" / twin_id / "geometry.geojson"
    if not geojson_path.exists():
        raise HTTPException(status_code=404, detail="Twin geometry not found")

    aoi = json.loads(geojson_path.read_text())

    copernicus_id = settings.copernicus_client_id
    copernicus_secret = settings.copernicus_client_secret
    if not copernicus_id or not copernicus_secret:
        raise HTTPException(status_code=503, detail="Copernicus credentials not configured")

    from .raster.sentinel_rgb import get_latest_sentinel_rgb

    result = get_latest_sentinel_rgb(
        aoi,
        tiles_dir,
        client_id=copernicus_id,
        client_secret=copernicus_secret,
        max_cloud_cover=20.0,
        days_back=30,
    )

    # Save metadata for caching
    meta = {
        "twin_id": twin_id,
        "date": result["date"],
        "cloud_cover": result["cloud_cover"],
        "resolution_m": result["resolution_m"],
        "bands": result["bands"],
        "bounds": result["bounds"],
        "width": result["width"],
        "height": result["height"],
    }
    meta_file.write_text(json.dumps(meta))

    return {"available": True, "cached": False, **meta}


# ─── Drone endpoints ────────────────────────────────────────────────────────

class FlightPlanRequest(BaseModel):
    aoi_geojson: dict
    altitude_agl: float = 80.0
    overlap: float = 75.0
    sidelap: float = 65.0
    speed: float = 8.0
    plan_type: str = "grid"
    drone_model: str = ""  # "dji_mini4pro" uses optimized defaults


class DroneProcessRequest(BaseModel):
    twin_id: str = Field(..., pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    mission_id: str
    images_dir: str


@app.post("/drones/plan")
def drone_flight_plan(req: FlightPlanRequest):
    """Generate a grid/crosshatch flight plan over an AOI."""
    from .drones.flight_planner import plan_grid_flight, FlightPlanType

    plan_type = FlightPlanType.CROSSHATCH if req.plan_type == "crosshatch" else FlightPlanType.GRID

    # Use Mini 4 Pro optimized defaults if specified
    extra_kwargs = {}
    if req.drone_model == "dji_mini4pro":
        from .drones.dji_mini4pro import MINI4PRO_PLANNER_DEFAULTS
        extra_kwargs = {
            "sensor_width_mm": MINI4PRO_PLANNER_DEFAULTS["sensor_width_mm"],
            "focal_length_mm": MINI4PRO_PLANNER_DEFAULTS["focal_length_mm"],
            "image_width_px": MINI4PRO_PLANNER_DEFAULTS["image_width_px"],
            "image_height_px": MINI4PRO_PLANNER_DEFAULTS["image_height_px"],
        }

    plan = plan_grid_flight(
        aoi_geojson=req.aoi_geojson,
        altitude_agl=req.altitude_agl,
        overlap=req.overlap,
        sidelap=req.sidelap,
        speed=req.speed,
        plan_type=plan_type,
        **extra_kwargs,
    )
    return {
        "type": plan.type.value,
        "altitude_agl": plan.altitude_agl,
        "overlap": plan.overlap,
        "sidelap": plan.sidelap,
        "speed": plan.speed,
        "gsd": plan.gsd,
        "estimated_duration_min": plan.estimated_duration_min,
        "estimated_photos": plan.estimated_photos,
        "waypoints": plan.waypoints,
    }


@app.get("/drones/mini4pro/gsd")
def mini4pro_gsd(altitude: float = 60.0, megapixels: int = 48):
    """Calculate GSD for DJI Mini 4 Pro at a given altitude."""
    from .drones.dji_mini4pro import compute_gsd
    gsd = compute_gsd(altitude, megapixels)
    return {
        "gsd_cm": gsd.gsd_cm,
        "footprint_w_m": gsd.footprint_w_m,
        "footprint_h_m": gsd.footprint_h_m,
        "altitude_m": gsd.altitude_m,
        "megapixels": gsd.megapixels,
    }


@app.post("/drones/mini4pro/estimate")
def mini4pro_estimate(body: dict):
    """Estimate flight parameters for DJI Mini 4 Pro over an area."""
    from .drones.dji_mini4pro import estimate_flight
    return estimate_flight(
        area_ha=body.get("area_ha", 10),
        altitude_m=body.get("altitude_m", 60),
        overlap=body.get("overlap", 80),
        sidelap=body.get("sidelap", 70),
        speed_ms=body.get("speed_ms", 5),
        megapixels=body.get("megapixels", 48),
        battery_type=body.get("battery_type", "standard"),
    )


# ─── HydroTwin Barbo — Simulación hidrogeológica ────────────────────────────

# Cache de la simulación baseline (se ejecuta una vez, ~2s en 50×50 grid)
_hydro_cache: dict[str, Any] = {}


class HydroSimRequest(BaseModel):
    pump_ls: float = Field(52.0, ge=5, le=60, description="Bombeo (l/s)")
    canal_factor: float = Field(1.0, ge=0, le=2.0, description="Factor caudal canal")
    k_factor: float = Field(1.0, ge=0.1, le=5.0, description="Factor conductividad K")


@app.get("/hydro/barbo/simulate")
def hydro_barbo_baseline():
    """
    Simulación baseline del acuífero Sierra Espuña.
    Devuelve datos de Plotly para el modelo 3D completo.
    Cached: se calcula una vez y se reutiliza.
    """
    if "baseline" in _hydro_cache:
        return _hydro_cache["baseline"]

    from .hydro import AquiferDomain, GroundwaterSolver, serialize_simulation

    domain = AquiferDomain(nx=50, ny=50, nlay=3)
    solver = GroundwaterSolver(domain)
    sim = solver.run_temporal(n_steps=12, Q_pump_base=domain.Q_well)
    result = serialize_simulation(domain, solver, sim)

    _hydro_cache["baseline"] = result
    logger.info("HydroTwin Barbo baseline simulation computed and cached")
    return result


@app.post("/hydro/barbo/simulate")
def hydro_barbo_resimulate(req: HydroSimRequest):
    """
    Re-simulación con parámetros ajustados.
    Ejecuta el solver FD con los nuevos valores de bombeo, canal y K.
    """
    from .hydro import AquiferDomain, GroundwaterSolver, serialize_simulation

    Q_pump = -(req.pump_ls * 86.4)  # l/s → m³/día (negativo = extracción)

    domain = AquiferDomain(nx=50, ny=50, nlay=3)
    solver = GroundwaterSolver(domain)
    sim = solver.run_temporal(
        n_steps=12,
        Q_pump_base=Q_pump,
        canal_factor_base=req.canal_factor,
        K_mult=req.k_factor,
    )
    return serialize_simulation(domain, solver, sim)


@app.post("/drones/missions/{mission_id}/export/dji")
def drone_export_dji(mission_id: str, body: dict):
    """Export flight plan as DJI Pilot 2 KMZ."""
    from .drones.dji_export import export_dji_kmz
    from .drones.models import FlightPlan

    twin_id = body.get("twin_id", "")
    plan_file = settings.tiles_dir.parent / twin_id / "missions" / mission_id / "plan.json"

    if not plan_file.exists():
        raise HTTPException(status_code=404, detail="Flight plan not found")

    import json
    plan_data = json.loads(plan_file.read_text())
    plan = FlightPlan(
        waypoints=plan_data.get("waypoints", []),
        altitude_agl=plan_data.get("altitude_agl", 80),
        speed=plan_data.get("speed", 8),
        aoi_geojson=plan_data.get("aoi_geojson", {}),
    )

    from fastapi.responses import Response
    kmz_bytes = export_dji_kmz(plan, mission_name=f"GeoTwin {twin_id}")
    return Response(content=kmz_bytes, media_type="application/vnd.google-earth.kmz")


@app.post("/drones/process")
def drone_process(req: DroneProcessRequest):
    """Enqueue drone image processing (ortho + NDVI)."""
    job_id = uuid.uuid4().hex[:12]
    job = JobState(job_id=job_id, twin_id=req.twin_id)
    _jobs[job_id] = job

    thread = Thread(target=_run_drone_pipeline, args=(job_id, req), daemon=True)
    thread.start()

    return {"job_id": job_id, "twin_id": req.twin_id, "status": "queued"}


def _run_drone_pipeline(job_id: str, req: DroneProcessRequest) -> None:
    """Execute drone processing pipeline in background thread."""
    job = _jobs[job_id]
    job.status = JobStatus.RUNNING

    try:
        images_dir = Path(req.images_dir)
        if not images_dir.exists():
            raise FileNotFoundError(f"Images directory not found: {req.images_dir}")

        output_dir = settings.tiles_dir / req.twin_id / "drone_products" / req.mission_id
        output_dir.mkdir(parents=True, exist_ok=True)

        job.current_step = "Catalogando imágenes"
        job.progress = 10.0

        from .drones.ortho_pipeline import run_ortho_pipeline
        result = run_ortho_pipeline(images_dir, output_dir)

        if result.get("orthomosaic"):
            job.current_step = "Ortomosaico generado, calculando NDVI"
            job.progress = 70.0

            # Try NDVI from multispectral
            try:
                from .drones.ndvi_pipeline import compute_ndvi_from_multiband, ndvi_to_png
                ndvi_tif = str(output_dir / "ndvi_drone.tif")
                ndvi_stats = compute_ndvi_from_multiband(result["orthomosaic"], ndvi_tif)
                ndvi_to_png(ndvi_tif, str(output_dir / "ndvi_drone_colormap.png"))
                result["ndvi"] = ndvi_stats
            except Exception as e:
                logger.warning("Drone NDVI failed (may not be multispectral): %s", e)

        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.current_step = "Completado"
        job.result = result
        logger.info("Drone job %s completed for mission %s", job_id, req.mission_id)

    except Exception as exc:
        job.status = JobStatus.FAILED
        job.error = str(exc)
        logger.error("Drone job %s failed: %s", job_id, exc)


# ─── AutoTwin from Referencia Catastral ─────────────────────────────────────

class AutoTwinRequest(BaseModel):
    refcat: str = Field(..., min_length=14, max_length=20, pattern=r"^[A-Za-z0-9]+$")


class AutoTwinResponse(BaseModel):
    job_id: str
    twin_id: str
    refcat: str
    status: JobStatus


def _run_autotwin(job_id: str, refcat: str, twin_id: str) -> None:
    """Execute the full autotwin pipeline: refcat → cadastre → mesh → 3D Tiles."""
    import asyncio
    import json as _json

    job = _jobs[job_id]
    job.status = JobStatus.RUNNING

    def on_progress(step: str, pct: float) -> None:
        job.current_step = step
        job.progress = pct

    try:
        # ── 1. Fetch parcel geometry from Catastro WFS ──
        on_progress("Descargando parcela catastral", 5)
        from .cadastre.refcat import fetch_parcel_by_refcat, fetch_buildings_by_refcat

        loop = asyncio.new_event_loop()
        parcel_feature = loop.run_until_complete(fetch_parcel_by_refcat(refcat))
        on_progress("Descargando edificios", 10)
        buildings = loop.run_until_complete(fetch_buildings_by_refcat(refcat))
        loop.close()

        # ── 2. Save geometry as GeoJSON for the pipeline ──
        output_dir = settings.tiles_dir / twin_id
        output_dir.mkdir(parents=True, exist_ok=True)
        geojson_path = output_dir / "geometry.geojson"
        geojson_path.write_text(_json.dumps(parcel_feature, indent=2))

        # ── 3. Run the standard terrain pipeline ──
        on_progress("Procesando terreno", 15)
        result = process_twin(
            input_files=[geojson_path],
            twin_id=twin_id,
            output_dir=output_dir,
            on_progress=on_progress,
        )

        # ── 4. Extrude buildings (if found) ──
        building_info = []
        if buildings:
            on_progress("Extruyendo edificios 3D", 92)
            from .buildings.extruder import extrude_building
            from .terrain.export import get_local_origin

            # Get the terrain's local origin (set during process_twin export)
            local_origin = get_local_origin()
            if local_origin is None:
                # Fallback: compute origin from parcel centroid
                import math
                c_lon = result.aoi_metadata.centroid_lon
                c_lat = result.aoi_metadata.centroid_lat
                lat_rad = math.radians(c_lat)
                local_origin = {
                    "centroid_lon": c_lon,
                    "centroid_lat": c_lat,
                    "min_elev": 0.0,
                    "m_per_deg_lon": 111_320.0 * math.cos(lat_rad),
                    "m_per_deg_lat": 111_320.0,
                    "z_sign": -1,
                }
                logger.warning(
                    "No local_origin from terrain export — using fallback "
                    "(min_elev=0)"
                )

            # Try to sample DEM elevation at each building centroid
            dem_elevations: dict[int, float] = {}
            try:
                # Load DEM if available for elevation sampling
                dem_tif = output_dir / "dem.tif"
                if dem_tif.exists():
                    import rasterio
                    with rasterio.open(str(dem_tif)) as src:
                        for i, bldg_feature in enumerate(buildings):
                            from shapely.geometry import shape as _shape
                            bldg_geom = _shape(bldg_feature["geometry"])
                            bldg_centroid = bldg_geom.centroid
                            try:
                                row, col = src.index(
                                    bldg_centroid.x, bldg_centroid.y
                                )
                                elev = float(src.read(1)[row, col])
                                if elev > -1000:  # valid elevation
                                    dem_elevations[i] = elev
                            except (IndexError, ValueError):
                                pass
                    logger.info(
                        "DEM elevation sampled for %d/%d buildings",
                        len(dem_elevations), len(buildings),
                    )
            except Exception as dem_err:
                logger.warning("DEM elevation sampling failed: %s", dem_err)

            for i, bldg_feature in enumerate(buildings):
                try:
                    n_floors = bldg_feature["properties"].get(
                        "numberOfFloorsAboveGround", 1
                    )
                    # Force minimum 1 floor if missing or zero
                    n_floors = max(1, n_floors)

                    # Use DEM elevation or fallback to terrain min_elev
                    base_elev = dem_elevations.get(
                        i, local_origin.get("min_elev", 0.0)
                    )

                    bldg_mesh = extrude_building(
                        footprint=bldg_feature["geometry"],
                        num_floors=n_floors,
                        ground_elevation=base_elev,
                        use=bldg_feature["properties"].get(
                            "currentUse", "agricultural"
                        ),
                        origin=local_origin,
                        metadata={
                            "refcat": refcat,
                            "index": i,
                            "use": bldg_feature["properties"].get("currentUse"),
                            "floors": n_floors,
                        },
                    )
                    bldg_glb_path = output_dir / f"building_{i}.glb"
                    bldg_mesh.export(str(bldg_glb_path), file_type="glb")
                    building_info.append({
                        "index": i,
                        "use": bldg_feature["properties"].get("currentUse"),
                        "floors": n_floors,
                        "area_m2": bldg_feature["properties"].get("area_m2"),
                        "glb_path": str(bldg_glb_path),
                        "base_elevation": base_elev,
                    })
                    logger.info(
                        "Building %d extruded: %d floors, base=%.1fm, "
                        "use=%s, path=%s",
                        i, n_floors, base_elev,
                        bldg_feature["properties"].get("currentUse"),
                        bldg_glb_path,
                    )
                except Exception as bldg_err:
                    logger.warning("Building %d extrusion failed: %s", i, bldg_err)

        # ── Merge buildings into main terrain GLB ──
        if building_info:
            try:
                from .terrain.export import merge_buildings_into_glb
                bldg_paths = [Path(bi["glb_path"]) for bi in building_info]
                merge_buildings_into_glb(Path(result.glb_path), bldg_paths)
            except Exception as merge_exc:
                logger.warning("Building merge into GLB failed: %s", merge_exc)

        # ── 5. Finalize ──
        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.current_step = "Completado"
        job.result = {
            "twin_id": result.twin_id,
            "refcat": refcat,
            "area_ha": result.aoi_metadata.area_ha,
            "centroid": [
                result.aoi_metadata.centroid_lon,
                result.aoi_metadata.centroid_lat,
            ],
            "vertex_count": result.vertex_count,
            "face_count": result.face_count,
            "lod_count": result.lod_count,
            "processing_time_s": round(result.processing_time_s, 2),
            "tileset_path": result.tileset_path,
            "glb_path": result.glb_path,
            "buildings": building_info,
            "ndvi": result.ndvi,
            "ortho": result.ortho,
        }
        logger.info(
            "AutoTwin %s completed: refcat=%s, %.1f ha, %d buildings",
            job_id, refcat, result.aoi_metadata.area_ha, len(building_info),
        )

    except Exception as exc:
        job.status = JobStatus.FAILED
        job.error = str(exc)
        logger.error("AutoTwin %s failed: %s", job_id, exc)


@app.post("/autotwin", response_model=AutoTwinResponse, status_code=202)
def create_autotwin(req: AutoTwinRequest):
    """Pipeline completo: referencia catastral → gemelo digital 3D.

    Async job (202 + polling via GET /jobs/{job_id}).
    """
    from .cadastre.refcat import validate_refcat

    refcat = validate_refcat(req.refcat)
    job_id = uuid.uuid4().hex[:12]
    twin_id = f"rc_{refcat[:14]}"

    job = JobState(job_id=job_id, twin_id=twin_id)
    _jobs[job_id] = job

    thread = Thread(target=_run_autotwin, args=(job_id, refcat, twin_id), daemon=True)
    thread.start()

    return AutoTwinResponse(
        job_id=job_id,
        twin_id=twin_id,
        refcat=refcat,
        status=JobStatus.QUEUED,
    )


# ─── Regenerate stale twins ────────────────────────────────────────────────

@app.post("/regenerate/{twin_id}", response_model=ProcessResponse, status_code=202)
def regenerate_twin(twin_id: str):
    """Re-process an existing twin using the stored GeoJSON.

    Useful when engine code has been updated and cached tiles are stale
    (e.g., missing TEXCOORD_0 in LOD GLBs).
    """
    import re
    if not re.match(r"^[a-zA-Z0-9_-]{1,64}$", twin_id):
        raise HTTPException(status_code=400, detail="Invalid twin ID")

    tiles_dir = settings.tiles_dir / twin_id
    geojson_path = tiles_dir / "aoi.geojson"
    if not geojson_path.exists():
        raise HTTPException(status_code=404, detail=f"No geometry found for {twin_id}")

    job_id = uuid.uuid4().hex[:12]
    job = JobState(job_id=job_id, twin_id=twin_id)
    _jobs[job_id] = job

    def _run_regen(jid: str, tid: str, gjpath: Path) -> None:
        j = _jobs[jid]
        j.status = JobStatus.RUNNING
        try:
            result = process_twin(
                input_files=[gjpath],
                twin_id=tid,
                coverage="mdt05",
                on_progress=lambda step, pct: setattr(j, 'current_step', step) or setattr(j, 'progress', pct),
            )
            j.status = JobStatus.COMPLETED
            j.progress = 100.0
            j.current_step = "Regenerado"
            j.result = {
                "twin_id": result.twin_id,
                "area_ha": result.aoi_metadata.area_ha,
                "centroid": [result.aoi_metadata.centroid_lon, result.aoi_metadata.centroid_lat],
                "vertex_count": result.vertex_count,
                "face_count": result.face_count,
                "lod_count": result.lod_count,
                "processing_time_s": round(result.processing_time_s, 2),
            }
            logger.info("Regenerated twin %s in %.1fs", tid, result.processing_time_s)
        except Exception as exc:
            j.status = JobStatus.FAILED
            j.error = str(exc)
            logger.error("Regeneration of %s failed: %s", tid, exc)

    thread = Thread(target=_run_regen, args=(job_id, twin_id, geojson_path), daemon=True)
    thread.start()

    return ProcessResponse(job_id=job_id, twin_id=twin_id, status=JobStatus.QUEUED)
