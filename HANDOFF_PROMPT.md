# GeoTwin — Prompt de Continuación para Siguiente Copilot

## Estado actual (30 marzo 2026, commit f2ee0e3)

Plataforma de gemelos digitales territoriales. El usuario sube un KML catastral, el engine genera un modelo 3D texturizado con ortofoto PNOA, y el visor Cesium+Three.js lo muestra.

---

## PROBLEMA PRINCIPAL SIN RESOLVER

### Las fincas pequeñas (0.3 ha, ~29m radio) NO se ven bien — ni en el mapa Cesium ni en el visor 3D Studio

**Síntomas visibles:**
1. En la página principal (CesiumViewer) la parcela se carga pero **el polígono cyan y el borde dorado NO se ven** sobre el terreno oscuro
2. En Studio (StudioViewer — Cesium tab), la parcela sí se ve con fill+boundary pero la ortofoto del terreno es borrosa
3. En Studio Terrain (TerrainCanvas — Three.js), el modelo GLB se renderiza pero **sale excesivamente distorsionado/inclinado** y la textura es borrosa

**Causa raíz identificada (NO arreglada aún):**
- La ortofoto PNOA se descarga vía WMS (`engine/raster/ortho.py`) con resolución 5cm/px para parcelas <50ha
- PERO para una parcela de 0.3 ha (bbox ~60x50m), eso genera una imagen de solo ~1200x1000 px
- El WMS del IGN limita a 4096px por request, pero el bbox es tan pequeño que ni siquiera se acerca al límite
- El problema NO es resolución — es que **el bbox es el bbox de la parcela SIN margen**, así que la textura queda recortada justo al borde
- Además, el DEM (MDT05, 5m resolución) solo tiene ~12x10 puntos para una parcela de 60x50m, generando una malla con **muy pocos vértices** (~120) que se subdivide a ~240 pero sigue siendo insuficiente

**Lo que se necesita hacer:**
1. **Expandir el bbox** del DEM y la ortofoto con un buffer (ej: 20% o mínimo 50m) para que la textura cubra más allá del borde de la parcela
2. **Aumentar la resolución del DEM** para parcelas pequeñas — usar MDT02 (2m) si existe, o interpolar el MDT05
3. **Más subdivisiones** del mesh para parcelas con pocos vértices (<500)
4. **Verificar que los UVs se mapean correctamente** al bbox expandido
5. **En CesiumViewer**: el polígono con `classificationType: BOTH` y alpha 0.40 SIGUE sin verse — puede que sea un problema de que el terreno Cesium no tiene suficiente resolución en esa área y el polygon no tiene superficie donde "clasificar"

---

## HISTORIAL COMPLETO DE CAMBIOS (sesiones 28-30 marzo 2026)

### Sesión 1: Terrain Studio + GLB crash fix
- Implementó TerrainStudio completo (fullscreen Three.js inspector con R3F)
- Fixed TEXCOORD_0 shader crash: `export.py` genera fallback PBR + dummy UVs cuando no hay ortofoto
- Retry en ortho download (3 intentos con backoff)
- Subdivisión de mesh cuando `vertex_count < 200`
- Densificación de polígonos (`densify_coords` en `aoi.py`)
- Terrain exaggeration default 1.0x
- Desplegado: commit `8bf969e`

### Sesión 2: Outline warning + Cesium timeout + illustration
- Fixed entity outline terrain warning en StudioViewer (outline: true → false)
- Fixed Cesium 20s load timeout: `<script async>` → `<Script strategy="beforeInteractive">`
- Added "Ilustración 3D" al menú export de Studio
- Desplegado: commit `89aa817`

### Sesión 3: GeoJsonDataSource pre-styling
- Root cause: `GeoJsonDataSource.load()` crea entities con `outline: true` por defecto
- Se renderizaban ANTES de que `styleParcelEntities()` pudiera desactivarlas
- Fix: pre-style entities (outline=false) ANTES de añadir dataSource al viewer
- Created favicon.ico (era 404)
- Desplegado: commit `79574a9`

### Sesión 4 (actual): SSAO crash + ortho + GLB open + visibility

**Commit 131dc68:**
- SSAO NormalPass crash fix: `enableNormalPass={ssao}`, `multisampling` 4→0
- SSAO params reducidos: radius 0.06→0.05, intensity 25→15, samples 21→16
- Ortho resolution en pipeline.py: <50ha→5cm, <200ha→10cm, ≥200ha→25cm
- GLB file open: botón "Open" en StudioToolbar con file input
- TerrainCanvas usa `glbOverrideUrl` del store de Zustand

**Commit 0bd2adf:**
- Polygon fill alpha 0.09→0.22→0.40
- Boundary gold width 2→3.5→5px
- Y-exaggeration max 8→3 en TerrainModel y ModelViewer3D
- Grid adaptativa en ModelViewer3D (gridY del bounding box)

**Commit f2ee0e3 (actual):**
- Polygon classificationType TERRAIN→BOTH
- Boundary color #f0c040→#FFD700 con alpha completo
- `disableDepthTestDistance: POSITIVE_INFINITY` en boundary polyline
- Studio default fillOpacity 0.09→0.35, boundaryWidth 2→4

---

## LO QUE NO HA FUNCIONADO

1. **Subir alpha del polígono (0.09→0.22→0.40)**: No ayuda. El polígono usa `classificationType: BOTH` que necesita geometría de terreno debajo para pintar. En parcelas muy pequeñas, los tiles de Cesium en ese zoom pueden no tener suficiente resolución → no hay superficie donde "clasificar" el polígono.

