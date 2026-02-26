"""
Script de diagnóstico para el error 401.
Ejecutar: python diagnose.py
"""
import asyncio
import os
import httpx
from dotenv import load_dotenv

async def main():
    print("=" * 50)
    print("DIAGNÓSTICO GEOTWIN ILLUSTRATION SERVICE")
    print("=" * 50)
    
    # 1. Cargar .env
    loaded = load_dotenv(override=True)
    print(f"\n1. .env encontrado: {loaded}")
    
    # 2. Token
    token = os.environ.get("REPLICATE_API_TOKEN", "")
    if not token:
        print("❌ REPLICATE_API_TOKEN está VACÍO")
        print("   Solución: añade tu token al archivo .env")
        return
    
    print(f"2. Token: {token[:8]}...{token[-4:]} ({len(token)} chars)")
    print(f"   Formato correcto (r8_ o rr8_): {token.startswith('r8_') or token.startswith('rr8_')}")
    
    if not (token.startswith("r8_") or token.startswith("rr8_")):
        print("❌ El token no empieza por 'r8_' — puede ser incorrecto")
        print("   Ve a: https://replicate.com/account/api-tokens")
        return
    
    # 3. Test de API
    print("\n3. Probando conexión con Replicate API...")
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(
                "https://api.replicate.com/v1/account",
                headers={"Authorization": f"Bearer {token}"}
            )
            
            if response.status_code == 200:
                account = response.json()
                print(f"✅ Autenticación OK")
                print(f"   Usuario: {account.get('username', 'N/A')}")
                print(f"   Email: {account.get('github_url', 'N/A')}")
            elif response.status_code == 401:
                print(f"❌ Token inválido (401)")
                print(f"   Respuesta: {response.text}")
                print(f"   Solución: Ve a replicate.com → API Tokens → Create token")
                return
            else:
                print(f"⚠️ Respuesta inesperada: {response.status_code}")
                print(f"   {response.text}")
                return
                
        except Exception as e:
            print(f"❌ Error de red: {e}")
            return
    
    # 4. Test de generación real con flux-schnell (muy barato, <$0.01)
    print("\n4. Probando generación real (flux-schnell)...")
    print("   Prompt: 'isometric view of mediterranean dehesa, encina trees, aerial'")
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Prefer": "wait",
                },
                json={
                    "input": {
                        "prompt": "hyperrealistic isometric aerial view of Mediterranean dehesa with scattered encina oak trees, golden dry grass, rocky terrain, 45 degree angle view, cinematic lighting, ultra detailed, 8K",
                        "num_outputs": 1,
                        "aspect_ratio": "1:1",
                        "output_format": "png",
                        "output_quality": 80,
                        "go_fast": True,
                        "megapixels": "1",
                        "num_inference_steps": 4,
                    }
                }
            )
            
            data = response.json()
            status = data.get("status")
            
            if status == "succeeded":
                outputs = data.get("output", [])
                url = outputs[0] if outputs else "N/A"
                print(f"✅ Imagen generada correctamente")
                print(f"   URL: {url}")
                print(f"\n🎉 Todo funciona. El servicio está listo.")
                
            elif status == "processing":
                pred_id = data.get("id")
                print(f"   En proceso (ID: {pred_id}), esperando...")
                
                # Polling simple
                for _ in range(12):  # 60 segundos
                    await asyncio.sleep(5)
                    poll = await client.get(
                        f"https://api.replicate.com/v1/predictions/{pred_id}",
                        headers={"Authorization": f"Bearer {token}"}
                    )
                    poll_data = poll.json()
                    if poll_data.get("status") == "succeeded":
                        outputs = poll_data.get("output", [])
                        url = outputs[0] if outputs else "N/A"
                        print(f"✅ Imagen generada: {url}")
                        print(f"\n🎉 Todo funciona. El servicio está listo.")
                        return
                
                print("⚠️ Timeout en el test — pero el token SÍ funciona")
                
            else:
                print(f"❌ Estado inesperado: {status}")
                print(f"   {data}")
                
    except Exception as e:
        print(f"❌ Error en generación: {e}")

asyncio.run(main())
