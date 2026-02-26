"""
Descarga la ortofoto real de la parcela desde el WMS del PNOA (IGN España).
Servicio público y gratuito — no requiere API key.

WMS IGN: https://www.ign.es/wms-inspire/pnoa-ma
Resolución: hasta 25cm/pixel en zonas de España
"""
import httpx
import base64
from PIL import Image
from io import BytesIO
import math

# WMS PNOA Máxima Actualidad — servicio público IGN
PNOA_WMS_URL = "https://www.ign.es/wms-inspire/pnoa-ma"

def _compute_bbox(centroid_lon: float, centroid_lat: float, 
                  area_ha: float, margin: float = 1.3) -> tuple[float,float,float,float]:
    """
    Calcula el bounding box en EPSG:4326 para cubrir la parcela.
    margin: factor de expansión (1.3 = 30% más grande que la parcela)
    """
    # Radio aproximado en grados para el área dada
    # 1 grado lat ≈ 111km, 1 grado lon ≈ 111km * cos(lat)
    area_m2 = area_ha * 10000
    radius_m = math.sqrt(area_m2 / math.pi) * margin
    
    delta_lat = radius_m / 111000
    delta_lon = radius_m / (111000 * math.cos(math.radians(centroid_lat)))
    
    return (
        centroid_lon - delta_lon,  # minx
        centroid_lat - delta_lat,  # miny
        centroid_lon + delta_lon,  # maxx
        centroid_lat + delta_lat,  # maxy
    )

async def fetch_pnoa_orthophoto(
    centroid_lon: float,
    centroid_lat: float,
    area_ha: float,
    output_size: int = 1024,
) -> Image.Image | None:
    """
    Descarga la ortofoto PNOA de la zona de la parcela.
    Retorna imagen PIL o None si falla.
    """
    bbox = _compute_bbox(centroid_lon, centroid_lat, area_ha)
    
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": "OI.OrthoimageCoverage",
        "STYLES": "",
        "CRS": "EPSG:4326",
        "BBOX": f"{bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]}",  # WMS 1.3 usa lat,lon
        "WIDTH": str(output_size),
        "HEIGHT": str(output_size),
        "FORMAT": "image/png",
    }
    
    print(f"[PNOA] Descargando ortofoto {area_ha:.0f}ha centrada en [{centroid_lon:.4f}, {centroid_lat:.4f}]")
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(PNOA_WMS_URL, params=params)
            
            if response.status_code != 200:
                print(f"[PNOA] Error HTTP {response.status_code}")
                return None
            
            # Verificar que es una imagen (no un error XML)
            content_type = response.headers.get("content-type", "")
            if "image" not in content_type:
                print(f"[PNOA] Respuesta no es imagen: {content_type}")
                print(f"[PNOA] Body: {response.text[:200]}")
                return None
            
            img = Image.open(BytesIO(response.content))
            print(f"[PNOA] ✅ Ortofoto descargada: {img.size}")
            return img
            
    except Exception as e:
        print(f"[PNOA] Error: {e}")
        return None


async def fetch_pnoa_as_base64(
    centroid_lon: float,
    centroid_lat: float,
    area_ha: float,
    output_size: int = 1024,
) -> str | None:
    """
    Descarga ortofoto PNOA y la guarda localmente para verificación.
    """
    img = await fetch_pnoa_orthophoto(centroid_lon, centroid_lat, area_ha, output_size)
    if img is None:
        return None
    
    # SIEMPRE guardar copia local para verificar que es la zona correcta
    debug_path = f"debug_pnoa_{centroid_lon:.4f}_{centroid_lat:.4f}.png"
    img.save(debug_path)
    print(f"[PNOA] 🛰 Ortofoto guardada en: {debug_path}")
    print(f"[PNOA] Abre esta imagen para verificar que es tu parcela antes de generar")
    
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()
