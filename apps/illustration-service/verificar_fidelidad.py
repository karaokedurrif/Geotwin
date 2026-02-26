"""
Script de verificación rápida del pipeline img2img fiel a ortofoto.
Ejecutar: python3 verificar_fidelidad.py

Descarga ortofoto PNOA y verifica que es la zona correcta.
"""
import asyncio
from services.ortophoto_fetcher import fetch_pnoa_orthophoto

async def main():
    print("=" * 70)
    print("VERIFICACIÓN: Ortofoto PNOA descargada correctamente")
    print("=" * 70)
    
    # Coordenadas de ejemplo (puedes cambiarlas por las tuyas)
    lon = -3.9825
    lat = 40.9159
    area_ha = 134.75
    
    print(f"\n📍 Coordenadas: [{lon}, {lat}]")
    print(f"📐 Área: {area_ha:.1f} ha")
    print(f"\n🛰 Descargando ortofoto PNOA del IGN España...")
    
    img = await fetch_pnoa_orthophoto(lon, lat, area_ha, 1024)
    
    if img:
        filename = f"verificar_zona_{lon:.4f}_{lat:.4f}.png"
        img.save(filename)
        print(f"\n✅ Ortofoto descargada y guardada en: {filename}")
        print(f"   Tamaño: {img.size}")
        print(f"\n🔍 ABRE LA IMAGEN Y VERIFICA:")
        print(f"   • ¿Es tu parcela?")
        print(f"   • ¿Los colores son correctos? (verde si es montaña, ocre si es seco)")
        print(f"   • ¿Ves los árboles donde deberían estar?")
        print(f"\n💡 Si la ortofoto muestra VERDE, la ilustración RESPETARÁ ese verde")
        print(f"   Si muestra OCRE, la ilustración RESPETARÁ ese ocre")
        print(f"   NO se inventará vegetación mediterránea genérica")
    else:
        print(f"\n❌ Error al descargar ortofoto PNOA")
        print(f"   • Verifica que tienes conexión a internet")
        print(f"   • Verifica que las coordenadas están en España")
        print(f"   • El servicio PNOA puede estar temporalmente inaccesible")

if __name__ == "__main__":
    asyncio.run(main())
