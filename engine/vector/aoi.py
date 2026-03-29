"""
Módulo AOI — Parseo de KML/GML, unión de parcelas, metadatos geométricos.

Este módulo es el punto de entrada del pipeline: el usuario sube N archivos
catastrales (KML, GML, GeoJSON) y este módulo los une en una sola geometría
de finca con metadatos calculados.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from lxml import etree
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union


@dataclass(frozen=True)
class AOIMetadata:
    """Metadatos calculados de un Área de Interés."""

    area_ha: float
    perimeter_m: float
    centroid_lon: float
    centroid_lat: float
    bbox: tuple[float, float, float, float]  # (minlon, minlat, maxlon, maxlat)
    vertex_count: int
    source_crs: str | None


# ─── Detección de CRS por rango de coordenadas ──────────────────────────────


def _detect_utm_zone(coords: list[tuple[float, float]]) -> str | None:
    """Detecta zona UTM española (28-31) por rango de coordenadas.

    Las coordenadas UTM en España tienen X entre 100_000 y 900_000
    e Y entre 3_500_000 y 4_900_000. Las coordenadas WGS84 son
    lon [-20, 5] lat [27, 44].
    """
    if not coords:
        return None

    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    avg_x = np.mean(xs)
    avg_y = np.mean(ys)

    # Si las coordenadas parecen WGS84, no hay reproyección
    if -20 < avg_x < 10 and 25 < avg_y < 50:
        return None

    # Detectar huso UTM español por rango de X
    if 100_000 < avg_x < 900_000 and 3_500_000 < avg_y < 4_900_000:
        # Estimar huso por la longitud equivalente
        # Huso 28: Canarias occidental (-18 a -12)
        # Huso 29: Galicia/Portugal (-12 a -6)
        # Huso 30: Centro España (-6 a 0)
        # Huso 31: Cataluña/Baleares (0 a 6)
        # Usamos la media X para estimar: el meridiano central varía
        if avg_x < 300_000:
            return "EPSG:25829"  # Huso 29
        elif avg_x < 500_000:
            return "EPSG:25830"  # Huso 30
        elif avg_x < 700_000:
            return "EPSG:25830"  # Huso 30 (parte alta)
        else:
            return "EPSG:25831"  # Huso 31

    return None


def _reproject_coords(
    coords: list[tuple[float, float]],
    source_crs: str,
    target_crs: str = "EPSG:4326",
) -> list[tuple[float, float]]:
    """Reproyecta coordenadas de source_crs a target_crs."""
    transformer = Transformer.from_crs(source_crs, target_crs, always_xy=True)
    return [transformer.transform(x, y) for x, y in coords]


# ─── Parseo de KML ──────────────────────────────────────────────────────────

_KML_NS = {"kml": "http://www.opengis.net/kml/2.2"}
_GML_NS = {
    "gml": "http://www.opengis.net/gml",
    "gml32": "http://www.opengis.net/gml/3.2",
}


def _parse_kml_coordinates(coord_text: str) -> list[tuple[float, float]]:
    """Parsea texto de <coordinates> KML a lista de (x, y)."""
    coords = []
    for token in coord_text.strip().split():
        parts = token.split(",")
        if len(parts) >= 2:
            coords.append((float(parts[0]), float(parts[1])))
    return coords


def _parse_gml_poslist(poslist_text: str, dim: int = 2) -> list[tuple[float, float]]:
    """Parsea texto de <posList> GML a lista de (x, y)."""
    values = poslist_text.strip().split()
    coords = []
    for i in range(0, len(values) - dim + 1, dim):
        # GML posList: lat lon (reverse) o x y según CRS
        coords.append((float(values[i]), float(values[i + 1])))
    return coords


def _extract_ring_coords(elem: etree._Element) -> list[tuple[float, float]]:
    """Extrae coordenadas de un <LinearRing> o <coordinates> hijo."""
    for child in elem.iter():
        child_local = etree.QName(child).localname
        if child_local == "coordinates" and child.text:
            coords = _parse_kml_coordinates(child.text)
            if len(coords) >= 3:
                return coords
    return []


def _parse_kml_polygons(root: etree._Element) -> list[dict]:
    """Parsea todos los <Polygon> del KML respetando outer/innerBoundaryIs."""
    polygons: list[dict] = []
    for elem in root.iter():
        local = etree.QName(elem).localname
        if local != "Polygon":
            continue

        exterior: list[tuple[float, float]] = []
        holes: list[list[tuple[float, float]]] = []

        for child in elem:
            child_local = etree.QName(child).localname
            if child_local == "outerBoundaryIs":
                exterior = _extract_ring_coords(child)
            elif child_local == "innerBoundaryIs":
                hole = _extract_ring_coords(child)
                if hole:
                    holes.append(hole)

        if not exterior:
            # Fallback: buscar LinearRing directamente bajo Polygon
            exterior = _extract_ring_coords(elem)

        if exterior:
            coords = [exterior, *holes] if holes else [exterior]
            polygons.append({"type": "Polygon", "coordinates": coords})

    return polygons


def parse_kml(kml_path: Path) -> dict:
    """Parsea un archivo KML catastral y devuelve GeoJSON Feature.

    Soporta:
    - KML estándar con múltiples Placemarks/Polygons
    - Estructura outerBoundaryIs / innerBoundaryIs
    - GML embebido en KML (<posList>)
    - Detección automática de CRS (UTM España → WGS84)

    Para KML catastrales con subparcelas, une todos los polígonos
    en una sola geometría de parcela.

    Args:
        kml_path: Ruta al archivo KML o GML.

    Returns:
        GeoJSON Feature dict con geometría en EPSG:4326.
    """
    tree = etree.parse(str(kml_path))  # noqa: S320
    root = tree.getroot()

    # 1. Parsear Polygons respetando estructura outer/inner
    polygon_dicts = _parse_kml_polygons(root)

    # 2. Si no hay polígonos KML, intentar GML <posList>
    if not polygon_dicts:
        rings: list[list[tuple[float, float]]] = []
        for elem in root.iter():
            local = etree.QName(elem).localname
            if local == "posList" and elem.text:
                dim = int(elem.get("srsDimension", "2"))
                coords = _parse_gml_poslist(elem.text, dim)
                if coords:
                    rings.append(coords)
        if rings:
            polygon_dicts = [{"type": "Polygon", "coordinates": [r]} for r in rings]

    if not polygon_dicts:
        msg = f"No se encontraron coordenadas en {kml_path}"
        raise ValueError(msg)

    # 3. Recopilar todas las coordenadas para detección CRS
    all_coords: list[tuple[float, float]] = []
    for pd in polygon_dicts:
        for ring in pd["coordinates"]:
            all_coords.extend(ring)

    source_crs = _detect_utm_zone(all_coords)

    # 4. Reproyectar si es UTM
    if source_crs:
        for pd in polygon_dicts:
            pd["coordinates"] = [
                _reproject_coords(ring, source_crs)
                for ring in pd["coordinates"]
            ]

    # 5. Construir geometría: unir todos los polígonos
    polygons = []
    for pd in polygon_dicts:
        geom = shape(pd)
        geom = orient(geom)
        if not geom.is_valid:
            geom = geom.buffer(0)
        if not geom.is_empty:
            polygons.append(geom)

    if not polygons:
        msg = f"Todos los polígonos vacíos en {kml_path}"
        raise ValueError(msg)

    # Unir en una sola geometría
    merged = unary_union(polygons)
    merged = orient(merged) if merged.geom_type == "Polygon" else merged
    geometry = mapping(merged)

    return {
        "type": "Feature",
        "properties": {
            "source_file": kml_path.name,
            "source_crs": source_crs,
        },
        "geometry": geometry,
    }


def parse_geojson(geojson_path: Path) -> dict:
    """Lee un archivo GeoJSON y devuelve el Feature (o el primer Feature de una FC)."""
    with open(geojson_path) as f:
        data = json.load(f)

    if data.get("type") == "FeatureCollection":
        features = data.get("features", [])
        if not features:
            msg = f"FeatureCollection vacía en {geojson_path}"
            raise ValueError(msg)
        return features[0]

    if data.get("type") == "Feature":
        return data

    # Es solo una geometría
    return {"type": "Feature", "properties": {}, "geometry": data}


# ─── Unión de parcelas ──────────────────────────────────────────────────────


def merge_parcels(geojson_features: list[dict]) -> dict:
    """Une N parcelas catastrales en una sola geometría de finca.

    Args:
        geojson_features: Lista de GeoJSON Features.

    Returns:
        GeoJSON Feature con la geometría unificada.
    """
    geometries = [shape(feat["geometry"]) for feat in geojson_features]
    merged = unary_union(geometries)

    source_files = [
        feat.get("properties", {}).get("source_file", "unknown")
        for feat in geojson_features
    ]

    return {
        "type": "Feature",
        "properties": {
            "source_files": source_files,
            "parcel_count": len(geojson_features),
        },
        "geometry": mapping(merged),
    }


# ─── Metadatos del AOI ──────────────────────────────────────────────────────


def compute_aoi_metadata(feature: dict, source_crs: str | None = None) -> AOIMetadata:
    """Calcula metadatos geométricos del AOI.

    Para cálculos de área/perímetro precisos, proyecta temporalmente a
    una proyección UTM adecuada.

    Args:
        feature: GeoJSON Feature en EPSG:4326.
        source_crs: CRS original de los datos (informativo).

    Returns:
        AOIMetadata con área, perímetro, centroide, bbox, etc.
    """
    geom = shape(feature["geometry"])
    centroid = geom.centroid

    # Proyectar a UTM para mediciones precisas en metros
    # Calcular huso UTM desde la longitud del centroide
    utm_zone = int((centroid.x + 180) / 6) + 1
    utm_crs = f"EPSG:326{utm_zone:02d}" if centroid.y >= 0 else f"EPSG:327{utm_zone:02d}"
    transformer = Transformer.from_crs("EPSG:4326", utm_crs, always_xy=True)

    # Transformar para medir
    from shapely import ops

    projected = ops.transform(transformer.transform, geom)

    area_m2 = abs(projected.area)
    perimeter_m = projected.length
    bounds = geom.bounds  # (minx, miny, maxx, maxy)

    # Contar vértices
    if geom.geom_type == "Polygon":
        vertex_count = len(geom.exterior.coords)
    elif geom.geom_type == "MultiPolygon":
        vertex_count = sum(len(p.exterior.coords) for p in geom.geoms)
    else:
        vertex_count = 0

    return AOIMetadata(
        area_ha=area_m2 / 10_000,
        perimeter_m=perimeter_m,
        centroid_lon=centroid.x,
        centroid_lat=centroid.y,
        bbox=(bounds[0], bounds[1], bounds[2], bounds[3]),
        vertex_count=vertex_count,
        source_crs=source_crs,
    )


def select_resolution(area_ha: float) -> dict:
    """Selecciona resolución de procesamiento según tamaño de finca.

    Returns:
        dict con dem_resolution_m, ortho_resolution_cm, max_triangles.
    """
    if area_ha < 100:
        return {"dem_resolution_m": 5, "ortho_resolution_cm": 5, "max_triangles": 200_000}
    elif area_ha < 500:
        return {"dem_resolution_m": 5, "ortho_resolution_cm": 10, "max_triangles": 500_000}
    elif area_ha < 2000:
        return {"dem_resolution_m": 5, "ortho_resolution_cm": 15, "max_triangles": 1_000_000}
    elif area_ha < 5000:
        return {"dem_resolution_m": 5, "ortho_resolution_cm": 25, "max_triangles": 2_000_000}
    else:
        return {"dem_resolution_m": 10, "ortho_resolution_cm": 50, "max_triangles": 3_000_000}