2. **`disableDepthTestDistance: POSITIVE_INFINITY`**: Funciona para polylines (el borde dorado SÍ debería verse), pero el FILL del polígono sigue siendo classification-based, no afectado por esta propiedad.

3. **Y-exaggeration reducida (8→3)**: Mejoró parcialmente pero el modelo sigue distorsionado en el visor Three.js. El problema real es que el mesh tiene tan pocos vértices que la geometría es muy tosca.

4. **Resolución ortho 5cm**: Se aplica, pero el bbox de la parcela es tan pequeño que 5cm/px genera pocos píxeles. Y el WMS del IGN puede no tener resolución nativa 5cm en esa zona — la imagen resultante sale interpolada/borrosa del lado del servidor.

---

## ARCHIVOS CLAVE QUE HAY QUE MODIFICAR

### Engine (Python)
- `engine/pipeline.py` — Orquestador: donde se decide bbox, resolución, ortho, mesh
- `engine/raster/ortho.py` — Descarga PNOA WMS: `download_pnoa_ortho()`, tiling
- `engine/terrain/mesh.py` — `dem_to_mesh()`, `clip_mesh_to_aoi()`, `TerrainMesh`
- `engine/terrain/export.py` — `export_single_glb()`, `_mesh_to_glb()`, texturas
- `engine/terrain/ingest.py` — `get_dem_for_aoi()`, `download_dem_ign()`, WCS
- `engine/vector/aoi.py` — `select_resolution()`, `compute_aoi_metadata()`, `densify_coords()`

### Frontend (TypeScript/React)
- `apps/web/src/components/CesiumViewer.tsx` (~2500 líneas) — Visor principal mapa
- `apps/web/src/components/studio/StudioViewer.tsx` (~1000 líneas) — Visor Studio Cesium
- `apps/web/src/components/terrain-studio/TerrainModel.tsx` — Renderer GLB en Three.js
- `apps/web/src/components/terrain-studio/TerrainCanvas.tsx` — Canvas R3F
- `apps/web/src/components/terrain-studio/effects/StudioPostProcessing.tsx` — SSAO/Bloom
- `apps/web/src/components/studio/ModelViewer3D.tsx` — Inspector 3D modal
- `apps/web/src/pages/studio/[twinId].tsx` — Página Studio container

---

## SUGERENCIAS DE SOLUCIÓN

### Para la ortofoto borrosa:
```python
# En pipeline.py, ANTES de llamar a get_ortho_for_aoi:
# Expandir bbox con buffer de 20% o mínimo 50m
min_lon, min_lat, max_lon, max_lat = aoi_meta.bbox
buffer_deg = max(0.0005, (max_lon - min_lon) * 0.2)  # ~50m mínimo
expanded_bbox = (min_lon - buffer_deg, min_lat - buffer_deg, 
                 max_lon + buffer_deg, max_lat + buffer_deg)
# Usar expanded_bbox para ortho Y para DEM
```

### Para el mesh con pocos vértices:
```python
# En pipeline.py, después de clip_mesh_to_aoi:
# Subdividir repetidamente hasta tener suficientes vértices
while mesh.vertex_count < 1000:
    t = trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces)
    t = t.subdivide()
    mesh = TerrainMesh(vertices=..., faces=..., normals=...)
```

### Para la visibilidad del polígono en CesiumViewer:
```typescript
// Alternativa: en vez de classificationType, usar heightReference + small height
entity.polygon.material = Cesium.Color.CYAN.withAlpha(0.35);
entity.polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
entity.polygon.height = 0;
// Quitar classificationType completamente
// O usar extrudedHeight para dar volumen:
entity.polygon.extrudedHeight = 2; // 2m sobre el suelo
entity.polygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
```

### Para el modelo 3D distorsionado:
- El Y-exaggeration se calcula como `flatRatio / 10` con max 3 — pero si el ratio es 100:1 (parcela 60m ancha, 0.6m de desnivel), aplica 10x que sigue siendo excesivo
- Mejor: usar exaggeration fija basada en area_ha, no en ratio

---

## STACK TÉCNICO

- **Frontend**: Next.js 14 (Pages Router) + CesiumJS + React Three Fiber + TypeScript
- **API**: Fastify ESM, puerto 3001
- **Engine**: FastAPI Python + GDAL + trimesh + scipy + rasterio, puerto 8002
- **DB**: TimescaleDB (PostGIS)
- **Infra**: Docker Compose (5 servicios), Cloudflare Tunnel, dominio geotwin.es
- **Servidor**: 192.168.30.101 (docker-edge-apps), MSI Vector RTX 5080 local

## DEPLOY
```bash
ssh docker-edge-apps "cd /opt/stacks/geotwin && git pull origin main && docker builder prune -af && docker compose build --no-cache geotwin-web geotwin-engine && docker compose up -d geotwin-web geotwin-engine"
```

## REGLAS ABSOLUTAS
1. NO reescribir archivos completos — editar quirúrgicamente
2. NO cambiar `"type": "module"` ni `"module": "Node16"` en apps/api/
3. Para capturas Cesium: SIEMPRE `viewer.scene.renderForSpecs()` antes de `canvas.toDataURL()`
4. Build + test después de cada cambio
5. Git commit + push + deploy por cada fix
6. Outline on terrain: NUNCA usar `outline: true` en entities con clampToGround
7. Pre-estilizar entities ANTES de añadir dataSource al viewer
8. **IGN WMS hard limit: 4096px por dimensión**
9. **MDT02 (2m) NO EXISTE en IGN WCS** → el más fino es MDT05 (5m, coverage `Elevacion4258_5`)
