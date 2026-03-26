# GeoTwin — Bugs conocidos y su causa

## RESUELTOS
- ESM/CJS crash en API → "type": "module" + "module": "Node16"
- DNS Vercel vs Cloudflare → ahora todo vía Cloudflare Tunnel
- Seedy crash → archivos restaurados desde backup 2TB

## PENDIENTES
- Shader crash v_texCoord_0 al cargar mallado 3D en Cesium
- Exports 4K Raw / HQ siempre negros (renderForSpecs no implementado)
- Illustration endpoint llama a generate-ai-illustration (debe ser generate-illustration)
- CORS del illustration-service solo permite localhost:3000
- Camera range no se adapta al tamaño de la parcela
- El mallado se pide tanto en Engine como en Studio (duplicación)
- NDVI no visible en Studio (URL/bounds incorrectos)
- Efecto de mallado sale fuera del polígono
- Relief exaggeration por defecto 2.5x (debe ser 1.0x)
- PNOA tiles 400 en Studio (proxy /api/pnoa mal configurado)
