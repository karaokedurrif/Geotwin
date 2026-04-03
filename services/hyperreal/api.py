"""
GeoTwin Hyperreal — FastAPI service for photorealistic renders via ComfyUI.

Receives: depth map PNG + RGB capture PNG + style preset
Returns:  4K photorealistic render preserving exact parcel geometry

Runs ComfyUI as a background process in the same container.
"""

from __future__ import annotations

import asyncio
import logging
import subprocess
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from comfyui_runner import run_workflow, wait_for_comfyui
from presets import STYLE_PRESETS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

OUTPUT_DIR = Path("/app/output")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="GeoTwin Hyperreal", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://geotwin.es",
        "https://www.geotwin.es",
        "http://localhost:3000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job storage
jobs: dict[str, dict] = {}


# ─── Endpoints ───────────────────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok", "presets": list(STYLE_PRESETS.keys())}


@app.get("/presets")
def list_presets():
    """Return available style presets with descriptions."""
    return {
        k: {"description": v["description"], "controlnet_strength": v["controlnet_strength"], "denoise": v["denoise"]}
        for k, v in STYLE_PRESETS.items()
    }


@app.post("/render")
async def create_render(
    depth_map: UploadFile = File(..., description="Depth map PNG from Three.js viewer"),
    rgb_capture: UploadFile = File(None, description="RGB capture (optional, for IP-Adapter)"),
    style: str = Form("extensivo"),
    custom_prompt: str = Form(""),
    resolution: int = Form(2048),
    controlnet_strength: float = Form(0.85),
    denoise: float = Form(0.75),
):
    """Generate a photorealistic render preserving the twin's geometry.

    1. Receives depth map (required) + RGB capture (optional)
    2. Selects style preset or uses custom prompt
    3. Queues ComfyUI workflow with ControlNet Depth
    4. Returns job_id for polling via GET /status/{job_id}
    """
    # Validate resolution
    if resolution not in (1024, 2048, 4096):
        return JSONResponse({"error": "resolution must be 1024, 2048, or 4096"}, 400)
    # Clamp parameters
    controlnet_strength = max(0.0, min(1.0, controlnet_strength))
    denoise = max(0.0, min(1.0, denoise))

    job_id = uuid.uuid4().hex[:8]
    job_dir = OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    # Save uploaded images
    depth_bytes = await depth_map.read()
    depth_path = job_dir / "depth.png"
    depth_path.write_bytes(depth_bytes)

    rgb_path: str | None = None
    if rgb_capture and rgb_capture.filename:
        rgb_bytes = await rgb_capture.read()
        rgb_file = job_dir / "rgb.png"
        rgb_file.write_bytes(rgb_bytes)
        rgb_path = str(rgb_file)

    # Resolve prompt
    preset = STYLE_PRESETS.get(style, STYLE_PRESETS["extensivo"])
    prompt = custom_prompt if style == "custom" and custom_prompt else preset["prompt"]
    negative = preset.get("negative", "")
    if style != "custom":
        controlnet_strength = preset.get("controlnet_strength", controlnet_strength)
        denoise = preset.get("denoise", denoise)

    jobs[job_id] = {"status": "processing", "result": None, "error": None}

    # Launch render in background
    asyncio.create_task(
        _run_render(
            job_id=job_id,
            depth_path=str(depth_path),
            rgb_path=rgb_path,
            prompt=prompt,
            negative=negative,
            resolution=resolution,
            cn_strength=controlnet_strength,
            denoise=denoise,
        )
    )

    return {"job_id": job_id, "status": "processing", "estimated_seconds": 15}


async def _run_render(
    job_id: str,
    depth_path: str,
    rgb_path: str | None,
    prompt: str,
    negative: str,
    resolution: int,
    cn_strength: float,
    denoise: float,
) -> None:
    """Background task: run ComfyUI workflow and update job state."""
    try:
        output_path = await run_workflow(
            depth_path=depth_path,
            rgb_path=rgb_path,
            prompt=prompt,
            negative_prompt=negative,
            width=resolution,
            height=resolution,
            controlnet_strength=cn_strength,
            denoise_strength=denoise,
            output_dir=str(OUTPUT_DIR / job_id),
        )
        jobs[job_id] = {"status": "completed", "result": f"/output/{job_id}/render.png", "error": None}
        logger.info("Render %s completed: %s", job_id, output_path)
    except Exception as e:
        jobs[job_id] = {"status": "error", "result": None, "error": str(e)}
        logger.error("Render %s failed: %s", job_id, e)


@app.get("/status/{job_id}")
def get_status(job_id: str):
    """Poll render job status."""
    job = jobs.get(job_id)
    if not job:
        return JSONResponse({"status": "not_found"}, 404)
    return job


@app.get("/output/{job_id}/render.png")
def get_render(job_id: str):
    """Download the rendered image."""
    path = OUTPUT_DIR / job_id / "render.png"
    if path.exists():
        return FileResponse(str(path), media_type="image/png", filename=f"hyperreal_{job_id}.png")
    return JSONResponse({"error": "not found"}, 404)


# ─── Startup ─────────────────────────────────────────────────────────────────


def _start_comfyui() -> None:
    """Launch ComfyUI as a background process."""
    logger.info("Starting ComfyUI background process...")
    subprocess.run(
        [
            "python",
            "/app/comfyui/main.py",
            "--listen",
            "0.0.0.0",
            "--port",
            "8188",
            "--preview-method",
            "none",
        ],
        check=False,
    )


@app.on_event("startup")
async def startup_event():
    """Start ComfyUI in a daemon thread and wait for it to be ready."""
    threading.Thread(target=_start_comfyui, daemon=True).start()
    try:
        await wait_for_comfyui(timeout=120)
    except RuntimeError:
        logger.warning("ComfyUI not ready yet — renders will wait for it")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8003)
