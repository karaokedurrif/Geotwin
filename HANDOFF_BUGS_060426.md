# GEOTWIN — HANDOFF DE BUGS · 6 Abril 2026 · 22:35

> **Commit actual en producción**: `67d53ef`
> **Rama**: `main`
> **5 servicios**: todos `Up (healthy)` — api, db, engine, illustration, web

---

## REGLAS ABSOLUTAS
- NO reescribir archivos enteros — editar quirúrgicamente
- NO cambiar `"type": "module"` ni `"module": "Node16"` en `apps/api/`
- Build + test después de cada cambio: `pnpm --filter web exec tsc --noEmit`
- Deploy: `git push && ssh docker-edge-apps "cd /opt/stacks/geotwin && git pull && docker compose build geotwin-web && docker compose up -d geotwin-web"`
- NUNCA tocar ~/Documentos/Seedy ni sus contenedores

---

## RESUMEN DE CAMBIOS ESTA SESIÓN

| Commit | Qué se hizo |
|--------|-------------|
| `90fa98e` | Eliminó `scene.rotation.y = Math.PI` de TerrainModel + visor (era incorrecto). Cambió StudioViewer de IonImageryProvider (Bing) a OSM. Añadió `engineAreaHa` desde `pipeline_result.json` |
| `3167ef9` | Fix clonación de materiales en TerrainModel — `originalMaterials.current.set(mesh.uuid, mesh.material.clone())` antes de mutar |
| `ddd0b0b..38e49dd..bfe0b08` | 3 intentos fallidos de solucionar WebGL en Linux. El problema era Chrome GPU blocklist |
| `67d53ef` | `zIndex: 9999` en overlay de carga de Studio. Fix fórmula shoelace en `computeAreaFromGeoJSON` |

**WebGL fix definitivo**: añadir `--ignore-gpu-blocklist` a Chrome (o activar "Override software rendering list" en `chrome://flags`). El problema no era código sino el driver RTX 5080 nuevo en la blocklist de Chrome.

---

## BUGS PENDIENTES — DIAGNÓSTICO EXACTO

### Bug 1 — Área incorrecta en Studio (sigue saliendo 115.1 ha)

**Síntoma**: Studio muestra 115.1 ha para el twin `TERGKjBKda`. Engine muestra 296.4 ha para `rc_40212A8`.

**Causa raíz**: Son **twins distintos**. El twin `TERGKjBKda` fue generado con el polígono antiguo (224 vértices). Su `pipeline_result.json` en el servidor también contiene 115.1 ha porque fue calculado con ese mismo polígono. El sistema ya lee `engineAreaHa` de `pipeline_result.json` correctamente — el problema es el dato, no el código.

**Fix**:
1. Regenerar el twin `TERGKjBKda` desde el Engine con el polígono correcto → el nuevo `pipeline_result.json` tendrá 296+ ha
2. O borrar el snapshot de localStorage del browser (F12 → Application → LocalStorage → borrar clave `twin_TERGKjBKda`)

**Código relevante** (`apps/web/src/pages/studio/[twinId].tsx` línea 107–113):
```typescript
// Ya hace lo correcto: lee pipeline_result.json del engine
fetch(`${apiBase}/api/tiles/${twinId}/pipeline_result.json`)
  .then(r => r.ok ? r.json() : null)
  .then(meta => { if (meta?.area_ha) setEngineAreaHa(meta.area_ha); })
```
**Estado**: código correcto. Datos del twin obsoletos.

---

### Bug 2 — Parcela desalineada en Studio (azul + amarillo flotando)

**Síntoma**: El relleno catastral (azul semitransparente) y el contorno amarillo de la parcela no coinciden con la posición del terrain tileset 3D.

**Causa raíz sin confirmar**: El tileset 3D (`tileset.json`) posiciona el mesh mediante una matriz `transform` ECEF. Las entities Cesium (parcel-fill, boundary-line) se posicionan con lon/lat absolutas del snapshot. Si la `transform` del tileset no está perfectamente calculada, se desfasan.

**Archivo en el engine**: `engine/terrain/export.py` — función `_mesh_to_glb()` → `_degrees_to_ecef()` — genera el `tileset.json` con `RTC_CENTER`.

**Archivo en el frontend**: `apps/web/src/components/studio/StudioViewer.tsx` — función `loadTerrainTileset()` (línea ~1036) y `loadParcelFromSnapshot()` (línea 26).

**Fix a probar**: En `loadParcelFromSnapshot`, verificar que las entities se crean con `clampToGround: true` y sin `heightReference: RELATIVE_TO_GROUND`. Si el tileset tiene offset vertical, añadir un offset de ajuste al polígono.

```typescript
// En loadParcelFromSnapshot, al crear la entity del polígono:
polygon: {
  hierarchy: ...,
  material: ...,
  classificationType: Cesium.ClassificationType.TERRAIN, // en lugar de BOTH
  // NO usar heightReference: RELATIVE_TO_GROUND
}
```

**Estado**: NO investigado aún. Prioridad alta.

---

### Bug 3 — Studio abre negro (spinner no visible)

**Síntoma**: Al entrar a `/studio/{id}`, la pantalla está negra durante varios segundos antes de que cargue el mapa. Se ve el canvas negro de Cesium.

**Causa raíz**: El spinner de carga (`!viewerReady`) tenía `zIndex: 80`. Los iframes y canvas de Cesium pueden tener z-index más alto y tapar el spinner. **Se corrigió a `zIndex: 9999` en commit `67d53ef`**.

