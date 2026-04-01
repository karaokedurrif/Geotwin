#!/usr/bin/env python3
"""
Test script: fetch building footprints from Catastro WFS and export as .OBJ

Usage:
  python scripts/test_building_wfs.py <REFCAT>
  python scripts/test_building_wfs.py 03065A00300038   # Example: Alicante rural

Outputs:
  scripts/output/buildings_<REFCAT>.obj   — 3D mesh viewable in Blender/MeshLab
  scripts/output/buildings_<REFCAT>.glb   — glTF binary for Three.js
  scripts/output/wfs_response.xml         — raw WFS XML (for debugging)

The script does NOT depend on Next.js or Fastify. Pure Python.
"""

from __future__ import annotations

import asyncio
import math
import sys
import logging
from pathlib import Path

# Ensure the engine package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("test_building_wfs")


async def main(refcat: str) -> None:
    from engine.cadastre.refcat import (
        fetch_parcel_by_refcat,
        fetch_buildings_by_refcat,
        validate_refcat,
    )
    from engine.buildings.extruder import extrude_building

    refcat = validate_refcat(refcat)
    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)

    # ── 1. Fetch parcel ────────────────────────────────────────────
    logger.info("=== Fetching parcel for %s ===", refcat)
    try:
        parcel = await fetch_parcel_by_refcat(refcat)
    except Exception as e:
        logger.error("Parcel fetch failed: %s", e)
        return

    props = parcel.get("properties", {})
    logger.info(
        "Parcel: area=%.2f ha, vertices=%d",
        props.get("area_ha", 0),
        len(parcel["geometry"]["coordinates"][0])
        if parcel["geometry"]["type"] == "Polygon"
        else 0,
    )

    # ── 2. Fetch buildings ─────────────────────────────────────────
    logger.info("=== Fetching buildings for %s ===", refcat)
    buildings = await fetch_buildings_by_refcat(refcat)

    if not buildings:
        logger.warning(
            "NO BUILDINGS FOUND for refcat=%s. "
            "This parcel may not have constructions in Catastro.",
            refcat,
        )
        # Try building parts too
        logger.info("Trying GetBuildingPartByParcel...")
        import httpx
        from xml.etree import ElementTree as ET

        url = (
            "http://ovc.catastro.meh.es/INSPIRE/wfsBU.aspx"
            f"?service=wfs&version=2&request=getfeature"
            f"&STOREDQUERIE_ID=GetBuildingPartByParcel"
            f"&refcat={refcat}&srsname=urn:ogc:def:crs:EPSG::4326"
        )
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
        xml_path = out_dir / "wfs_building_parts.xml"
        xml_path.write_bytes(resp.content)
        logger.info("Building parts XML saved to %s (%d bytes)", xml_path, len(resp.content))
        root = ET.fromstring(resp.content)
        logger.info("Root tag: %s", root.tag)
        for child in root:
            logger.info("  Child: %s", child.tag)
        return

    logger.info("Found %d building(s)", len(buildings))
    for i, b in enumerate(buildings):
        bp = b.get("properties", {})
        logger.info(
            "  Building %d: floors=%s, use=%s, area=%.1f m²",
            i,
            bp.get("numberOfFloorsAboveGround", "?"),
            bp.get("currentUse", "?"),
            bp.get("area_m2", 0),
        )

    # ── 3. Compute local origin from parcel centroid ───────────────
    from shapely.geometry import shape

    parcel_geom = shape(parcel["geometry"])
    centroid = parcel_geom.centroid
    c_lon, c_lat = centroid.x, centroid.y
    lat_rad = math.radians(c_lat)

    local_origin = {
        "centroid_lon": c_lon,
        "centroid_lat": c_lat,
        "min_elev": 0.0,  # No DEM in test mode — ground at 0
        "m_per_deg_lon": 111_320.0 * math.cos(lat_rad),
        "m_per_deg_lat": 111_320.0,
        "z_sign": -1,
    }
    logger.info(
        "Local origin: lon=%.6f, lat=%.6f, m/deg_lon=%.1f",
        c_lon, c_lat, local_origin["m_per_deg_lon"],
    )

    # ── 4. Extrude each building ───────────────────────────────────
    import trimesh

    scene = trimesh.Scene()
    for i, bldg_feature in enumerate(buildings):
        bp = bldg_feature["properties"]
        n_floors = max(1, bp.get("numberOfFloorsAboveGround", 1))

        logger.info(
            "Extruding building %d: %d floors × 3.0m = %.1fm",
            i, n_floors, n_floors * 3.0,
        )

        mesh = extrude_building(
            footprint=bldg_feature["geometry"],
            num_floors=n_floors,
            floor_height=3.0,
            ground_elevation=0.0,  # No DEM
            use=bp.get("currentUse", "agricultural"),
            origin=local_origin,
            metadata={"index": i},
        )

        logger.info(
            "  Result: %d verts, %d faces, "
            "bbox X=[%.1f..%.1f] Y=[%.1f..%.1f] Z=[%.1f..%.1f]",
            len(mesh.vertices),
            len(mesh.faces),
            mesh.vertices[:, 0].min(),
            mesh.vertices[:, 0].max(),
            mesh.vertices[:, 1].min(),
            mesh.vertices[:, 1].max(),
            mesh.vertices[:, 2].min(),
            mesh.vertices[:, 2].max(),
        )

        scene.add_geometry(mesh, node_name=f"building_{i}")

    # ── 5. Export .OBJ and .GLB ────────────────────────────────────
    obj_path = out_dir / f"buildings_{refcat}.obj"
    glb_path = out_dir / f"buildings_{refcat}.glb"

    scene.export(str(obj_path), file_type="obj")
    scene.export(str(glb_path), file_type="glb")

    logger.info("=== DONE ===")
    logger.info("OBJ: %s (%.1f KB)", obj_path, obj_path.stat().st_size / 1024)
    logger.info("GLB: %s (%.1f KB)", glb_path, glb_path.stat().st_size / 1024)
    logger.info(
        "Open in Blender: File → Import → Wavefront (.obj) → %s",
        obj_path.resolve(),
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/test_building_wfs.py <REFCAT>")
        print("Example: python scripts/test_building_wfs.py 03065A00300038")
        sys.exit(1)

    asyncio.run(main(sys.argv[1]))
