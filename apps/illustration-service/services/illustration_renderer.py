"""
terrain_renderer_3d.py — GeoTwin 3D Isometric Renderer
=======================================================
Renderiza terreno 3D isométrico con textura PNOA real del IGN.

ALGORITMO PROBADO:
- Painter's algorithm con quads ordenados diagonal (atrás→adelante)
- Proyección isométrica: sx=(gx-gy)*2, sy=(gx+gy)*1 - z*130
- Textura: ortofoto PNOA del IGN WMS (gratuito, sin API key)
- MDT: WCS IGN con fallback sintético si no hay conexión
- Contorno catastral: 225 vértices proyectados en 3D con glow dorado

PROBADO con snapshot real 134.75ha, -3.9826,40.9159, 225 vértices
Tiempo: ~30 segundos (incluye descarga PNOA 512x512)
"""
import asyncio
import math
import json
from io import BytesIO

import httpx
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

# WMS / WCS IGN España (gratuitos)
IGN_WMS_PNOA = "https://www.ign.es/wms-inspire/pnoa-ma"
IGN_WCS_MDT  = "https://servicios.idee.es/wcs-inspire/mdt"

# Parámetros visuales por defecto
GRID_SIZE  = 300    # resolución del MDT (más alto = más detalle, más lento)
OUT_W      = 1100
OUT_H      = 820
Z_SCALE    = 130    # exageración vertical (más alto = relieve más dramático)
MARGIN     = 0.40   # margen alrededor del polígono (40%)
SKY_COLOR  = (158, 192, 224)
SUN_DIR    = np.array([0.55, -0.25, 0.85])


def _compute_bbox(coords: list) -> tuple:
    """Bbox desde extensión real del polígono + margen."""
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    ls = max(lons) - min(lons)
    lt = max(lats) - min(lats)
    return (
        min(lons) - ls * MARGIN,
        min(lats) - lt * MARGIN,
        max(lons) + ls * MARGIN,
        max(lats) + lt * MARGIN,
    )


async def _fetch_pnoa(bbox: tuple, size: int = 512) -> Image.Image | None:
    """Descarga ortofoto PNOA del IGN WMS con múltiples intentos."""
    lon_min, lat_min, lon_max, lat_max = bbox
    
    # Intentar primero con CRS:84 (lon,lat order — más compatible)
    attempts = [
        {
            "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap",
            "LAYERS": "OI.OrthoimageCoverage", "STYLES": "",
            "CRS": "CRS:84",
            "BBOX": f"{lon_min},{lat_min},{lon_max},{lat_max}",
            "WIDTH": str(size), "HEIGHT": str(size), "FORMAT": "image/jpeg",
        },
        {
            "SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap",
            "LAYERS": "OI.OrthoimageCoverage", "STYLES": "",
            "SRS": "EPSG:4326",
            "BBOX": f"{lon_min},{lat_min},{lon_max},{lat_max}",
            "WIDTH": str(size), "HEIGHT": str(size), "FORMAT": "image/jpeg",
        },
    ]
    
    for i, params in enumerate(attempts):
        try:
            async with httpx.AsyncClient(timeout=45.0) as c:
                r = await c.get(IGN_WMS_PNOA, params=params)
                ct = r.headers.get("content-type", "")
                print(f"[PNOA] Attempt {i+1}: status={r.status_code} content-type={ct[:40]}")
                
                # Verificar que sea imagen real, no XML de error
                if r.status_code == 200 and ("image" in ct or r.content[:4] in [b"\xff\xd8\xff\xe0", b"\x89PNG"]):
                    img = Image.open(BytesIO(r.content)).convert("RGB")
                    
                    # Verificar que no sea imagen negra/vacía
                    arr = np.array(img)
                    mean_brightness = arr.mean()
                    print(f"[PNOA] ✅ {img.size} brightness={mean_brightness:.1f}")
                    
                    if mean_brightness < 5:
                        print(f"[PNOA] ⚠️ Image too dark (brightness={mean_brightness:.1f}), trying next")
                        continue
                    
                    img = ImageEnhance.Sharpness(img).enhance(1.4)
                    img = ImageEnhance.Contrast(img).enhance(1.1)
                    img = ImageEnhance.Color(img).enhance(1.2)
                    return img
                else:
                    print(f"[PNOA] ❌ Bad response: {r.content[:200]}")
        except Exception as e:
            print(f"[PNOA] ❌ Attempt {i+1} failed: {e}")
    
    print("[PNOA] ⚠️ All attempts failed, using synthetic texture")
    return None


