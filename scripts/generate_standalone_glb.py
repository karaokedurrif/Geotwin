#!/usr/bin/env python3
"""
generate_standalone_glb.py — Genera un GLB texturizado de una parcela catastral
sin depender del pipeline de GeoTwin.

Uso:
    cd ~/Documentos/Geotwin
    source .venv/bin/activate
    python scripts/generate_standalone_glb.py 0100602VL1300S palacio_gallinero.glb

Requiere:
    pip install httpx lxml trimesh pillow scipy numpy
"""
import asyncio
import sys
import logging
from pathlib import Path

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)


async def generate_parcel_glb(refcat: str, output_path: str) -> None:
    """Pipeline mínimo: refcat → WFS Catastro → DEM IGN → PNOA → mesh → GLB."""
    import httpx
    from lxml import etree
    import trimesh
    from trimesh.visual.material import PBRMaterial
    from trimesh.visual import TextureVisuals
    from PIL import Image
    from io import BytesIO
    from scipy.interpolate import RegularGridInterpolator
    from scipy.spatial import Delaunay

    # ── 1. Descargar parcela del WFS Catastro ────────────────────────────
    log.info(f"[1/6] Descargando parcela {refcat} del WFS Catastro...")
    wfs_url = (
        "http://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx"
        "?service=wfs&version=2&request=getfeature"
        f"&STOREDQUERIE_ID=GetParcel&REFCAT={refcat}&srsname=EPSG::4326"
    )
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(wfs_url)
    r.raise_for_status()

    ns = {"gml": "http://www.opengis.net/gml/3.2"}
    root = etree.fromstring(r.content)
    pos_list = root.find(".//gml:posList", ns)
    if pos_list is not None and pos_list.text:
        coords_text = pos_list.text.strip()
    else:
        coords_text = " ".join(p.text.strip() for p in root.findall(".//gml:pos", ns) if p.text)

    if not coords_text:
        raise ValueError(f"No se encontraron coordenadas para {refcat}")

    values = [float(v) for v in coords_text.split()]
    # WFS Catastro devuelve lat,lon — convertir a lon,lat
    coords = [(values[i + 1], values[i]) for i in range(0, len(values) - 1, 2)]
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    log.info(f"  → {len(coords)} vértices, centroid ≈ ({np.mean(lons):.6f}, {np.mean(lats):.6f})")

    # Bbox con buffer ≥20% o ≥50m (golden rule)
    width_deg = max(lons) - min(lons)
    height_deg = max(lats) - min(lats)
    buf_lon = max(width_deg * 0.20, 50 / 111000)
    buf_lat = max(height_deg * 0.20, 50 / 111000)
    bbox = (
        min(lons) - buf_lon,
        min(lats) - buf_lat,
        max(lons) + buf_lon,
        max(lats) + buf_lat,
    )

    # ── 2. DEM (MDT02 → MDT05 fallback, IGN WCS) ──────────────────────
    log.info("[2/6] Descargando DEM (WCS IGN)...")
    wcs_url = "https://servicios.idee.es/wcs-inspire/mdt"
    # Buffer DEM más amplio (50 m) para garantizar coverage en parcelas pequeñas
    dem_buf = 50 / 111000
    dem_bbox = (bbox[0] - dem_buf, bbox[1] - dem_buf, bbox[2] + dem_buf, bbox[3] + dem_buf)

    dem: np.ndarray = np.array([])
    for coverage_id in ("Elevacion4258_2", "Elevacion4258_5"):  # MDT02 → MDT05 fallback
        wcs_params = {
            "SERVICE": "WCS",
            "VERSION": "2.0.1",
            "REQUEST": "GetCoverage",
            "COVERAGEID": coverage_id,
            "FORMAT": "image/tiff",
            "SUBSET": [f"Lat({dem_bbox[1]},{dem_bbox[3]})", f"Long({dem_bbox[0]},{dem_bbox[2]})"],
        }
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.get(wcs_url, params=wcs_params)
        if r.status_code == 200 and len(r.content) > 5000:
            try:
                dem_img = Image.open(BytesIO(r.content))
                arr = np.array(dem_img, dtype=float)
                arr[arr < -1000] = np.nan
                valid = arr[~np.isnan(arr)]
                if valid.size > 0:
                    arr = np.nan_to_num(arr, nan=np.nanmean(valid))
                    dem = arr
                    log.info(f"  → DEM {dem.shape} ({coverage_id}), elev [{dem.min():.0f}, {dem.max():.0f}] m")
                    break
            except Exception as e:
                log.warning(f"  ⚠ {coverage_id} parse error: {e}")
        else:
            log.warning(f"  ⚠ {coverage_id} → HTTP {r.status_code}")

    if dem.size == 0:
        log.warning("  ⚠ DEM no disponible — usando terreno plano")
        dem = np.zeros((20, 20))
        dem_bbox = bbox  # use normal bbox for interpolation

    # ── 3. Ortofoto PNOA (25 cm/px) ──────────────────────────────────
    log.info("[3/6] Descargando ortofoto PNOA...")
    centroid_lat = np.mean(lats)
    width_m = (bbox[2] - bbox[0]) * 111000 * np.cos(np.radians(centroid_lat))
    height_m = (bbox[3] - bbox[1]) * 111000
    px_w = min(max(int(width_m / 0.05), 2048), 8192)   # Min 2048px for sharp textures
    px_h = min(max(int(height_m / 0.05), 2048), 8192)
    px_w = max(px_w, 256)
    px_h = max(px_h, 256)

    wms_params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": "OI.OrthoimageCoverage",
        "STYLES": "",
        "CRS": "CRS:84",
        "BBOX": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}",
        "WIDTH": str(px_w),
        "HEIGHT": str(px_h),
        "FORMAT": "image/png",  # PNG lossless para máxima calidad
    }
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as c:
        r = await c.get("https://www.ign.es/wms-inspire/pnoa-ma", params=wms_params)

    if r.status_code == 200:
        ortho = Image.open(BytesIO(r.content)).convert("RGB")
        log.info(f"  → Ortofoto {ortho.size}")
    else:
        log.warning(f"  ⚠ PNOA falló ({r.status_code}) — usando color sólido")
        ortho = Image.new("RGB", (512, 512), color=(120, 160, 80))

    # ── 4. Malla 3D ──────────────────────────────────────────────────
    log.info("[4/6] Generando malla 3D...")
    centroid_lon = np.mean(lons)
    cos_lat = np.cos(np.radians(centroid_lat))

    def to_local(lon: float, lat: float) -> tuple[float, float]:
        return (lon - centroid_lon) * 111000 * cos_lat, (lat - centroid_lat) * 111000

    # Densidad de puntos: 1 m para parcelas pequeñas (<5 000 m²)
    area_m2 = width_m * height_m
    step = 0.5 if area_m2 < 5000 else 1.0
    n_x = max(int(width_m / step), 20)
    n_y = max(int(height_m / step), 20)

    grid_lons = np.linspace(bbox[0], bbox[2], n_x)
    grid_lats = np.linspace(bbox[1], bbox[3], n_y)

    # Interpolar DEM al grid
    dem_lats = np.linspace(dem_bbox[3], dem_bbox[1], dem.shape[0])
    dem_lons = np.linspace(dem_bbox[0], dem_bbox[2], dem.shape[1])
    interp = RegularGridInterpolator(
        (dem_lats[::-1], dem_lons), dem[::-1], method="linear", bounds_error=False, fill_value=None
    )

    pts = np.array(
        [[lon, lat] for lat in grid_lats for lon in grid_lons]
    )
    elevs = interp(pts[:, ::-1])  # (lat, lon) order for interpolator

    # Build in Z-up for Delaunay (x=east, y=north, z=elev)
    east  = (pts[:, 0] - centroid_lon) * 111000 * cos_lat
    north = (pts[:, 1] - centroid_lat) * 111000
    elev  = elevs - np.nanmin(elevs)  # center Z at 0

    # Delaunay on horizontal plane (east, north)
    vertices_2d = np.column_stack([east, north])
    tri = Delaunay(vertices_2d)
    faces = tri.simplices

    # Convert to glTF Y-up: X=East, Y=Elevation(up), -Z=North
    # This matches engine/terrain/export.py _degrees_to_local_meters()
    vertices = np.column_stack([east, elev, -north])
    log.info(f"  → {len(vertices)} vértices, {len(faces)} triángulos")

    if len(vertices) < 2000:
        log.warning(f"  ⚠ Menos de 2000 vértices ({len(vertices)}) — considera bajar step")

    # ── 5. UVs y textura ─────────────────────────────────────────────
    log.info("[5/6] Calculando UVs...")
    # UVs from east/north (horizontal plane), NOT from glTF Y-up vertices
    e_min, n_min = east.min(), north.min()
    e_max, n_max = east.max(), north.max()
    u = (east - e_min) / max(e_max - e_min, 1e-6)
    v = 1.0 - (north - n_min) / max(n_max - n_min, 1e-6)
    uv = np.column_stack([u, v]).astype(np.float32)

    assert uv[:, 0].min() >= 0.0 and uv[:, 0].max() <= 1.0, "UV u out of [0,1]"
    assert uv[:, 1].min() >= 0.0 and uv[:, 1].max() <= 1.0, "UV v out of [0,1]"

    material = PBRMaterial(
        baseColorTexture=ortho,
        metallicFactor=0.0,
        roughnessFactor=0.85,
    )
    visual = TextureVisuals(uv=uv, material=material)
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, visual=visual)

    # FIX 1: Compute vertex normals (without this, shading is flat/ugly)
    mesh.fix_normals()
    log.info(f"  → Normals computed: {mesh.vertex_normals.shape}")

    # FIX 2: Mirror fix — WFS Catastro returns lat,lon (Y,X).
    # The local coordinate transform may produce mirrored geometry.
    # Flip X axis and recalculate normals to fix.
    mesh.vertices[:, 0] *= -1
    mesh.fix_normals()
    log.info("  → X-axis flipped to correct mirroring")

    # ── 6. Exportar GLB ──────────────────────────────────────────────
    log.info("[6/6] Exportando GLB...")
    glb_bytes = mesh.export(file_type="glb", include_normals=True)

    # Validate GLB: check that NORMAL and TEXCOORD_0 are present
    import struct, json as _json
    json_len = struct.unpack('<I', glb_bytes[12:16])[0]
    gltf = _json.loads(glb_bytes[20:20+json_len].rstrip(b'\x00'))
    attrs = gltf['meshes'][0]['primitives'][0]['attributes']
    assert 'NORMAL' in attrs, "ERROR: GLB sin normales"
    assert 'TEXCOORD_0' in attrs, "ERROR: GLB sin UVs"
    log.info(f"  → GLB attrs: {list(attrs.keys())}")

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_bytes(glb_bytes)

    area_ha = area_m2 / 10000
    log.info(f"  → {output_path} ({len(glb_bytes) / 1024 / 1024:.1f} MB)")
    log.info(f"  → Área ~{area_ha:.2f} ha, UV ok, {len(vertices)} vértices")
    log.info("✅ GLB generado con éxito.")


if __name__ == "__main__":
    refcat = sys.argv[1] if len(sys.argv) > 1 else "0100602VL1300S"
    output = sys.argv[2] if len(sys.argv) > 2 else f"geotwin_{refcat}.glb"
    asyncio.run(generate_parcel_glb(refcat, output))
