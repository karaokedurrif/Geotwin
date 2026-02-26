"""
Analiza la geometría del polígono para inferir características
del terreno (tamaño, forma, orientación, complejidad del perímetro).
"""
import math
from typing import TypedDict


class TerrainContext(TypedDict):
    area_description: str
    shape_description: str
    slope_hint: str
    orientation: str


def analyze_terrain(snapshot: dict) -> TerrainContext:
    """Extrae descriptores de terreno del snapshot."""
    area_ha = snapshot.get("parcel", {}).get("area_ha", 100)
    perimeter_m = snapshot.get("parcel", {}).get("perimeter_m", 5000)
    camera = snapshot.get("camera", {})

    # Tamaño
    if area_ha < 10:
        size_desc = "pequeña finca de menos de 10 hectáreas"
    elif area_ha < 50:
        size_desc = f"finca mediana de {area_ha:.0f} hectáreas"
    elif area_ha < 200:
        size_desc = f"gran finca extensiva de {area_ha:.0f} hectáreas"
    else:
        size_desc = f"enorme dehesa de {area_ha:.0f} hectáreas"

    # Complejidad del perímetro (perímetro real vs perímetro de un círculo equivalente)
    circle_perimeter = 2 * math.pi * math.sqrt(area_ha * 10000 / math.pi)
    complexity = perimeter_m / circle_perimeter
    if complexity < 1.3:
        shape_desc = "forma redondeada y compacta"
    elif complexity < 2.0:
        shape_desc = "forma irregular con leves entrantes"
    else:
        shape_desc = "forma muy irregular siguiendo cañadas y linderos"

    # Orientación de cámara → determina qué cara del terreno se ve
    heading = camera.get("headingDeg", 315)
    if 270 <= heading < 360 or heading < 45:
        orientation = "vista desde el sureste, ladera norte iluminada"
    elif 45 <= heading < 135:
        orientation = "vista desde el suroeste, ladera este visible"
    else:
        orientation = "vista isométrica frontal"

    return TerrainContext(
        area_description=size_desc,
        shape_description=shape_desc,
        slope_hint="con suaves lomas y vaguadas características del sistema central",
        orientation=orientation,
    )
