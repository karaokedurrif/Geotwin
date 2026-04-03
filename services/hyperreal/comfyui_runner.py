"""
ComfyUI workflow runner — executes rendering pipelines via ComfyUI HTTP API.

ComfyUI runs as a background process on the same container (port 8188).
This module uploads images, submits workflow prompts, and polls for results.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

COMFYUI_URL = "http://127.0.0.1:8188"


async def wait_for_comfyui(timeout: int = 120) -> None:
    """Block until ComfyUI HTTP API is responsive."""
    start = time.time()
    async with httpx.AsyncClient() as client:
        while time.time() - start < timeout:
            try:
                r = await client.get(f"{COMFYUI_URL}/system_stats", timeout=3)
                if r.status_code == 200:
                    logger.info("ComfyUI ready (%.1fs)", time.time() - start)
                    return
            except (httpx.ConnectError, httpx.ReadTimeout):
                pass
            await asyncio.sleep(2)
    raise RuntimeError(f"ComfyUI not responsive after {timeout}s")


async def run_workflow(
    depth_path: str,
    rgb_path: str | None,
    prompt: str,
    negative_prompt: str,
    width: int = 2048,
    height: int = 2048,
    controlnet_strength: float = 0.85,
    denoise_strength: float = 0.75,
    output_dir: str | None = None,
) -> str:
    """Execute a ControlNet Depth workflow in ComfyUI.

    Pipeline nodes:
      1  LoadImage            — depth map
      2  LoadCheckpoint       — FLUX.1 dev FP8
      3  CLIPTextEncode       — positive prompt
      4  CLIPTextEncode       — negative prompt
      5  ControlNetLoader     — flux-depth-controlnet-v3
      6  ApplyControlNet      — strength
      7  EmptyLatentImage     — width × height
      8  KSampler             — 25 steps, cfg 3.5
      9  VAEDecode
     10  SaveImage
     11  (optional) LoadImage — rgb for IP-Adapter

    Returns:
        Absolute path to the rendered PNG.
    """
    workflow = _build_workflow(
        depth_path=depth_path,
        rgb_path=rgb_path,
        prompt=prompt,
        negative_prompt=negative_prompt,
        width=width,
        height=height,
        cn_strength=controlnet_strength,
        denoise=denoise_strength,
    )

    async with httpx.AsyncClient(timeout=180.0) as client:
        # Upload images to ComfyUI input folder
        await _upload_image(client, depth_path, "depth_input.png")
        if rgb_path:
            await _upload_image(client, rgb_path, "rgb_input.png")

        # Submit workflow
        resp = await client.post(
            f"{COMFYUI_URL}/prompt",
            json={"prompt": workflow},
        )
        resp.raise_for_status()
        prompt_id = resp.json()["prompt_id"]
        logger.info("Workflow submitted: prompt_id=%s", prompt_id)

        # Poll for completion
        render_path = await _wait_for_completion(client, prompt_id)

        # Copy to output_dir if specified
        if output_dir:
            import shutil

            dest = Path(output_dir) / "render.png"
            shutil.copy2(render_path, str(dest))
            return str(dest)

        return render_path


async def _upload_image(client: httpx.AsyncClient, local_path: str, remote_name: str) -> None:
    """Upload a local image to ComfyUI's input folder."""
    with open(local_path, "rb") as f:
        files = {"image": (remote_name, f, "image/png")}
        resp = await client.post(f"{COMFYUI_URL}/upload/image", files=files)
        resp.raise_for_status()
    logger.info("Uploaded %s → %s", local_path, remote_name)


async def _wait_for_completion(
    client: httpx.AsyncClient,
    prompt_id: str,
    timeout: int = 120,
) -> str:
    """Poll ComfyUI history until the render is finished."""
    start = time.time()
    while time.time() - start < timeout:
        resp = await client.get(f"{COMFYUI_URL}/history/{prompt_id}")
        history = resp.json()
        if prompt_id in history:
            outputs = history[prompt_id].get("outputs", {})
            for _node_id, output in outputs.items():
                if "images" in output:
                    img_info = output["images"][0]
                    path = f"/app/comfyui/output/{img_info['filename']}"
                    logger.info("Render complete: %s", path)
                    return path
        await asyncio.sleep(1)
    raise TimeoutError(f"ComfyUI render timeout ({timeout}s)")


def _build_workflow(
    depth_path: str,
    rgb_path: str | None,
    prompt: str,
    negative_prompt: str,
    width: int,
    height: int,
    cn_strength: float,
    denoise: float,
) -> dict:
    """Build the ComfyUI workflow JSON programmatically.

    Tries to load a pre-built template; falls back to constructing
    the node graph inline.
    """
    template_path = Path("/app/workflows/terrain_hyperreal.json")
    if template_path.exists():
        with open(template_path) as f:
            wf = json.load(f)
        # Parameterise template
        wf["1"]["inputs"]["image"] = "depth_input.png"
        wf["3"]["inputs"]["text"] = prompt
        wf["4"]["inputs"]["text"] = negative_prompt
        wf["6"]["inputs"]["strength"] = cn_strength
        wf["7"]["inputs"]["width"] = width
        wf["7"]["inputs"]["height"] = height
        wf["8"]["inputs"]["denoise"] = denoise
        wf["8"]["inputs"]["steps"] = 25
        wf["8"]["inputs"]["cfg"] = 3.5
        if rgb_path:
            wf["11"] = {
                "class_type": "LoadImage",
                "inputs": {"image": "rgb_input.png"},
            }
        return wf

    # Inline fallback — minimal FLUX + ControlNet Depth workflow
    wf: dict = {
        "1": {
            "class_type": "LoadImage",
            "inputs": {"image": "depth_input.png"},
        },
        "2": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "flux1-dev-fp8.safetensors"},
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt,
                "clip": ["2", 1],
            },
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative_prompt,
                "clip": ["2", 1],
            },
        },
        "5": {
            "class_type": "ControlNetLoader",
            "inputs": {"control_net_name": "flux-depth-controlnet-v3.safetensors"},
        },
        "6": {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "strength": cn_strength,
                "conditioning": ["3", 0],
                "control_net": ["5", 0],
                "image": ["1", 0],
            },
        },
        "7": {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "width": width,
                "height": height,
                "batch_size": 1,
            },
        },
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["2", 0],
                "positive": ["6", 0],
                "negative": ["4", 0],
                "latent_image": ["7", 0],
                "seed": 42,
                "steps": 25,
                "cfg": 3.5,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": denoise,
            },
        },
        "9": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["8", 0],
                "vae": ["2", 2],
            },
        },
        "10": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["9", 0],
                "filename_prefix": "hyperreal",
            },
        },
    }

    if rgb_path:
        wf["11"] = {
            "class_type": "LoadImage",
            "inputs": {"image": "rgb_input.png"},
        }

    return wf
