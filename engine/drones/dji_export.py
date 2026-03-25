"""
DJI Pilot 2 KMZ mission export — generate KML/KMZ mission files
compatible with DJI Pilot 2 (Matrice 300/350, Mavic 3E, etc).
"""
from __future__ import annotations

import io
import zipfile
import xml.etree.ElementTree as ET
from typing import Any

from .models import FlightPlan, FlightPlanType


def export_dji_kmz(plan: FlightPlan, mission_name: str = "GeoTwin Mission") -> bytes:
    """
    Export a FlightPlan as DJI Pilot 2 compatible KMZ.

    Returns bytes of the KMZ file.
    """
    kml = _build_kml(plan, mission_name)
    wpml = _build_wpml(plan)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("wpmz/template.kml", kml)
        zf.writestr("wpmz/waylines.wpml", wpml)
    return buf.getvalue()


def _build_kml(plan: FlightPlan, mission_name: str) -> str:
    """Build DJI Pilot 2 template.kml content."""
    kml = ET.Element("kml", xmlns="http://www.opengis.net/kml/2.2")
    kml.set("xmlns:wpml", "http://www.dji.com/wpmz/1.0.0")

    doc = ET.SubElement(kml, "Document")

    # Mission config
    mission = ET.SubElement(doc, "wpml:missionConfig")
    _add(mission, "wpml:flyToWaylineMode", "safely")
    _add(mission, "wpml:finishAction", "goHome")
    _add(mission, "wpml:exitOnRCLost", "executeLostAction")
    _add(mission, "wpml:executeRCLostAction", "goBack")
    _add(mission, "wpml:globalTransitionalSpeed", str(plan.speed))

    # Folder with placemarks (waypoints)
    folder = ET.SubElement(doc, "Folder")
    _add(folder, "wpml:templateId", "0")
    _add(folder, "wpml:executeHeightMode", "relativeToStartPoint")
    _add(folder, "wpml:waylineId", "0")
    _add(folder, "wpml:autoFlightSpeed", str(plan.speed))

    for idx, wp in enumerate(plan.waypoints):
        pm = ET.SubElement(folder, "Placemark")
        point = ET.SubElement(pm, "Point")
        _add(point, "coordinates", f"{wp[0]},{wp[1]}")
        _add(pm, "wpml:index", str(idx))
        _add(pm, "wpml:executeHeight", str(wp[2] if len(wp) > 2 else plan.altitude_agl))
        _add(pm, "wpml:waypointSpeed", str(plan.speed))
        _add(pm, "wpml:waypointHeadingParam")
        _add(pm, "wpml:waypointTurnParam")

        # Add photo action at each waypoint
        action_group = ET.SubElement(pm, "wpml:actionGroup")
        _add(action_group, "wpml:actionGroupId", str(idx))
        _add(action_group, "wpml:actionGroupStartIndex", str(idx))
        _add(action_group, "wpml:actionGroupEndIndex", str(idx))
        _add(action_group, "wpml:actionGroupMode", "sequence")
        _add(action_group, "wpml:actionTrigger")

        action = ET.SubElement(action_group, "wpml:action")
        _add(action, "wpml:actionId", "0")
        _add(action, "wpml:actionActuatorFunc", "takePhoto")

    return ET.tostring(kml, encoding="unicode", xml_declaration=True)


def _build_wpml(plan: FlightPlan) -> str:
    """Build DJI Pilot 2 waylines.wpml content."""
    kml = ET.Element("kml", xmlns="http://www.opengis.net/kml/2.2")
    kml.set("xmlns:wpml", "http://www.dji.com/wpmz/1.0.0")

    doc = ET.SubElement(kml, "Document")

    # Mission config
    mission = ET.SubElement(doc, "wpml:missionConfig")
    _add(mission, "wpml:flyToWaylineMode", "safely")
    _add(mission, "wpml:finishAction", "goHome")
    _add(mission, "wpml:exitOnRCLost", "executeLostAction")
    _add(mission, "wpml:executeRCLostAction", "goBack")

    # Drone info
    drone = ET.SubElement(mission, "wpml:droneInfo")
    _add(drone, "wpml:droneEnumValue", "89")  # Generic DJI
    _add(drone, "wpml:droneSubEnumValue", "0")

    # Payload
    payload = ET.SubElement(mission, "wpml:payloadInfo")
    _add(payload, "wpml:payloadEnumValue", "52")  # Camera
    _add(payload, "wpml:payloadSubEnumValue", "0")
    _add(payload, "wpml:payloadPositionIndex", "0")

    # Folder (actual wayline)
    folder = ET.SubElement(doc, "Folder")
    _add(folder, "wpml:templateId", "0")
    _add(folder, "wpml:executeHeightMode", "relativeToStartPoint")
    _add(folder, "wpml:waylineId", "0")

    for idx, wp in enumerate(plan.waypoints):
        pm = ET.SubElement(folder, "Placemark")
        point = ET.SubElement(pm, "Point")
        _add(point, "coordinates", f"{wp[0]},{wp[1]}")
        _add(pm, "wpml:index", str(idx))
        alt = wp[2] if len(wp) > 2 else plan.altitude_agl
        _add(pm, "wpml:executeHeight", str(alt))
        _add(pm, "wpml:waypointSpeed", str(plan.speed))

    return ET.tostring(kml, encoding="unicode", xml_declaration=True)


def _add(parent: ET.Element, tag: str, text: str | None = None) -> ET.Element:
    """Add a sub-element with optional text."""
    el = ET.SubElement(parent, tag)
    if text is not None:
        el.text = text
    return el
