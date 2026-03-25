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
