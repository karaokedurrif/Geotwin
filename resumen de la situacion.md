

Estado actual — resumen de situación
Parcelas analizadas
Twin	Área	Vértices	Caras	Textura	UV coverage	Estado
7nZbNsegBf	0.13 ha (57×45m)	4 637	8 960	3142×2886	36% × 31%	Mal
pppgTwJpYa	50.15 ha (1200×921m)	100 669	198 739	8192×6243	71% × 71%	Aceptable
Lo que YA se cambió (commits 9fe3dd0 + 735a42a)
Frontend (activo ahora en geotwin.es):

anisotropy = 16 en ModelViewer3D y BuildingChild
Shadow camera ±200 → ±5 (sombras 50× más nítidas)
PNOA maximumLevel 20 → 21 para parcelas <1ha
Sentinel NDVI desactivado en viewer para <1ha
Material edificios: white bone → sandstone 0xB8A07A
Engine (requiere REGENERAR el twin para aplicarse):

Sentinel NDVI skipped en pipeline para <1ha
Muro perimetral de 1.5m (dark sandstone) desde aoi.geojson
Recentrado escena: centro de la casa = (0,0,0)
Micro-AO: radius 5m→3m, strength 50%→75%
Material edificios en engine: sandstone en vez de white bone
Lo que NO funciona todavía
1. Bug crítico: UVs sólo cubren ~36% de la textura (parcelas pequeñas)

Este es el problema principal visible en el screenshot de 7nZbNsegBf. El GLB tiene:
UV range:  u=[0.319, 0.681]  v=[0.348, 0.661]
           ───────────────────────────────────
           Solo usa el 36% × 31% del espacio UV


Causa raíz: compute_uv_from_bbox(mesh, ortho_bbox) mapea los UVs contra el bbox de la ortofoto descargada (que incluye el buffer del 20% + 50m). Para una parcela de 57m, el buffer añade ~50m por cada lado → el ortho bbox es ~157m × ~145m, pero la malla recortada sólo cubre 57m × 45m centrales. Resultado: la textura se desperdicia en los márgenes y la parcela queda borrosa.

2. Los cambios de pipeline no se han aplicado a estos twins

Los GLBs que descargaste (7nZbNsegBf, pppgTwJpYa) se generaron antes del commit 735a42a. Los features nuevos (muro perimetral, recentrado, micro-AO, skip Sentinel) sólo se activan al regenerar.

3. Sin edificios en el GLB de 0.13 ha

El GLB de 7nZbNsegBf tiene una sola geometría (terrain) — no hay edificios merged. Posiblemente el catastro no devolvió buildings para esa referencia, o el twin no se generó con la ruta refcat.

4. El modelo de 0.13 ha se ve "roto/fragmentado" en el viewer

Visible en los screenshots 1 y 2: la malla parece explotar con gaps entre triángulos. Esto es un artefacto de renderizado causado por la combinación de:

Elevación total de sólo 1.49m en 57m de ancho (ratio 1:38)
La exageración Y automática del viewer (flatRatio / 10) amplifica ese 1.49m
Con UVs parciales, la textura se estira y crea bordes visibles
5. El twin grande (50 ha) tiene UV coverage del 71% — no del 100%

Mismo problema pero menos severo. El buffer del 20% reduce la cobertura UV útil.

Resumen de lo que falta por arreglar
Prioridad	Problema	Dónde arreglar
P0	UVs mapeados contra ortho bbox (con buffer) en vez de mesh bbox	compute_uv_from_bbox() en mesh.py o recalcular UVs post-clip
P1	Regenerar twins pequeños para activar los cambios de 735a42a	Trigger regeneración desde la UI o API
P2	Exageración Y excesiva para terrenos ultra-planos (1.49m de rango)	TerrainModel.tsx / ModelViewer3D.tsx — limitar yExag
P3	Falta de edificios en 7nZbNsegBf — investigar si hay buildings en catastro	refcat.ts / api.py
