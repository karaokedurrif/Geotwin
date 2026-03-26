# GeoTwin — Instrucciones para Copilot

## Qué es GeoTwin
Plataforma web de gemelos digitales territoriales (BIM rural).
Stack: Next.js + CesiumJS (frontend), Fastify (API), FastAPI Python (engine), TimescaleDB.
Servidor: Docker en homeserver vía Cloudflare Tunnel.

## Reglas de código
- TypeScript strict, Python 3.11+ con type hints
- NO `any`, NO `@ts-ignore`
- Imports con `@/` alias
- Para capturas del viewer Cesium: SIEMPRE usar `viewer.scene.renderForSpecs()` antes de `canvas.toDataURL()`
- Para operaciones pesadas (>5s): endpoint async con job queue, NUNCA síncrono en handler HTTP
- Los archivos de tiles/rasters van en el volumen compartido `geotwin-tiles`, NO en la BD
- NUNCA tocar archivos de ~/Documentos/Seedy ni contenedores de Seedy

## Arquitectura
- `apps/web/` — Next.js + CesiumJS (Pages Router)
- `apps/api/` — Fastify, ESM ("type": "module", "module": "Node16")
- `engine/` — Python: pipeline DEM→mesh→LOD→3DTiles+ortho+NDVI
- `engine/api.py` — FastAPI wrapper del engine
- `packages/types/` — Contratos TypeScript compartidos
- `docker-compose.yml` — 5 servicios: web, api, engine, db, illustration

## Convenciones geoespaciales
- CRS por defecto: EPSG:4326
- SIEMPRE verificar CRS origen antes de reproyectar
- DEM España: IGN WCS (MDT02 2m, MDT05 5m)
- Ortofoto España: IGN WMS PNOA
- Sentinel-2: Copernicus Data Space (Process API con credenciales sh-*)
- Formatos de salida: 3D Tiles (B3DM/GLB), GeoTIFF, PNG tiles

## Errores comunes que NO repetir
- ESM/CJS: la API usa "type": "module" + "module": "Node16". NO cambiar.
- Exports negros: usar renderForSpecs(), NO toDataURL() directo
- Shader crash v_texCoord_0: verificar UVs en rango [0,1] en el GLB
- CORS: illustration-service necesita geotwin.es en allow_origins
- Disco lleno: docker builder prune -af ANTES de docker compose build