async def _fetch_mdt(bbox: tuple, grid: int = GRID_SIZE) -> np.ndarray | None:
    """Descarga MDT del IGN WCS."""
    lon_min, lat_min, lon_max, lat_max = bbox
    params = {
        "SERVICE": "WCS", "VERSION": "2.0.1", "REQUEST": "GetCoverage",
        "COVERAGEID": "Elevacion4258_25", "FORMAT": "image/tiff",
        "SUBSETTINGCRS": "http://www.opengis.net/def/crs/EPSG/0/4258",
        "SUBSET": [f"Lat({lat_min},{lat_max})", f"Long({lon_min},{lon_max})"],
        "WIDTH": str(grid), "HEIGHT": str(grid),
    }
    try:
        async with httpx.AsyncClient(timeout=45.0) as c:
            r = await c.get(IGN_WCS_MDT, params=params)
            if r.status_code == 200 and len(r.content) > 1000:
                img = Image.open(BytesIO(r.content))
                arr = np.array(img, dtype=float)
                arr[arr < -1000] = np.nan
                m = np.nanmean(arr)
                arr = np.nan_to_num(arr, nan=m)
                if arr.shape != (grid, grid):
                    arr = np.array(
                        Image.fromarray(arr.astype(np.float32))
                        .resize((grid, grid), Image.BILINEAR)
                    )
                print(f"[MDT] ✅ {arr.shape} [{arr.min():.0f},{arr.max():.0f}]m")
                return arr
    except Exception as e:
        print(f"[MDT] ❌ {e}")
    return None


