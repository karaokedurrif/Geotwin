"""
Genera la ilustración llamando a la API de Replicate (Flux) o fal.ai.
Usa httpx directamente para mayor control y debugging.
"""
import os
import httpx
import asyncio
from dotenv import load_dotenv

load_dotenv(override=True)


async def generate_with_replicate(
    positive_prompt: str,
    negative_prompt: str,
    width: int = 1024,
    height: int = 1024,
    steps: int = 25,
    model: str = "schnell",  # "schnell" (gratis/rápido) o "dev" (mejor calidad)
) -> str:
    """
    Genera imagen vía API REST de Replicate directamente.
    Más fiable que el SDK porque el token se pasa en el header HTTP.
    
    Modelos:
    - flux-schnell: ~500ms, casi gratis, buena calidad
    - flux-dev:     ~20-30s, mejor calidad artística, ~0.03$/img
    """
    
    api_token = os.environ.get("REPLICATE_API_TOKEN", "").strip()
    if not api_token:
        raise ValueError("REPLICATE_API_TOKEN no encontrado. Revisa el .env")
    
    # Seleccionar modelo
    if model == "schnell":
        model_version = "black-forest-labs/flux-schnell"
        input_data = {
            "prompt": positive_prompt,
            "num_outputs": 1,
            "aspect_ratio": "1:1",
            "output_format": "png",
            "output_quality": 90,
            "go_fast": True,
            "megapixels": "1",
            "num_inference_steps": 4,  # schnell solo necesita 4
        }
    else:  # dev
        model_version = "black-forest-labs/flux-dev"
        input_data = {
            "prompt": positive_prompt,
            "num_outputs": 1,
            "aspect_ratio": "1:1", 
            "output_format": "png",
            "output_quality": 90,
            "guidance": 3.5,
            "num_inference_steps": steps,
        }
    
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
        "Prefer": "wait",  # Espera hasta 60s antes de hacer polling
    }
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        
        # PASO 1: Crear la predicción
        print(f"[Replicate] Iniciando {model_version}...")
        response = await client.post(
            f"https://api.replicate.com/v1/models/{model_version}/predictions",
            headers=headers,
            json={"input": input_data},
        )
        
        if response.status_code == 401:
            raise ValueError(
                f"Token inválido (401). Ve a replicate.com/account/api-tokens "
                f"y copia un token nuevo. Token actual: {api_token[:8]}..."
            )
        
        if response.status_code not in [200, 201]:
            raise ValueError(f"Error Replicate {response.status_code}: {response.text}")
        
        prediction = response.json()
        prediction_id = prediction.get("id")
        
        print(f"[Replicate] Predicción creada: {prediction_id}")
        print(f"[Replicate] Estado: {prediction.get('status')}")
        
        # Si "Prefer: wait" funcionó, puede que ya tengamos el resultado
        if prediction.get("status") == "succeeded":
            outputs = prediction.get("output", [])
            if outputs:
                url = outputs[0] if isinstance(outputs, list) else outputs
                print(f"[Replicate] ✅ Completado inmediatamente: {url}")
                return str(url)
        
        # PASO 2: Polling hasta completar
        poll_url = prediction.get("urls", {}).get("get", 
            f"https://api.replicate.com/v1/predictions/{prediction_id}"
        )
        
        max_attempts = 60  # máximo 5 minutos (60 × 5s)
        for attempt in range(max_attempts):
            await asyncio.sleep(5)
            
            poll_response = await client.get(poll_url, headers=headers)
            poll_data = poll_response.json()
            status = poll_data.get("status")
            
            print(f"[Replicate] Intento {attempt+1}: {status}")
            
            if status == "succeeded":
                outputs = poll_data.get("output", [])
                if outputs:
                    url = outputs[0] if isinstance(outputs, list) else outputs
                    print(f"[Replicate] ✅ URL: {url}")
                    return str(url)
                    
            elif status == "failed":
                error = poll_data.get("error", "Unknown error")
                raise ValueError(f"Generación fallida: {error}")
                
            elif status == "canceled":
                raise ValueError("Predicción cancelada")
        
        raise TimeoutError("Timeout: la generación tardó más de 5 minutos")


# Alias para compatibilidad con el código existente
async def generate_with_flux(
    positive_prompt: str,
    negative_prompt: str,
    width: int = 1024,
    height: int = 1024,
    steps: int = 25,
) -> str:
    """Wrapper que usa flux-schnell por defecto (más rápido y gratis)."""
    return await generate_with_replicate(
        positive_prompt=positive_prompt,
        negative_prompt=negative_prompt,
        width=width,
        height=height,
        steps=steps,
        model="schnell",  # Cambiar a "dev" para mejor calidad
    )