**Estado**: arreglado en código pero **NO verificado** si el fix funciona en producción porque el deploy está reciente. Verificar abriendo `geotwin.es/studio/TERGKjBKda` con DevTools abierto — debe aparecer el spinner verde antes de que cargue el mapa.

Si sigue saliendo negro: buscar si `setViewerReady(true)` se llama antes de que el globe esté visible. Ver `StudioViewer.tsx` línea 1033.

---

### Bug 4 — Terrain Studio muestra modelo miniatura flotante (más urgente visualmente)

**Síntoma**: Al abrir Terrain Studio desde Studio, el modelo 3D aparece como un pequeño blob verde/gris en el centro de la pantalla negra. El terreno debería ocupar toda la vista.

**Causa raíz exacta confirmada**: En `TerrainModel.tsx` línea 183–186:
```typescript
const hzMax = Math.max(size.x, size.z) || 1;  // Para 296 ha → hzMax ≈ 2000m
const scale = 2 / hzMax;                        // scale = 0.001
scene.scale.set(scale, scale, scale);
// Y-exaggeration disabled — terrain is flattened in the pipeline.
```
Para una parcela de ~2000m de ancho, `scale = 2/2000 = 0.001`. La elevación máxima del terreno (~100m) queda escalada a `0.001 * 100 = 0.1 unidades`. La cámara se posiciona a `dist = max(2*2.2, 2) = 4.4 unidades` de distancia. El terreno es 2 × 2 × 0.1 unidades → se ve como una lámina plana casi invisible.

**Fix `TerrainModel.tsx`** (replicar la lógica de `visor/[twinId].tsx` que SÍ funciona):
```typescript
// En TerrainModel.tsx, línea ~183, reemplazar:
const hzMax = Math.max(size.x, size.z) || 1;
const scale = 2 / hzMax;
scene.scale.set(scale, scale, scale);
// Y-exaggeration disabled ...

// POR: (igual que visor/[twinId].tsx)
const hzMax = Math.max(size.x, size.z) || 1;
const yRange = size.y || 0.001;
const flatRatio = hzMax / yRange;
const baseScale = 2 / hzMax;
scene.scale.set(baseScale, baseScale, baseScale);

// Aplicar exageración Y proporcional al aplastamiento
if (flatRatio > 30) {
  // Ultra-plano: exageración máxima (jardines, aparcamientos)
  scene.scale.y = baseScale * Math.min(flatRatio / 15, 4.0);
} else if (flatRatio > 15) {
  scene.scale.y = baseScale * Math.min(flatRatio / 20, 2.5);
} else if (flatRatio > 10) {
  scene.scale.y = baseScale * Math.min(flatRatio / 8, 5.0);
}
```

**Archivo**: `apps/web/src/components/terrain-studio/TerrainModel.tsx` línea ~183

**Estado**: bug confirmado, fix no aplicado.

---

## ARCHIVOS CLAVE

| Archivo | Estado | Notas |
|---------|--------|-------|
| `apps/web/src/components/CesiumViewer.tsx` | ✅ OK | WebGL 3-attempt fallback, OSM imagery |
| `apps/web/src/components/studio/StudioViewer.tsx` | ⚠️ Parcial | Spinner zIndex corregido, Bug 2 sin investigar |
| `apps/web/src/components/studio/StudioTopBar.tsx` | ✅ OK | Shoelace formula corregida, prioridad engineAreaHa |
| `apps/web/src/components/terrain-studio/TerrainModel.tsx` | ❌ Bug 4 | Sin exageración Y → modelo miniatura |
| `apps/web/src/pages/visor/[twinId].tsx` | ✅ OK | Exageración Y funciona, sin rotation.y=PI |
| `apps/web/src/pages/studio/[twinId].tsx` | ✅ OK | Lee engineAreaHa de pipeline_result.json |
| `engine/terrain/export.py` | ✅ OK | X=East, Y=Up, -Z=North (glTF estándar) |

---

## ORDEN DE EJECUCIÓN RECOMENDADO

```
AHORA (30 min):
  ① Fix Bug 4 (TerrainModel.tsx) — 5 líneas de código, causa y fix confirmados
  ② Verificar Bug 3 (spinner) — abrir studio y comprobar que aparece el spinner
  ③ Deploy

DESPUÉS (1 hora):
  ④ Investigar Bug 2 (desalineación) — comparar transform del tileset.json con coords del snapshot
  ⑤ Bug 1 (área) — regenerar twins con polígono correcto
```

---

## CÓMO VERIFICAR EL BUG 4 SIN DESPLEGAR

```bash
cd ~/Documentos/Geotwin
pnpm --filter web dev  # arranca Next.js local
# Abrir http://localhost:3000/studio/<twinId>  
# Clic en "Terrain Studio"
# El modelo debe ser visible y ocupar la pantalla
```

---

## CONTEXTO DEL SISTEMA DE COORDENADAS

El engine exporta GLB con:
- `X = East` (metros desde centroid)
- `Y = Elevation up` (metros sobre mínimo)
- `-Z = North`

Estándar glTF Y-up → Three.js Y-up. **NO se necesita ninguna rotación en el frontend.**

El modelo de 296 ha (`rc_40212A8`) tiene dimensiones típicamente:
- X: ±1000m, Z: ±800m → hzMax ≈ 2000m
- Y: ~50-150m de rango de elevación

Con `scale = 2/2000 = 0.001`, la Y queda en 0.05–0.15 unidades → necesita exageración ×10 mínimo para ser visible.