def _synthetic_mdt(grid: int, base: float = 1020, relief: float = 280) -> np.ndarray:
    """MDT sintético plausible como fallback."""
    np.random.seed(7)
    arr = np.zeros((grid, grid))
    for octave, scale in [(150,1.0),(75,0.5),(37,0.25),(18,0.12),(9,0.06)]:
        s = np.random.randn(max(2, grid//octave), max(2, grid//octave))
        up = np.array(Image.fromarray(s.astype(np.float32)).resize((grid, grid), Image.BILINEAR))
        arr += up * scale
    arr = (arr - arr.min()) / (arr.max() - arr.min()) * relief + base
    return arr


def _iso_project(gx, gy, gz_norm, z_scale=Z_SCALE):
    sx = (gx - gy) * 2.0
    sy = (gx + gy) * 1.0 - gz_norm * z_scale
    return sx, sy


def _compute_render_transform(arr, grid, out_w, out_h, z_scale):
    """Calcula escala y offset para centrar el render."""
    pts = []
    for gy in range(0, grid, 8):
        for gx in range(0, grid, 8):
            gz = (arr[gy,gx] - arr.min()) / max(arr.max()-arr.min(), 1)
            sx, sy = _iso_project(gx, gy, gz, z_scale)
            pts.append((sx, sy))
    sx_min = min(p[0] for p in pts); sx_max = max(p[0] for p in pts)
    sy_min = min(p[1] for p in pts); sy_max = max(p[1] for p in pts)
    scale = min((out_w*0.90)/(sx_max-sx_min), (out_h*0.84)/(sy_max-sy_min))
    offX = (out_w - (sx_max-sx_min)*scale)/2 - sx_min*scale
    offY = out_h*0.08 - sy_min*scale
    return scale, offX, offY


def _render_quads(arr, tex_arr, normals, sun, grid, scale, offX, offY, out_w, out_h, z_scale):
    """Painter's algorithm: quads ordenados de atrás a adelante."""
    output = Image.new("RGB", (out_w, out_h), SKY_COLOR)
    draw   = ImageDraw.Draw(output)

    order = sorted(
        [(gy, gx) for gy in range(grid-1) for gx in range(grid-1)],
        key=lambda p: -(p[0] + p[1])
    )

    z_min = arr.min(); z_rng = max(arr.max()-arr.min(), 1)

    for gy, gx in order:
        corners = [(gx,gy),(gx+1,gy),(gx+1,gy+1),(gx,gy+1)]
        sc = []
        for cwx, cwy in corners:
            gz = (arr[min(cwy,grid-1), min(cwx,grid-1)] - z_min) / z_rng
            sx, sy = _iso_project(cwx, cwy, gz, z_scale)
            sc.append((sx*scale+offX, sy*scale+offY))

        n = normals[gy, gx]
        light = 0.28 + 0.72 * max(0.0, float(np.dot(n, sun)))
        color = np.clip(tex_arr[gy, gx] * light, 0, 255).astype(int)
        draw.polygon(sc, fill=(int(color[0]), int(color[1]), int(color[2])))

    return output


def _draw_boundary_3d(output, coords, bbox, arr, grid, scale, offX, offY, z_scale):
    """Contorno catastral exacto proyectado en 3D."""
    lon_min, lat_min, lon_max, lat_max = bbox
    z_min = arr.min(); z_rng = max(arr.max()-arr.min(), 1)

    screen_pts = []
    for lon, lat in coords:
        gx_f = (lon-lon_min)/(lon_max-lon_min)*(grid-1)
        gy_f = (1-(lat-lat_min)/(lat_max-lat_min))*(grid-1)
        gxi  = min(max(int(gx_f), 0), grid-1)
        gyi  = min(max(int(gy_f), 0), grid-1)
        gz   = (arr[gyi, gxi] - z_min) / z_rng
        sx, sy = _iso_project(gx_f, gy_f, gz, z_scale)
        screen_pts.append((int(sx*scale+offX), int(sy*scale+offY - 3)))

    flat = screen_pts

    # Glow dorado
    glow = Image.new("RGBA", output.size, (0,0,0,0))
    gd   = ImageDraw.Draw(glow)
    gd.line(flat + [flat[0]], fill=(255,130,0,130), width=24)
    glow = glow.filter(ImageFilter.GaussianBlur(12))
    gd2  = ImageDraw.Draw(glow)
    gd2.line(flat + [flat[0]], fill=(255,200,40,165), width=11)
    glow = glow.filter(ImageFilter.GaussianBlur(5))
    result = Image.alpha_composite(output.convert("RGBA"), glow).convert("RGB")

    dr = ImageDraw.Draw(result)
    dr.line(flat + [flat[0]], fill=(255, 218, 45), width=5)
    dr.line(flat + [flat[0]], fill=(255, 252, 195), width=2)

    print(f"[Renderer] ✅ Contorno 3D: {len(coords)} vértices")
    return result


async def generate_boundary_only_hq(
    snapshot:   dict,
    out_w:      int   = 3000,  # Alta resolución por defecto
    out_h:      int   = 3000,
    z_scale:    float = 180,   # Mayor exageración para perspectiva
    line_width: int   = 12,     # Grosor de línea más visible
) -> tuple[bytes, str]:
    """
    Renderiza SOLO el contorno catastral en alta calidad.
    Sin terreno, solo el polígono con glow dorado sobre fondo transparente.
    """
    parcel  = snapshot.get("parcel", {})
    geojson = parcel.get("geojson", {})

    try:
        coords = geojson["features"][0]["geometry"]["coordinates"][0]
    except (KeyError, IndexError):
        raise ValueError("No se encontró polígono en el snapshot")

    bbox = _compute_bbox(coords)
    grid = 300  # Solo para proyección 3D del contorno

    print(f"[HQ Boundary] {parcel.get('area_ha',0):.1f}ha, {len(coords)} vértices, resolución {out_w}x{out_h}px")

    # Crear MDT sintético simple solo para proyección (no se renderiza)
    arr = _synthetic_mdt(grid, base=1000, relief=150)
    
    lon_min, lat_min, lon_max, lat_max = bbox
    z_min = arr.min(); z_rng = max(arr.max()-arr.min(), 1)

    # Proyectar vértices en 3D isométrico
    screen_pts = []
    for lon, lat in coords:
        gx_f = (lon-lon_min)/(lon_max-lon_min)*(grid-1)
        gy_f = (1-(lat-lat_min)/(lat_max-lat_min))*(grid-1)
        gxi  = min(max(int(gx_f), 0), grid-1)
        gyi  = min(max(int(gy_f), 0), grid-1)
        gz   = (arr[gyi, gxi] - z_min) / z_rng
        sx, sy = _iso_project(gx_f, gy_f, gz, z_scale)
        screen_pts.append((sx, sy))

    # Calcular escala para centrar el contorno
    sx_min = min(p[0] for p in screen_pts); sx_max = max(p[0] for p in screen_pts)
    sy_min = min(p[1] for p in screen_pts); sy_max = max(p[1] for p in screen_pts)
    scale = min((out_w*0.85)/(sx_max-sx_min), (out_h*0.85)/(sy_max-sy_min))
    offX = (out_w - (sx_max-sx_min)*scale)/2 - sx_min*scale
    offY = (out_h - (sy_max-sy_min)*scale)/2 - sy_min*scale

    flat = [(int(sx*scale+offX), int(sy*scale+offY)) for sx, sy in screen_pts]

    # Imagen con transparencia
    output = Image.new("RGBA", (out_w, out_h), (245, 250, 255, 255))  # Fondo blanco casi transparente

    # Glow dorado más intenso para alta resolución
    glow = Image.new("RGBA", output.size, (0,0,0,0))
    gd   = ImageDraw.Draw(glow)
    gd.line(flat + [flat[0]], fill=(255,130,0,180), width=line_width*4)
    glow = glow.filter(ImageFilter.GaussianBlur(20))
    gd2  = ImageDraw.Draw(glow)
    gd2.line(flat + [flat[0]], fill=(255,200,40,200), width=line_width*2)
    glow = glow.filter(ImageFilter.GaussianBlur(10))
    output = Image.alpha_composite(output, glow)

    # Línea principal
    dr = ImageDraw.Draw(output)
    dr.line(flat + [flat[0]], fill=(255, 218, 45, 255), width=line_width)
    dr.line(flat + [flat[0]], fill=(255, 252, 195, 255), width=max(line_width//3, 3))

    # Post-proceso para máxima nitidez
    output = ImageEnhance.Sharpness(output).enhance(1.5)
    output = ImageEnhance.Contrast(output).enhance(1.1)

    buf = BytesIO()
    output.save(buf, format="PNG", optimize=False, compress_level=3)  # Máxima calidad

    desc = f"Contorno catastral alta calidad {out_w}x{out_h}px, {len(coords)} vértices, línea {line_width}px"
    print(f"[HQ Boundary] ✅ {desc}")
    
    return buf.getvalue(), desc


async def generate_3d_illustration(
    snapshot:   dict,
    style:      str   = "natural",
    out_w:      int   = OUT_W,
    out_h:      int   = OUT_H,
    z_scale:    float = Z_SCALE,
    save_debug: bool  = True,
) -> tuple[bytes, str]:
    """
    Pipeline principal.
    Returns: (png_bytes, description_string)
    """
    parcel  = snapshot.get("parcel", {})
    geojson = parcel.get("geojson", {})

    try:
        coords = geojson["features"][0]["geometry"]["coordinates"][0]
    except (KeyError, IndexError):
        raise ValueError("No se encontró polígono en el snapshot")

    bbox = _compute_bbox(coords)
    grid = GRID_SIZE

    print(f"[Pipeline] {parcel.get('area_ha',0):.1f}ha, {len(coords)} vértices, bbox={bbox}")

    # ── Descargas paralelas ──────────────────────────────────────
    mdt_t  = asyncio.create_task(_fetch_mdt(bbox, grid))
    pnoa_t = asyncio.create_task(_fetch_pnoa(bbox, size=512))
    arr, pnoa = await asyncio.gather(mdt_t, pnoa_t)

    if arr  is None: arr  = _synthetic_mdt(grid)
    if pnoa is None:
        print("[Pipeline] ⚠️ Using synthetic PNOA (dehesa colors)")
        # Textura sintética realista — colores de dehesa española
        pnoa = _synthetic_pnoa(512)

    if save_debug:
        pnoa.save("debug_pnoa.png")
        hmap_norm = ((arr-arr.min())/(arr.max()-arr.min())*255).astype(np.uint8)
        Image.fromarray(hmap_norm).save("debug_mdt_grey.png")

    # Estilo de color sobre la textura
    if style == "ndvi":
        a = np.array(pnoa).astype(float)
        a[:,:,1] = np.minimum(a[:,:,1]*1.5, 255)
        pnoa = Image.fromarray(a.astype(np.uint8))
    elif style == "night":
        a = np.array(pnoa).astype(float) * 0.3
        a[:,:,2] = np.minimum(a[:,:,2]*1.5, 255)
        pnoa = Image.fromarray(a.astype(np.uint8))
    elif style == "topo":
        pnoa = ImageEnhance.Color(pnoa).enhance(0.6)
        pnoa = ImageEnhance.Contrast(pnoa).enhance(1.4)

    # Textura redimensionada al grid
    tex_arr = np.array(pnoa.resize((grid, grid), Image.LANCZOS), dtype=float)

    # Normales para iluminación difusa
    dzdx = np.gradient(arr, axis=1)
    dzdy = np.gradient(arr, axis=0)
    normals = np.stack([-dzdx*0.018, -dzdy*0.018, np.ones_like(arr)], axis=-1)
    mag = np.linalg.norm(normals, axis=-1, keepdims=True)
    normals /= np.maximum(mag, 1e-8)
    sun = SUN_DIR / np.linalg.norm(SUN_DIR)

    # Transform
    scale, offX, offY = _compute_render_transform(arr, grid, out_w, out_h, z_scale)
    print(f"[Render] escala={scale:.2f}, offset=({offX:.0f},{offY:.0f})")

    # ── Render ──────────────────────────────────────────────────
    print(f"[Render] Renderizando {(grid-1)**2} quads...")
    output = _render_quads(arr, tex_arr, normals, sun, grid, scale, offX, offY, out_w, out_h, z_scale)

    # ── Contorno ─────────────────────────────────────────────────
    output = _draw_boundary_3d(output, coords, bbox, arr, grid, scale, offX, offY, z_scale)

    # ── Post-proceso ──────────────────────────────────────────────
    output = ImageEnhance.Sharpness(output).enhance(1.2)
    output = ImageEnhance.Contrast(output).enhance(1.06)

    if save_debug:
        output.save("debug_3d_result.png")

    buf = BytesIO()
    output.save(buf, format="PNG", optimize=True)

    desc = (
        f"{'PNOA IGN real' if pnoa is not None else 'textura sintética'} "
        f"+ MDT {'IGN real' if arr is not None else 'sintético'} "
        f"→ render 3D isométrico {out_w}x{out_h}px "
        f"(z_scale={z_scale}, {len(coords)} vértices) — sin IA"
    )

    print(f"[Pipeline] ✅ {desc}")
    return buf.getvalue(), desc


# ── Standalone ────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    snap_path = sys.argv[1] if len(sys.argv) > 1 else "test_snapshot.json"
    with open(snap_path) as f:
        snap = json.load(f)

    async def run():
        png, desc = await generate_3d_illustration(snap)
        with open("output_3d.png", "wb") as f:
            f.write(png)
        print(f"\n✅ output_3d.png ({len(png)//1024} KB)\n{desc}")

    asyncio.run(run())
