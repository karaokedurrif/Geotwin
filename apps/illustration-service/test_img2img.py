"""
Script de prueba del pipeline img2img completo.
Ejecutar: python test_img2img.py

Descarga ortofoto PNOA real y genera ilustración hiperrealista
manteniendo la forma real de la parcela.
"""
import asyncio
import sys
import base64
from dotenv import load_dotenv

load_dotenv(override=True)

from services.ortophoto_fetcher import fetch_pnoa_orthophoto
from services.image_generator import generate_img2img_illustration, generate_with_replicate
from services.ndvi_analyzer import analyze_vegetation
from services.terrain_analyzer import analyze_terrain
from services.prompt_builder import build_illustration_prompt


async def main():
    print("=" * 60)
    print("TEST: Pipeline img2img con ortofoto PNOA")
    print("=" * 60)
    
    # Snapshot de ejemplo (Ávila)
    snapshot = {
        "parcel": {
            "centroid": [-3.9825, 40.9159],
            "area_ha": 134.75,
            "perimeter_m": 6789,
            "preset": "dehesa",
        },
        "timestamp": "2024-07-15T12:00:00Z",
        "esg": {"ndvi_mean": 0.55},
        "camera": {"headingDeg": 315},
    }
    
    centroid = snapshot["parcel"]["centroid"]
    area_ha = snapshot["parcel"]["area_ha"]
    
    print(f"\n📍 Parcela: {area_ha:.1f}ha en {centroid}")
    
    # PASO 1: Descargar ortofoto PNOA real
    print("\n🛰 Descargando ortofoto PNOA (IGN España)...")
    ortho = await fetch_pnoa_orthophoto(centroid[0], centroid[1], area_ha, 1024)
    
    if ortho:
        ortho.save("debug_pnoa.png")
        print("✅ Ortofoto guardada en debug_pnoa.png")
        print(f"   Tamaño: {ortho.size}")
        print("   ⚠️ ABRE debug_pnoa.png para ver la imagen base")
        
        # Convertir a base64
        from io import BytesIO
        buf = BytesIO()
        ortho.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
    else:
        print("⚠️ PNOA no disponible, se usará text2img")
        b64 = None
    
    # PASO 2: Construir prompt NEUTRAL
    print("\n📝 Construyendo prompt neutral (NO inventado)...")
    veg = analyze_vegetation(snapshot)
    terrain = analyze_terrain(snapshot)
    
    # Prompt genérico que RESPETA la ortofoto
    if b64:
        prompts = build_illustration_prompt(
            style="natural", is_img2img=True
        )
    else:
        prompts = build_illustration_prompt(
            style="natural", is_img2img=False
        )
    
    print(f"   Vegetación detectada: {veg['type']} (IGNORADO en prompt)")
    print(f"   Terreno detectado: {terrain['area_description']} (IGNORADO en prompt)")
    print(f"   Prompt neutral: {prompts['positive'][:100]}...")
    
    # PASO 3: Generar ilustración
    if b64:
        print("\n🎨 Generando ilustración img2img...")
        print("   Modelo: flux-dev")
        print("   Strength: 0.20 (MÍNIMA intervención - casi idéntico a ortofoto)")
        print("   Tiempo estimado: ~20-30 segundos")
        
        try:
            url = await generate_img2img_illustration(
                base_image_base64=b64,
                positive_prompt=prompts["positive"],
                negative_prompt=prompts["negative"],
                strength=0.20,  # CLAVE: mínima intervención
            )
            
            print(f"\n✅ Ilustración generada:")
            print(f"   {url}")
            print("\n📊 Criterios de éxito ESTRICTOS:")
            print("   ✓ IDÉNTICO a ortofoto (shape, trees, colors)")
            print("   ✓ ÚNICO cambio: contorno catastral dorado añadido")
            print("   ✓ NO árboles amarillos si no están en ortofoto")
            print("   ✓ NO forma cuadrada si ortofoto es irregular")
            print("   ✓ NO edificios si no existen en ortofoto")
            print("   ✓ NO carreteras si no están en ortofoto")
            print("\n💡 COMPARA debug_pnoa_*.png con la ilustración")
            print("   Deben ser IDÉNTICAS excepto el contorno dorado")
            
        except Exception as e:
            print(f"\n❌ Error: {e}")
            print("   Verifica que tienes crédito en Replicate")
    else:
        print("\n🎨 Fallback: Generando text2img...")
        url = await generate_with_replicate(
            prompts["positive"], 
            prompts["negative"], 
            model="schnell"
        )
        print(f"\n✅ URL: {url}")
        print("   ⚠️ Esta será una imagen genérica (sin forma real)")


if __name__ == "__main__":
    asyncio.run(main())
