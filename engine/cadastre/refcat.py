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
    "bu": "urn:x-inspire:specification:gmlas:Buildings:3.0",
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
    """Detect the SRS from a GML response.

    Handles multiple formats:
    - URN: urn:ogc:def:crs:EPSG::25830
    - URL: http://www.opengis.net/def/crs/EPSG/0/25830
    - Short: EPSG:4326
    """
    for elem in root.iter():
        srs = elem.get("srsName")
        if srs:
            if "EPSG" not in srs:
                continue
            # URL format: http://www.opengis.net/def/crs/EPSG/0/XXXX
            import re as _re
            url_match = _re.search(r"/EPSG/\d+/(\d+)", srs)
            if url_match:
                return f"EPSG:{url_match.group(1)}"
            # URN format: urn:ogc:def:crs:EPSG::25830
            urn_match = _re.search(r"EPSG:{1,2}(\d+)", srs)
            if urn_match:
                return f"EPSG:{urn_match.group(1)}"
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
    srs: str = "urn:ogc:def:crs:EPSG::4326",
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
    srs: str = "urn:ogc:def:crs:EPSG::4326",
    timeout: float = 30.0,
) -> list[dict]:
    """Descarga las huellas de edificios de la parcela.

    The Catastro INSPIRE WFS returns buildings in GML FeatureCollection
    using ``gml:featureMember`` (NOT ``wfs:member``). Building properties
    use varying namespace prefixes (``bu-base``, ``bu-ext2d``…) so we
    match element local-names instead of fixed namespace URIs.

    Args:
        refcat: Referencia catastral (14 o 20 chars).

    Returns:
        Lista de GeoJSON Features con la huella y propiedades de cada edificio.
    """
    refcat = validate_refcat(refcat)

    url = (
        f"{WFS_BUILDINGS}?service=wfs&version=2"
        f"&request=getfeature&STOREDQUERIE_ID=GetBuildingByParcel"
        f"&REFCAT={refcat}&srsname={srs}"
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

    # ── Helper: strip namespace from tag ──
    def _local(tag: str) -> str:
        return tag.split("}")[-1] if "}" in tag else tag

    # ── Iterate over gml:featureMember OR wfs:member ──
    members: list[ET.Element] = []
    for elem in root:
        local = _local(elem.tag)
        if local in ("featureMember", "member"):
            members.append(elem)

    if not members:
        logger.info(
            "No featureMember/member elements in WFS response for refcat=%s "
            "(root tag=%s, children=%d)",
            refcat, _local(root.tag), len(list(root)),
        )
        return []

    logger.info("Found %d featureMember(s) in WFS response", len(members))

    for member in members:
        geometry = None

        # Find geometry: try gml:Polygon, then gml:PolygonPatch
        for tag_name in ("Polygon", "PolygonPatch"):
            for poly in member.iter(f"{{{_NS['gml']}}}{tag_name}"):
                geometry = _parse_gml_polygon(poly)
                if geometry:
                    break
            if geometry:
                break

        # Fallback: search by local tag name (some responses use alt ns)
        if geometry is None:
            for elem in member.iter():
                if _local(elem.tag) in ("Polygon", "PolygonPatch", "Surface"):
                    geometry = _parse_gml_polygon(elem)
                    if geometry:
                        break

        # Last resort: find any posList directly in the member tree
        if geometry is None:
            geometry = _parse_gml_polygon(member)

        if geometry is None:
            logger.debug("Member has no parseable Polygon — skipping")
            continue

        geometry = _reproject_to_4326(geometry, source_crs)

        # ── Extract building properties by local name ──
        props: dict = {"refcat": refcat}

        for elem in member.iter():
            local_tag = _local(elem.tag)

            if local_tag == "numberOfFloorsAboveGround":
                # May be nil='true' — check for xsi:nil or nilReason
                nil_attr = elem.get("{http://www.w3.org/2001/XMLSchema-instance}nil")
                nil_reason = elem.get("nilReason") or elem.get("nil")
                if nil_attr == "true" or nil_reason:
                    # No floor data — will be forced to 1 below
                    continue
                if elem.text and elem.text.strip().isdigit():
                    props["numberOfFloorsAboveGround"] = int(elem.text.strip())

            elif local_tag == "currentUse" and elem.text:
                raw_use = elem.text.strip()
                # Catastro format: "1_residential" → "residential"
                if "_" in raw_use:
                    raw_use = raw_use.split("_", 1)[1]
                props["currentUse"] = raw_use

            elif local_tag == "value":
                # officialArea > OfficialArea > value
                uom = elem.get("uom", "")
                if uom == "m2" and elem.text:
                    try:
                        props["officialArea_m2"] = float(elem.text.strip())
                    except ValueError:
                        pass

            elif local_tag == "numberOfBuildingUnits" and elem.text:
                try:
                    props["numberOfBuildingUnits"] = int(elem.text.strip())
                except ValueError:
                    pass

        # Force minimum 1 floor — a building with 0/missing floors is not visible
        if props.get("numberOfFloorsAboveGround", 0) < 1:
            props["numberOfFloorsAboveGround"] = 1
            logger.warning(
                "Building has 0 or missing floors → forcing 1 floor (3m)"
            )

        # Compute area from geometry
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

    # ── Fallback: if WFS returned no buildings, try DNPRC API ──
    if not buildings:
        logger.info(
            "WFS returned 0 buildings for %s — trying DNPRC fallback", refcat
        )
        fallback = await _dnprc_fallback_buildings(refcat, timeout=timeout)
        if fallback:
            buildings = fallback

    return buildings


# ─── DNPRC API Endpoints (non-INSPIRE, always available) ────────────────────

DNPRC_URL = (
    "http://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/"
    "COVCCallejero.svc/json/Consulta_DNPRC"
)


async def _dnprc_fallback_buildings(
    refcat: str,
    timeout: float = 15.0,
) -> list[dict]:
    """Create synthetic building footprints from Catastro DNPRC descriptive data.

    When the WFS INSPIRE building service returns empty, this function
    queries the DNPRC API (which always has data) to get construction
    area and floors, then generates a rectangular footprint centered
    on the parcel centroid.

    Returns:
        List of GeoJSON Features, or empty list if no constructions found.
    """
    try:
        # Fetch parcel to get centroid
        parcel = await fetch_parcel_by_refcat(refcat, timeout=timeout)
        parcel_geom = shape(parcel["geometry"])
        centroid = parcel_geom.centroid
        c_lon, c_lat = centroid.x, centroid.y

        # Fetch descriptive data from DNPRC
        url = f"{DNPRC_URL}?RefCat={refcat}"
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url)
            resp.raise_for_status()

        data = resp.json()
        result = data.get("consulta_dnprcResult", {})

        if result.get("control", {}).get("cuerr"):
            logger.info("DNPRC returned error for %s", refcat)
            return []

        bico = result.get("bico", {})
        bi = bico.get("bi", {})
        # When there are multiple units, bi may be a list — use first
        if isinstance(bi, list):
            bi = bi[0] if bi else {}
        debi = bi.get("debi", {})
        if isinstance(debi, list):
            debi = debi[0] if debi else {}
        sfc_str = debi.get("sfc", "0")
        sfc = float(sfc_str) if sfc_str else 0.0

        if sfc <= 0:
            logger.info(
                "No construction area (sfc=0) for refcat=%s — no buildings",
                refcat,
            )
            return []

        # Extract construction details if available
        lcons = bico.get("lcons", {})
        cons_list = lcons.get("cons", [])
        if isinstance(cons_list, dict):
            cons_list = [cons_list]

        # Determine floors and use from construction details
        num_floors = 1
        use = "agricultural"
        for cons in cons_list:
            lcd = cons.get("lcd", "")
            if lcd and lcd[0].isdigit():
                try:
                    num_floors = max(num_floors, int(lcd[0]))
                except ValueError:
                    pass
            dt = cons.get("dt", {})
            if "stl" in dt:
                stl = dt["stl"]
                if "residencial" in stl.lower() or "vivienda" in stl.lower():
                    use = "residential"
                elif "industrial" in stl.lower() or "almac" in stl.lower():
                    use = "industrial"
                elif "agrario" in stl.lower():
                    use = "agricultural"

        # Generate a rectangular footprint from construction area
        # Approximate: sqrt(area) × sqrt(area) → but elongated 1.5:1
        import math

        side_short = math.sqrt(sfc / 1.5)
        side_long = side_short * 1.5

        # Convert meters to degrees
        lat_rad = math.radians(c_lat)
        m_per_deg_lon = 111_320.0 * math.cos(lat_rad)
        m_per_deg_lat = 111_320.0

        dx = (side_long / 2) / m_per_deg_lon
        dy = (side_short / 2) / m_per_deg_lat

        # Create rectangular polygon centered on parcel centroid
        ring = [
            [c_lon - dx, c_lat - dy],
            [c_lon + dx, c_lat - dy],
            [c_lon + dx, c_lat + dy],
            [c_lon - dx, c_lat + dy],
            [c_lon - dx, c_lat - dy],
        ]

        props = {
            "refcat": refcat,
            "numberOfFloorsAboveGround": max(1, num_floors),
            "currentUse": use,
            "area_m2": sfc,
            "synthetic": True,  # Flag: footprint is approximate
        }

        logger.info(
            "DNPRC fallback: sfc=%.0f m², %d floors, use=%s → "
            "synthetic %.1f×%.1f m footprint at (%.6f, %.6f)",
            sfc, num_floors, use, side_long, side_short, c_lon, c_lat,
        )

        return [{
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": props,
        }]

    except Exception as e:
        logger.warning("DNPRC fallback failed for %s: %s", refcat, e)
        return []


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
