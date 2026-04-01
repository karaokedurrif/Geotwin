# GeoTwin — Instrucciones para agentes de IA (Copilot / Claude Code)

## Qué es GeoTwin
Plataforma web de gemelos digitales territoriales (BIM rural). El usuario sube un KML
catastral, el engine genera un modelo 3D texturizado, y el visor lo muestra con capas
geoespaciales interactivas.

## Stack
- **Frontend**: Next.js (Pages Router) + CesiumJS + TypeScript strict
- **API**: Fastify ESM (`"type": "module"` + `"module": "Node16"` — NUNCA cambiar esto)
- **Engine**: FastAPI Python + GDAL + trimesh + scipy + rasterio
- **DB**: TimescaleDB (PostGIS + time-series)
- **Infra**: Docker Compose (5 servicios), Cloudflare Tunnel, dominio geotwin.es
- **Servidor**: 192.168.30.101 (docker-edge-apps), MSI Vector RTX 5080 local

## Arquitectura de carpetas
```
apps/web/          — Next.js + CesiumJS (Pages Router)
apps/api/          — Fastify ESM (TypeScript)
engine/            — Python: pipeline DEM→mesh→LOD→3DTiles+ortho+NDVI
  ├── terrain/     — DEM download, meshing, LOD, export GLB/B3DM
  ├── raster/      — ortho.py (PNOA), sentinel.py (NDVI/RGB)
  └── api.py       — FastAPI wrapper
packages/types/    — Contratos TypeScript compartidos
docker-compose.yml — web, api, engine, db, illustration
```

## Deploy (producción)
- **geotwin.es** se sirve desde el edge server **192.168.30.101** vía Docker Compose + Cloudflare Tunnel
- **NO** va a Vercel — Vercel solo se usa para previews, NO para producción
- Deploy: `ssh docker-edge-apps` → `cd /opt/stacks/geotwin && git pull && docker compose build && docker compose up -d`
- Containers: `geotwin-web-1` (Next.js :3000), `geotwin-api-1` (Fastify :3001), `geotwin-engine-1` (FastAPI :8000), `geotwin-db-1` (TimescaleDB :5432), `geotwin-illustration-1` (:7860)
- Verificar: `docker compose ps` — los 5 deben estar `Up (healthy)`
- Cloudflare Tunnel ruta: `geotwin.es` → `http://web:3000`, `api.geotwin.es` → `http://api:3001`

## Reglas absolutas
1. NO reescribir archivos completos — editar quirúrgicamente
2. NO cambiar `"type": "module"` ni `"module": "Node16"` en apps/api/
3. NO tocar ~/Documentos/Seedy ni contenedores de Seedy
4. Para capturas Cesium: SIEMPRE `viewer.scene.renderForSpecs()` antes de `canvas.toDataURL()`
5. Para operaciones >5s: endpoint async con job queue (202 + polling)
6. Python es el lenguaje del engine (no C++)
7. Build + test después de cada cambio
8. Git commit + push + deploy por cada fix independiente
9. Deploy = docker compose en edge server, NO vercel --prod

## Convenciones geoespaciales
- CRS por defecto: EPSG:4326
- DEM España: IGN WCS (MDT02 2m, MDT05 5m)
- Ortofoto España: IGN WMS PNOA (25cm/px nativo)
- Sentinel-2: Copernicus Data Space (Process API)
- Formatos de salida: 3D Tiles (B3DM/GLB), GeoTIFF, PNG

## Errores comunes que NO repetir
- ESM/CJS: la API usa "type": "module" + "module": "Node16". NO cambiar
- Exports negros: usar renderForSpecs(), NO toDataURL() directo
- Shader crash v_texCoord_0: verificar UVs en rango [0,1] en el GLB
- CORS: illustration-service necesita geotwin.es en allow_origins
- Disco lleno: docker builder prune -af ANTES de docker compose build
- Outline on terrain: NUNCA usar `outline: true` en entities con clampToGround/classificationType
- Cesium Script: usar `<Script strategy="beforeInteractive">` de next/script, NO `<script async>`
- GeoJsonDataSource: pre-estilizar entities ANTES de añadir dataSource al viewer
