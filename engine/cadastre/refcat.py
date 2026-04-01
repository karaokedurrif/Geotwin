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


# Catastro reverse-geocoding endpoint (coordinates → refcat)
_OVC_COORDS = (
    "https://ovc.catastro.meh.es/ovcservweb/"
    "OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR"
)


async def refcat_from_coords(lon: float, lat: float) -> str | None:
    """Reverse-geocode WGS84 lon/lat to the 14-char referencia catastral.

    Uses the Catastro OVCCoordenadas service. Returns None if no parcel is
    found at those coordinates.
    """
    # The API expects X=lon, Y=lat when SRS=EPSG:4326
    params = {
        "SRS": "EPSG:4326",
        "Coordenada_X": str(lon),
        "Coordenada_Y": str(lat),
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(_OVC_COORDS, params=params)
        resp.raise_for_status()

    root = ET.fromstring(resp.text)
    # Response XML: <consulta_coordenadas><coordenadas><coord><pc><pc1>...</pc1><pc2>...</pc2></pc>...
    ns = {"": "http://www.catastro.meh.es/"}
    # Try without namespace first (sometimes returned without it)
    pc1 = root.findtext(".//pc1") or root.findtext(".//pc/pc1", namespaces=ns)
    pc2 = root.findtext(".//pc2") or root.findtext(".//pc/pc2", namespaces=ns)

    if pc1 and pc2:
        refcat = (pc1 + pc2).strip()
        logger.info("Reverse-geocoded (%.6f, %.6f) → refcat=%s", lon, lat, refcat)
        return refcat

    # Fallback: scan all text for a 14-char pattern
    for elem in root.iter():
        txt = (elem.text or "").strip()
        if _REFCAT_RE.match(txt):
            logger.info("Reverse-geocoded (%.6f, %.6f) → refcat=%s (fallback)", lon, lat, txt)
            return txt

    logger.warning("No refcat found at (%.6f, %.6f)", lon, lat)
    return None


def _parse_gml_polygon(gml_element: ET.Element) -> dict | None:
    """Parse a GML Polygon/MultiSurface element into a GeoJSON geometry dict.

    Returns the FIRST ring found.  For multi-polygon parsing use
    ``_parse_gml_all_polygons``.
    """
    for pos_list in gml_element.iter(f"{{{_NS['gml']}}}posList"):
        text = pos_list.text
        if not text:
            continue
        values = [float(v) for v in text.strip().split()]
        srs_dim = int(pos_list.get("srsDimension", "2"))

        coords = []
        for i in range(0, len(values), srs_dim):
            lat = values[i]
            lon = values[i + 1]
            coords.append([lon, lat])

        if len(coords) >= 3:
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            return {"type": "Polygon", "coordinates": [coords]}

    return None


def _parse_gml_all_polygons(gml_element: ET.Element) -> list[dict]:
    """Extract ALL polygon rings from a GML element (multiple PolygonPatches).

    Returns a list of GeoJSON Polygon geometries — one per PolygonPatch / posList.
    """
    polygons: list[dict] = []
    for pos_list in gml_element.iter(f"{{{_NS['gml']}}}posList"):
        text = pos_list.text
        if not text:
            continue
        values = [float(v) for v in text.strip().split()]
        srs_dim = int(pos_list.get("srsDimension", "2"))

        coords = []
        for i in range(0, len(values), srs_dim):
            lat = values[i]
            lon = values[i + 1]
            coords.append([lon, lat])

        if len(coords) >= 3:
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            polygons.append({"type": "Polygon", "coordinates": [coords]})
    return polygons


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

    Strategy:
    1. ``GetBuildingPartByParcel`` → individual volumes with per-part floor counts
    2. If no parts: ``GetBuildingByParcel`` → building envelope, split multi-surface
       into separate polygons
    3. If still empty: DNPRC fallback (synthetic footprints)

    Heights come from per-part ``numberOfFloorsAboveGround``.  When nil,
    we fall back to DNPRC construction data to estimate plausible heights.
    """
    refcat = validate_refcat(refcat)

    def _local(tag: str) -> str:
        return tag.split("}")[-1] if "}" in tag else tag

    # ── 1. Try GetBuildingPartByParcel first (individual volumes) ──
    parts_url = (
        f"{WFS_BUILDINGS}?service=wfs&version=2"
        f"&request=getfeature&STOREDQUERIE_ID=GetBuildingPartByParcel"
        f"&REFCAT={refcat}&srsname={srs}"
    )
    logger.info("Fetching building parts: %s", parts_url)

    buildings: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            parts_resp = await client.get(parts_url)
            parts_resp.raise_for_status()

        if parts_resp.content:
            parts_root = ET.fromstring(parts_resp.content)
            # Check it's not an exception
            exc = parts_root.find(".//{http://www.opengis.net/ows/1.1}ExceptionText")
            if exc is None or not exc.text:
                source_crs = _detect_srs(parts_root) or "EPSG:4326"
                buildings = _parse_building_members(parts_root, refcat, source_crs)
                if buildings:
                    logger.info(
                        "BuildingParts: %d volumes for refcat=%s",
                        len(buildings), refcat,
                    )
    except Exception as pe:
        logger.warning("GetBuildingPartByParcel failed: %s", pe)

    # ── 2. Fallback: GetBuildingByParcel (building envelope) ──
    if not buildings:
        env_url = (
            f"{WFS_BUILDINGS}?service=wfs&version=2"
            f"&request=getfeature&STOREDQUERIE_ID=GetBuildingByParcel"
            f"&REFCAT={refcat}&srsname={srs}"
        )
        logger.info("Fetching building envelope: %s", env_url)

        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(env_url)
            resp.raise_for_status()

        if resp.content:
            root = ET.fromstring(resp.content)
            exc = root.find(".//{http://www.opengis.net/ows/1.1}ExceptionText")
            if exc is not None and exc.text:
                logger.warning("WFS error: %s", exc.text)
            else:
                source_crs = _detect_srs(root) or "EPSG:4326"
                # Parse ALL PolygonPatches as separate buildings (multi-surface)
                buildings = _parse_building_members(
                    root, refcat, source_crs, split_multi_surface=True,
                )
                logger.info(
                    "BuildingByParcel: %d polygons for refcat=%s",
                    len(buildings), refcat,
                )

    # ── 3. Enrich heights from DNPRC when floors are missing/nil ──
    if buildings:
        await _enrich_heights_from_dnprc(buildings, refcat, timeout)

    # ── 4. Final fallback: DNPRC synthetic ──
    if not buildings:
        logger.info(
            "WFS returned 0 buildings for %s — trying DNPRC fallback", refcat
        )
        fallback = await _dnprc_fallback_buildings(refcat, timeout=timeout)
        if fallback:
            buildings = fallback

    logger.info(
        "Buildings total: %d for refcat=%s, total_area=%.0f m²",
        len(buildings),
        refcat,
        sum(b["properties"].get("area_m2", 0) for b in buildings),
    )
    return buildings


def union_adjacent_buildings(
    buildings: list[dict],
    buffer_m: float = 2.0,
) -> list[dict]:
    """Union adjacent building footprints into larger combined meshes.

    Buildings whose footprints touch (or are within ``buffer_m`` meters)
    are merged into a single polygon.  The resulting feature inherits
    the **maximum** floor count and height from contributing parts.

    This makes small adjacent BuildingParts appear as a single continuous
    complex rather than isolated boxes.
    """
    if len(buildings) <= 1:
        return buildings

    from shapely.geometry import shape as _shape, mapping as _mapping
    from shapely.ops import unary_union
    import math

    # Approximate buffer in degrees (at mid-latitude)
    mid_lat = 41.59  # default Iberian latitude
    for b in buildings:
        geom = _shape(b["geometry"])
        if geom.centroid.y > 0:
            mid_lat = geom.centroid.y
            break
    m_per_deg = 111_320.0 * math.cos(math.radians(mid_lat))
    buffer_deg = buffer_m / m_per_deg

    polys = [_shape(b["geometry"]) for b in buildings]
    buffered = [p.buffer(buffer_deg) for p in polys]

    # Group by connectivity: if buffered polygons intersect, they belong
    # to the same cluster.
    n = len(polys)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def unite(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(n):
        for j in range(i + 1, n):
            if buffered[i].intersects(buffered[j]):
                unite(i, j)

    # Collect clusters
    clusters: dict[int, list[int]] = {}
    for i in range(n):
        root = find(i)
        clusters.setdefault(root, []).append(i)

    merged: list[dict] = []
    for indices in clusters.values():
        if len(indices) == 1:
            merged.append(buildings[indices[0]])
            continue

        # Union the original (unbuffered) polygons
        group_polys = [polys[i] for i in indices]
        union_poly = unary_union(group_polys)

        # Take max floors and height from contributing parts
        max_floors = max(
            buildings[i]["properties"].get("numberOfFloorsAboveGround", 1)
            for i in indices
        )
        # Collect all properties from the first, override key fields
        props = dict(buildings[indices[0]]["properties"])
        props["numberOfFloorsAboveGround"] = max_floors
        props["_merged_from"] = len(indices)

        # Compute combined area
        from pyproj import Transformer
        from shapely.ops import transform as shapely_transform
        t = Transformer.from_crs("EPSG:4326", "EPSG:25830", always_xy=True)
        proj_union = shapely_transform(t.transform, union_poly)
        props["area_m2"] = proj_union.area

        # Handle MultiPolygon from union (keep as separate features)
        if union_poly.geom_type == "MultiPolygon":
            for sub in union_poly.geoms:
                sub_proj = shapely_transform(t.transform, sub)
                sub_props = dict(props)
                sub_props["area_m2"] = sub_proj.area
                merged.append({
                    "type": "Feature",
                    "geometry": _mapping(sub),
                    "properties": sub_props,
                })
        else:
            merged.append({
                "type": "Feature",
                "geometry": _mapping(union_poly),
                "properties": props,
            })

    total_before = sum(p.area for p in polys) * m_per_deg * 111_320
    total_after = sum(
        _shape(b["geometry"]).area for b in merged
    ) * m_per_deg * 111_320
    logger.info(
        "Union adjacent buildings: %d → %d features, "
        "area %.0f → %.0f m² (buffer=%.1fm)",
        len(buildings), len(merged), total_before, total_after, buffer_m,
    )
    return merged


def _parse_building_members(
    root: ET.Element,
    refcat: str,
    source_crs: str,
    *,
    split_multi_surface: bool = False,
) -> list[dict]:
    """Parse featureMembers from a WFS Building/BuildingPart response.

    When ``split_multi_surface`` is True, a single featureMember with
    multiple PolygonPatches is split into separate buildings (one per patch).
    """
    def _local(tag: str) -> str:
        return tag.split("}")[-1] if "}" in tag else tag

    members: list[ET.Element] = []
    for elem in root:
        local = _local(elem.tag)
        if local in ("featureMember", "member"):
            members.append(elem)

    if not members:
        return []

    buildings: list[dict] = []
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:25830", always_xy=True)

    for member in members:
        # ── Extract common properties ──
        props: dict = {"refcat": refcat}

        for elem in member.iter():
            local_tag = _local(elem.tag)

            if local_tag == "numberOfFloorsAboveGround":
                nil_attr = elem.get(
                    "{http://www.w3.org/2001/XMLSchema-instance}nil"
                )
                nil_reason = elem.get("nilReason") or elem.get("nil")
                if nil_attr == "true" or nil_reason:
                    props["_floors_nil"] = True
                    continue
                if elem.text and elem.text.strip().isdigit():
                    val = int(elem.text.strip())
                    props["numberOfFloorsAboveGround"] = val

            elif local_tag == "currentUse" and elem.text:
                raw_use = elem.text.strip()
                if "_" in raw_use:
                    raw_use = raw_use.split("_", 1)[1]
                props["currentUse"] = raw_use

            elif local_tag == "value":
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

        # ── Parse geometry ──
        if split_multi_surface:
            all_polys = _parse_gml_all_polygons(member)
        else:
            single = _parse_gml_polygon(member)
            all_polys = [single] if single else []

        for poly_geom in all_polys:
            geom = _reproject_to_4326(poly_geom, source_crs)
            p = dict(props)  # copy per-polygon

            # Compute area from geometry
            shp = shape(geom)
            projected = shapely_transform(transformer.transform, shp)
            p["area_m2"] = projected.area

            # Floor defaults: 0 or nil → marked for DNPRC enrichment
            if p.get("numberOfFloorsAboveGround", 0) < 1:
                p["_floors_nil"] = True

            buildings.append({
                "type": "Feature",
                "geometry": geom,
                "properties": p,
            })

    logger.info("Parsed %d building polygons from %d featureMembers", len(buildings), len(members))
    return buildings


async def _enrich_heights_from_dnprc(
    buildings: list[dict],
    refcat: str,
    timeout: float = 15.0,
) -> None:
    """Enrich building floor counts using DNPRC construction data.

    For each building with nil/0 floors, estimate height heuristically:
    - Official area ≥ 200 m² → likely industrial nave → 3..4 floors equiv
    - Official area < 200 m² → smaller structure → 1 floor
    - If DNPRC has construction details with stl areas, use those to
      estimate floor heights.
    """
    needs_enrichment = any(
        b["properties"].get("_floors_nil") for b in buildings
    )
    if not needs_enrichment:
        return

    # Fetch DNPRC data for floor/area details
    dnprc_url = (
        "http://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/"
        "COVCCallejero.svc/json/Consulta_DNPRC"
    )
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"{dnprc_url}?RefCat={refcat}")
            resp.raise_for_status()
        data = resp.json()
        result = data.get("consulta_dnprcResult", {})

        if result.get("control", {}).get("cuerr"):
            logger.info("DNPRC returned error for %s — using heuristic heights", refcat)
            _apply_heuristic_heights(buildings)
            return

        bico = result.get("bico", {})
        lcons = bico.get("lcons", {})
        # lcons can be a list (multiple units) or dict with "cons" key
        if isinstance(lcons, list):
            cons_list = lcons
        elif isinstance(lcons, dict):
            cons_list = lcons.get("cons", [])
        else:
            cons_list = []
        if isinstance(cons_list, dict):
            cons_list = [cons_list]

        # Sum total construction area from DNPRC
        total_stl = 0
        max_stl = 0
        for cons in cons_list:
            # stl may be in dfcons.stl (new format) or dt.stl (old format)
            dfcons = cons.get("dfcons", {})
            stl = float(dfcons.get("stl", 0) or cons.get("stl", 0) or 0)
            total_stl += stl
            max_stl = max(max_stl, stl)

        logger.info(
            "DNPRC constructions: %d units, total_stl=%.0f m², max_unit=%.0f m²",
            len(cons_list), total_stl, max_stl,
        )

        # Detect dominant use from DNPRC lcd (land classification)
        dnprc_use = "agricultural"
        for cons in cons_list:
            lcd = (cons.get("lcd", "") or "").lower()
            dvcons = cons.get("dvcons", {})
            dtip = (dvcons.get("dtip", "") if isinstance(dvcons, dict) else "").lower()
            if "industr" in lcd or "industr" in dtip:
                dnprc_use = "industrial"
                break
            elif "residenc" in lcd or "viviend" in dtip:
                dnprc_use = "residential"
            elif "comerc" in lcd:
                dnprc_use = "commercial"

        # Propagate use to all buildings without one
        for b in buildings:
            if not b["properties"].get("currentUse"):
                b["properties"]["currentUse"] = dnprc_use

        # Heuristic: if total construction area is large → industrial/agricultural
        # estimate height from area:
        #   - naves > 200 m² → 2 floors equivalent (6-8m height)
        #   - naves > 100 m² → 1.5 floors (4.5m)
        #   - smaller → 1 floor (3m)
        for b in buildings:
            if not b["properties"].get("_floors_nil"):
                continue

            area = b["properties"].get("area_m2", 0)
            # For nil-floor buildings: estimate based on footprint area
            # Industrial naves with 6m floor_height:
            #   1 floor=6m, 2 floors=12m — already realistic for naves
            if area >= 200:
                b["properties"]["numberOfFloorsAboveGround"] = 2  # ~12m nave
            elif area >= 50:
                b["properties"]["numberOfFloorsAboveGround"] = 2  # ~12m
            else:
                b["properties"]["numberOfFloorsAboveGround"] = 1  # ~6m

            # Boost if DNPRC shows large total construction area (bodega/industrial)
            if total_stl > 500 and area >= 100:
                b["properties"]["numberOfFloorsAboveGround"] = max(
                    b["properties"]["numberOfFloorsAboveGround"], 2
                )  # industrial complex → at least ~12m with 6m floor_height

            b["properties"].pop("_floors_nil", None)
            logger.info(
                "Enriched building (area=%.0f m²) → %d floors",
                area, b["properties"]["numberOfFloorsAboveGround"],
            )

    except Exception as e:
        logger.warning("DNPRC enrichment failed: %s — using heuristics", e)
        _apply_heuristic_heights(buildings)


def _apply_heuristic_heights(buildings: list[dict]) -> None:
    """Fallback height estimation when DNPRC is unavailable."""
    for b in buildings:
        if not b["properties"].get("_floors_nil"):
            continue
        area = b["properties"].get("area_m2", 0)
        if area >= 100:
            b["properties"]["numberOfFloorsAboveGround"] = 2
        else:
            b["properties"]["numberOfFloorsAboveGround"] = 1
        b["properties"].pop("_floors_nil", None)


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
