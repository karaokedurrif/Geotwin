"""
Analiza el snapshot GeoJSON para determinar el tipo de vegetación
y generar descriptores para el prompt de imagen.
"""
from typing import TypedDict


class VegetationContext(TypedDict):
    type: str            # "dehesa", "pinar", "matorral", "pastizal", etc.
    density: str         # "densa", "dispersa", "abierta"
    ndvi_mean: float     # 0.0-1.0
    season: str          # "verano", "otoño", "primavera", "invierno"
    trees_per_ha: str    # estimación visual


def analyze_vegetation(snapshot: dict) -> VegetationContext:
    """
    Determina el tipo de vegetación a partir del snapshot.
    Usa NDVI medio si está disponible, o infiere del preset.
    """
    preset = snapshot.get("parcel", {}).get("preset", "dehesa")
    ndvi = snapshot.get("esg", {}).get("ndvi_mean", 0.65)
    area_ha = snapshot.get("parcel", {}).get("area_ha", 100)

    # Inferir tipo de vegetación del preset y NDVI
    if preset == "dehesa" or (ndvi > 0.4 and area_ha > 50):
        veg_type = "dehesa mediterránea"
        trees = "encinas dispersas a razón de 30-50 árboles/ha"
        density = "abierta con sotobosque de jara y retama"
    elif ndvi > 0.7:
        veg_type = "monte denso mediterráneo"
        trees = "encinas y quejigos densos"
        density = "muy densa"
    elif ndvi > 0.5:
        veg_type = "pastizal arbolado"
        trees = "árboles dispersos sobre pasto"
        density = "semi-abierta"
    else:
        veg_type = "pastizal y matorral"
        trees = "matorral bajo con piedras"
        density = "abierta"

    # Estación del año basada en timestamp
    import datetime
    ts = snapshot.get("timestamp", "")
    try:
        month = datetime.datetime.fromisoformat(ts.replace("Z", "")).month
        if month in [12, 1, 2]:
            season = "invierno, pasto amarillento"
        elif month in [3, 4, 5]:
            season = "primavera, pasto verde intenso"
        elif month in [6, 7, 8]:
            season = "verano, pasto seco dorado"
        else:
            season = "otoño, tonos ocres y marrones"
    except:
        season = "verano, pasto seco dorado"

    return VegetationContext(
        type=veg_type,
        density=density,
        ndvi_mean=ndvi,
        season=season,
        trees_per_ha=trees,
    )
