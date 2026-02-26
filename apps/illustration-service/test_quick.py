"""
Test rápido del pipeline de generación.
Ejecutar: python test_quick.py geotwin_snapshot.json
"""
import json
import sys
import asyncio
from dotenv import load_dotenv

load_dotenv()

from services.ndvi_analyzer import analyze_vegetation
from services.terrain_analyzer import analyze_terrain
from services.prompt_builder import build_illustration_prompt
from services.image_generator import generate_with_flux


async def main():
    # Cargar snapshot
    snapshot_path = sys.argv[1] if len(sys.argv) > 1 else "test_snapshot.json"
    with open(snapshot_path) as f:
        snapshot = json.load(f)

    print(f"📦 Snapshot: {snapshot.get('twinId', 'N/A')}")
    print(f"📐 Área: {snapshot['parcel']['area_ha']:.1f} ha")
    print(f"📍 Centroide: {snapshot['parcel']['centroid']}\n")

    # Analizar contexto
    print("🔍 Analizando vegetación...")
    veg = analyze_vegetation(snapshot)
    print(f"   Tipo: {veg['type']}")
    print(f"   Densidad: {veg['density']}")
    print(f"   Estación: {veg['season']}\n")

    print("⛰ Analizando terreno...")
    terrain = analyze_terrain(snapshot)
    print(f"   Tamaño: {terrain['area_description']}")
    print(f"   Forma: {terrain['shape_description']}\n")

    # Construir prompt
    print("✍️ Construyendo prompt...")
    prompts = build_illustration_prompt(veg, terrain, style="natural")
    print(f"\n📝 PROMPT POSITIVO:\n{prompts['positive']}\n")

    # Generar imagen
    print("🎨 Generando ilustración con Flux... (20-30 segundos)")
    try:
        url = await generate_with_flux(
            prompts["positive"],
            prompts["negative"],
            width=1024,
            height=1024,
            steps=25,
        )
        print(f"\n✅ Imagen generada: {url}")
        print(f"\nAbre esta URL en el navegador para ver el resultado.")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        print("Verifica que REPLICATE_API_TOKEN está en el .env")


if __name__ == "__main__":
    asyncio.run(main())
