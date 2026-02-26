from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import uuid
import asyncio

from services.illustration_renderer import generate_3d_illustration, generate_boundary_only_hq

router = APIRouter()

# Cache simple en memoria (en producción usar Redis)
jobs: dict[str, dict] = {}


class GenerateRequest(BaseModel):
    snapshot: dict  # El TwinSnapshot JSON completo
    style: str = "natural"  # natural, ndvi, night, topo, boundary_only
    extra_elements: list[str] = []  # Ignorado por ahora
    width: int = 1100  # Ancho de salida (default 1100px, boundary_only usa 3000px)
    height: int = 820  # Alto de salida (default 820px, boundary_only usa 3000px)
    z_scale: float = 130  # Exageración vertical del relieve (130=normal, 160=dramático)
    provider: str = "python"  # Renderer 3D Python puro
    cesium_screenshot: str | None = None  # Ignorado
    use_pnoa: bool = True  # Siempre usa PNOA en renderer Python
    img2img_strength: float = 0.0  # No aplica (no hay IA)
    boundary_only: bool = False  # True = solo contorno alta calidad, False = render 3D completo


class GenerateResponse(BaseModel):
    job_id: str
    status: str
    message: str


@router.post("/generate-illustration", response_model=GenerateResponse)
async def generate_illustration(request: GenerateRequest):
    """
    Inicia la generación de una ilustración isométrica.
    Retorna inmediatamente con job_id para polling.
    """
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {"status": "pending", "image_url": None, "error": None}

    # Lanzar generación en background
    asyncio.create_task(_generate_async(job_id, request))

    return GenerateResponse(
        job_id=job_id,
        status="pending",
        message="Generación iniciada. Consulta /status/{job_id} cada 5s",
    )


async def _generate_async(job_id: str, req: GenerateRequest):
    """
    Proceso de generación en background usando renderer 3D Python puro.
    NO usa IA - renderiza terreno 3D isométrico con textura PNOA real del IGN.
    """
    try:
        jobs[job_id]["status"] = "rendering"
        
        # Modo 1: Solo contorno de alta calidad
        if req.boundary_only or req.style == "boundary_only":
            print(f"[{job_id}] 🎨 Iniciando renderizado de contorno alta calidad (solo líneas)")
            png_bytes, description = await generate_boundary_only_hq(
                snapshot=req.snapshot,
                out_w=req.width if req.width > 1100 else 3000,   # Default 3000px para HQ
                out_h=req.height if req.height > 820 else 3000,
                z_scale=req.z_scale if req.z_scale > 130 else 180,  # Mayor perspectiva
                line_width=12,  # Línea gruesa para zoom
            )
        # Modo 2: Render 3D completo con terreno
        else:
            print(f"[{job_id}] 🎨 Iniciando renderizado 3D isométrico completo (sin IA)")
            # Llamar al renderer 3D que:
            # 1. Descarga MDT + PNOA del IGN en paralelo (asyncio.gather)
            # 2. Calcula bbox del polígono real
            # 3. Renderiza terreno 3D con painter's algorithm
            # 4. Dibuja contorno catastral 3D con glow dorado
            # 5. Retorna PNG bytes + descripción
            png_bytes, description = await generate_3d_illustration(
                snapshot=req.snapshot,
                style=req.style,  # natural, ndvi, night, topo
                out_w=req.width,  # 1100px default
                out_h=req.height,  # 820px default
                z_scale=req.z_scale,  # 130=normal, 160=dramático
                save_debug=False,  # No guardar debug en producción
            )

        # Guardar en directorio generated/
        import os
        filename = f"illustration_{job_id}.png"
        output_path = os.path.join("generated", filename)
        
        with open(output_path, "wb") as f:
            f.write(png_bytes)
        
        # Construir URL local (FastAPI sirve /generated como static)
        image_url = f"/generated/{filename}"

        jobs[job_id]["status"] = "completed"
        jobs[job_id]["image_url"] = image_url
        jobs[job_id]["description"] = description
        print(f"[{job_id}] ✅ Completado: {image_url}")
        print(f"[{job_id}] 📝 {description}")

    except Exception as e:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)
        print(f"[{job_id}] ❌ Error: {e}")


