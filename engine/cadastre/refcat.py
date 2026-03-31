"""
Ingesta automática desde Referencia Catastral.

Usa los servicios WFS INSPIRE del Catastro de España para obtener
geometría de parcelas y edificios a partir de una referencia catastral.
"""

from __future__ import annotations

import logging
import re
from xml.etree import ElementTree as ET

import httpx
from shapely.geometry import shape, mapping
from shapely.ops import transform as shapely_transform
from pyproj import Transformer

logger = logging.getLogger(__name__)

# WFS INSPIRE endpoints del Catastro de España
WFS_PARCELS = "http://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx"
WFS_BUILDINGS = "http://ovc.catastro.meh.es/INSPIRE/wfsBU.aspx"
WFS_ADDRESSES = "http://ovc.catastro.meh.es/INSPIRE/wfsAD.aspx"
PHOTO_URL = (
    "https://ovc.catastro.meh.es/OVCServWeb/OVCWcfLibres/"
    "OVCFotoFachada.svc/RecuperarFotoFachadaGet"
)

# Regex for validating referencia catastral (14 or 20 chars)
_REFCAT_RE = re.compile(r"^[A-Za-z0-9]{14}([A-Za-z0-9]{6})?$")

# GML namespaces used by Catastro INSPIRE responses
_NS = {
    "gml": "http://www.opengis.net/gml/3.2",
    "cp": "urn:x-inspire:specification:gmlas:CadastralParcels:3.0",
    "bu": "urn:x-inspire:specification:gmlas:BuildingsBase:3.0",
    "bu-ext": "urn:x-inspire:specification:gmlas:BuildingsExtended:3.0",
    "wfs": "http://www.opengis.net/wfs/2.0",
}


def validate_refcat(refcat: str) -> str:
    """Valida y normaliza una referencia catastral.

    Raises ValueError if the format is invalid.
    """
    refcat = refcat.strip().upper()
    if not _REFCAT_RE.match(refcat):
        raise ValueError(
            f"Referencia catastral inválida: '{refcat}'. "
            "Debe tener 14 o 20 caracteres alfanuméricos."
        )
    return refcat


def _parse_gml_polygon(gml_element: ET.Element) -> dict | None:
    """Parse a GML Polygon/MultiSurface element into a GeoJSON geometry dict."""
    # Try gml:posList inside gml:LinearRing
    for pos_list in gml_element.iter(f"{{{_NS['gml']}}}posList"):
        text = pos_list.text
        if not text:
            continue
        # GML posList: "lat lon lat lon ..." — Note: GML uses lat,lon order!
        values = [float(v) for v in text.strip().split()]
        srs_dim = int(pos_list.get("srsDimension", "2"))

        coords = []
        for i in range(0, len(values), srs_dim):
            lat = values[i]
            lon = values[i + 1]
            coords.append([lon, lat])  # GeoJSON uses [lon, lat]

        if len(coords) >= 3:
            # Ensure ring is closed
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            return {"type": "Polygon", "coordinates": [coords]}

    return None


def _detect_srs(root: ET.Element) -> str | None:
    """Detect the SRS from a GML response."""
    for elem in root.iter():
        srs = elem.get("srsName")
        if srs:
            # Normalize: "urn:ogc:def:crs:EPSG::25830" → "EPSG:25830"
            if "EPSG" in srs:
                code = srs.rsplit(":", 1)[-1].rsplit("::", 1)[-1]
                return f"EPSG:{code}"
    return None


def _reproject_to_4326(geometry: dict, source_crs: str) -> dict:
    """Reproject a GeoJSON geometry to EPSG:4326 if needed."""
    if source_crs in ("EPSG:4326", "urn:ogc:def:crs:EPSG::4326"):
        return geometry

    transformer = Transformer.from_crs(source_crs, "EPSG:4326", always_xy=True)
    geom = shape(geometry)
    reprojected = shapely_transform(transformer.transform, geom)
    return mapping(reprojected)