async def generate_with_fal(
    positive_prompt: str,
    negative_prompt: str,
    width: int = 1024,
    height: int = 1024,
) -> str:
    """
    Alternativa con fal.ai — generalmente más rápido y barato.
    Usar si Replicate está lento.
    """
    fal_key = os.environ.get("FAL_KEY")
    if not fal_key:
        raise ValueError("FAL_KEY not set in .env")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://fal.run/fal-ai/flux/dev",
            headers={
                "Authorization": f"Key {fal_key}",
                "Content-Type": "application/json",
            },
            json={
                "prompt": positive_prompt,
                "negative_prompt": negative_prompt,
                "image_size": {
                    "width": width,
                    "height": height,
                },
                "num_inference_steps": 28,
                "guidance_scale": 7.5,
                "num_images": 1,
                "output_format": "png",
            },
            timeout=120.0,
        )
        response.raise_for_status()
        data = response.json()
        return data["images"][0]["url"]


async def generate_img2img_illustration(
    base_image_base64: str,        # imagen de Cesium o PNOA en base64
    positive_prompt: str,
    negative_prompt: str,
    strength: float = 0.20,        # 0.20=MÍNIMA intervención
    model: str = "flux-dev",
) -> str:
    """
    Genera ilustración hiperrealista usando la imagen base como guía estructural.
    
    strength: cuánto se aleja de la imagen base
      0.15-0.25 = MÍNIMA intervención (casi idéntico a ortofoto) ← RECOMENDADO
      0.30-0.40 = intervención moderada (puede cambiar colores)
      0.50+     = PELIGRO MÁXIMO - inventa completamente la escena
    
    Modelo: flux-dev con img2img
    """
    api_token = os.environ.get("REPLICATE_API_TOKEN", "").strip()
    if not api_token:
        raise ValueError("REPLICATE_API_TOKEN no configurado")
    
    # Asegurar que base64 tiene el prefijo data URI correcto
    if not base_image_base64.startswith("data:"):
        image_uri = f"data:image/png;base64,{base_image_base64}"
    else:
        image_uri = base_image_base64
    
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
        "Prefer": "wait",
    }
    
    async with httpx.AsyncClient(timeout=300.0) as client:
        
        # Flux img2img vía API REST de Replicate
        fidelity = "Fiel a ortofoto" if strength < 0.4 else "Creativo"
        print(f"[img2img] Iniciando generación con strength={strength} — {fidelity}")
        
        response = await client.post(
            "https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions",
            headers=headers,
            json={
                "input": {
                    "prompt": positive_prompt,
                    "image": image_uri,           # imagen base (Cesium o PNOA)
                    "strength": strength,          # 0-1: fidelidad vs creatividad
                    "num_outputs": 1,
                    "aspect_ratio": "1:1",
                    "output_format": "png",
                    "output_quality": 95,
                    "num_inference_steps": 28,
                    "guidance": 3.5,
                    "go_fast": False,
                }
            }
        )
        
        if response.status_code not in [200, 201]:
            print(f"[img2img] Error {response.status_code}: {response.text}")
            # Fallback: intentar con schnell si dev falla
            return await generate_with_replicate(
                positive_prompt, negative_prompt, model="schnell"
            )
        
        prediction = response.json()
        pred_id = prediction.get("id")
        
        # Si "Prefer: wait" resolvió inmediatamente
        if prediction.get("status") == "succeeded":
            outputs = prediction.get("output", [])
            if outputs:
                return str(outputs[0] if isinstance(outputs, list) else outputs)
        
        # Polling
        poll_url = f"https://api.replicate.com/v1/predictions/{pred_id}"
        for attempt in range(60):
            await asyncio.sleep(5)
            poll = await client.get(poll_url, headers=headers)
            data = poll.json()
            status = data.get("status")
            print(f"[img2img] {attempt+1}/60: {status}")
            
            if status == "succeeded":
                outputs = data.get("output", [])
                if outputs:
                    return str(outputs[0] if isinstance(outputs, list) else outputs)
            elif status in ["failed", "canceled"]:
                raise ValueError(f"Predicción {status}: {data.get('error')}")
        
        raise TimeoutError("img2img timeout")