@router.get("/status/{job_id}")
def get_status(job_id: str):
    """Consulta el estado de un job de generación."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, **job}


# ══════════════════════════════════════════════════════════════════════════════
# REPLICATE / FLUX — Ilustración artística con IA
# ══════════════════════════════════════════════════════════════════════════════

class ReplicateRequest(BaseModel):
    prompt: str
    cesium_screenshot: str | None = None   # data:image/jpeg;base64,... del canvas Cesium
    snapshot_context: dict = {}
    boundary_only: bool = False


@router.post("/generate-ai-illustration")
async def generate_ai_illustration(request: ReplicateRequest):
    """
    Genera ilustración artística via Replicate Flux.
    Si hay cesium_screenshot → img2img (más fiel al terreno real).
    Si no → text2img puro desde el prompt.
    Requiere REPLICATE_API_TOKEN en .env
    """
    import os, httpx, base64

    token = os.environ.get("REPLICATE_API_TOKEN", "")
    if not token:
        raise HTTPException(status_code=500, detail="REPLICATE_API_TOKEN no configurado en .env")

    REPLICATE_API = "https://api.replicate.com/v1/predictions"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "wait",  # espera hasta 60s
    }

    has_screenshot = bool(request.cesium_screenshot and request.cesium_screenshot.startswith("data:image"))

    if has_screenshot:
        # ── IMG2IMG: Flux Dev con canvas Cesium como referencia ─────────────
        print(f"[Replicate] 📸 img2img con canvas Cesium (strength=0.65)")
        body = {
            "version": "black-forest-labs/flux-dev",
            "input": {
                "prompt": request.prompt + ", isometric 3D art, painterly, cinematic lighting",
                "image": request.cesium_screenshot,
                "strength": 0.65,
                "num_inference_steps": 28,
                "guidance": 3.5,
                "output_format": "png",
                "output_quality": 95,
            }
        }
    else:
        # ── TEXT2IMG: Flux Schnell rápido ────────────────────────────────────
        print(f"[Replicate] ✏️ text2img Flux Schnell")
        body = {
            "version": "black-forest-labs/flux-schnell",
            "input": {
                "prompt": request.prompt,
                "num_inference_steps": 4,
                "guidance": 0,
                "output_format": "png",
                "output_quality": 95,
                "aspect_ratio": "1:1" if request.boundary_only else "4:3",
            }
        }

    async with httpx.AsyncClient(timeout=180.0) as client:
        # Crear predicción
        res = await client.post(REPLICATE_API, json=body, headers=headers)
        if res.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"Replicate error: {res.status_code} {res.text[:200]}")

        prediction = res.json()
        pred_id = prediction["id"]
        print(f"[Replicate] Prediction {pred_id} created, status={prediction.get('status')}")

        # Polling si no completó con Prefer:wait
        deadline = asyncio.get_event_loop().time() + 180
        while prediction.get("status") not in ("succeeded", "failed", "canceled"):
            if asyncio.get_event_loop().time() > deadline:
                raise HTTPException(status_code=504, detail="Replicate timeout")
            await asyncio.sleep(2)
            poll = await client.get(f"{REPLICATE_API}/{pred_id}", headers=headers)
            prediction = poll.json()
            print(f"[Replicate] {pred_id} status={prediction.get('status')}")

        if prediction.get("status") != "succeeded":
            raise HTTPException(status_code=502, detail=f"Replicate failed: {prediction.get('error')}")

        output = prediction.get("output")
        image_url = output[0] if isinstance(output, list) else output
        print(f"[Replicate] ✅ Imagen: {image_url}")
        return {"image_url": image_url}