async def fetch_parcel_by_refcat(
    refcat: str,
    srs: str = "EPSG::4326",
    timeout: float = 30.0,
) -> dict:
    """Descarga la geometría de la parcela por referencia catastral.

    Args:
        refcat: Referencia catastral (14 o 20 chars).
        srs: SRS para la respuesta.
        timeout: Timeout HTTP en segundos.

    Returns:
        GeoJSON Feature con el polígono de la parcela en EPSG:4326.

    Raises:
        ValueError: Refcat inválida.
        RuntimeError: Error en la descarga o parsing del WFS.
    """
    refcat = validate_refcat(refcat)

    url = (
        f"{WFS_PARCELS}?service=wfs&version=2"
        f"&request=getfeature&STOREDQUERIE_ID=GetParcel"
        f"&REFCAT={refcat}&srsname={srs}"
    )

    logger.info("Fetching parcel: %s", url)

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url)
        resp.raise_for_status()

    if not resp.content:
        raise RuntimeError(f"WFS returned empty response for refcat={refcat}")

    root = ET.fromstring(resp.content)

    # Check for exceptions
    exception = root.find(".//{http://www.opengis.net/ows/1.1}ExceptionText")
    if exception is not None and exception.text:
        raise RuntimeError(f"WFS error: {exception.text}")

    # Detect source SRS
    source_crs = _detect_srs(root) or "EPSG:4326"

    # Parse geometry
    geometry = None
    for member in root.iter(f"{{{_NS['gml']}}}surfaceMember"):
        geometry = _parse_gml_polygon(member)
        if geometry:
            break

    if geometry is None:
        # Try direct polygon search
        for poly in root.iter(f"{{{_NS['gml']}}}Polygon"):
            geometry = _parse_gml_polygon(poly)
            if geometry:
                break

    if geometry is None:
        raise RuntimeError(
            f"No geometry found in WFS response for refcat={refcat}. "
            f"Response: {resp.text[:500]}"
        )

    # Reproject to EPSG:4326 if needed
    geometry = _reproject_to_4326(geometry, source_crs)

    # Compute area in m²
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:25830", always_xy=True)
    geom = shape(geometry)
    projected = shapely_transform(transformer.transform, geom)
    area_m2 = projected.area

    # Extract reference info
    properties = {
        "refcat": refcat,
        "area_m2": area_m2,
        "area_ha": area_m2 / 10_000,
        "source_crs": source_crs,
    }

    # Try to extract nationalCadastralReference from the XML
    for ncr in root.iter(f"{{{_NS['cp']}}}nationalCadastralReference"):
        if ncr.text:
            properties["nationalCadastralReference"] = ncr.text

    feature = {
        "type": "Feature",
        "geometry": geometry,
        "properties": properties,
    }

    logger.info(
        "Parcel fetched: refcat=%s, area=%.2f ha, %d vertices",
        refcat, area_m2 / 10_000,
        len(geometry["coordinates"][0]) if geometry["type"] == "Polygon" else 0,
    )
    return feature


async def fetch_buildings_by_refcat(
    refcat: str,
    srs: str = "EPSG::4326",
    timeout: float = 30.0,
) -> list[dict]:
    """Descarga las huellas de edificios de la parcela.

    Args:
        refcat: Referencia catastral (14 o 20 chars).

    Returns:
        Lista de GeoJSON Features con la huella y propiedades de cada edificio.
    """
    refcat = validate_refcat(refcat)

    url = (
        f"{WFS_BUILDINGS}?service=wfs&version=2"
        f"&request=getfeature&STOREDQUERIE_ID=GETBUILDINGBYPARCEL"
        f"&refcat={refcat}&srsname={srs}"
    )

    logger.info("Fetching buildings: %s", url)

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url)
        resp.raise_for_status()

    if not resp.content:
        logger.info("No buildings found for refcat=%s", refcat)
        return []

    root = ET.fromstring(resp.content)
    source_crs = _detect_srs(root) or "EPSG:4326"

    buildings: list[dict] = []

    # Iterate over building members
    for member in root.iter(f"{{{_NS['wfs']}}}member"):
        geometry = None
        # Find geometry within this member
        for poly in member.iter(f"{{{_NS['gml']}}}Polygon"):
            geometry = _parse_gml_polygon(poly)
            if geometry:
                break

        if geometry is None:
            continue

        geometry = _reproject_to_4326(geometry, source_crs)

        # Extract building properties
        props: dict = {"refcat": refcat}

        for floors_el in member.iter(f"{{{_NS['bu']}}}numberOfFloorsAboveGround"):
            if floors_el.text:
                props["numberOfFloorsAboveGround"] = int(floors_el.text)

        for use_el in member.iter(f"{{{_NS['bu']}}}currentUse"):
            if use_el.text:
                props["currentUse"] = use_el.text

        # Compute area
        geom = shape(geometry)
        transformer = Transformer.from_crs("EPSG:4326", "EPSG:25830", always_xy=True)
        projected = shapely_transform(transformer.transform, geom)
        props["area_m2"] = projected.area

        buildings.append({
            "type": "Feature",
            "geometry": geometry,
            "properties": props,
        })

    logger.info("Buildings fetched: %d for refcat=%s", len(buildings), refcat)
    return buildings


async def fetch_building_photo(refcat: str, timeout: float = 15.0) -> bytes | None:
    """Descarga la foto de fachada si existe.

    Returns:
        Image bytes (JPEG) or None if not available.
    """
    refcat = validate_refcat(refcat)
    url = f"{PHOTO_URL}?ReferenciaCatastral={refcat}"

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url)
            if resp.status_code == 200 and len(resp.content) > 1000:
                logger.info("Building photo downloaded: %d bytes", len(resp.content))
                return resp.content
    except Exception as e:
        logger.debug("Building photo not available: %s", e)

    return None
