# GeoTwin Hyperreal — Informe de Handoff (6 abril 2026)

> **Estado**: Hyperreal NO funcional tras 2 intentos de fix  
> **Commits**: 1cee84f, 0b2e5cb  
> **Contexto**: Prompts maestro_cto_definitivo.md + prompt_hyperreal_comfyui.md  
> **Autor**: Engine Expert Agent

---

## RESUMEN EJECUTIVO

Se intentó implementar el botón Hyperreal en Terrain Studio para capturar depth map + RGB del modelo 3D y enviarlos a ComfyUI (RTX 5080 local) para generar renders fotorrealistas con ControlNet + FLUX.

**Resultado**: ❌ NO funciona. El selector de canvas de React Three Fiber falla incluso con retry logic.

**Evidencia**: Consola muestra 5+ intentos fallidos:
```
[Hyperreal] __r3f store not found on canvas (múltiples veces)
[Hyperreal] Failed to acquire R3F state after 5 attempts
```

---

## CONTEXTO ORIGINAL (Prompts Base)

### 1. Prompt Maestro CTO Definitivo

**Prioridades definidas**:
```
AHORA (30 min):
  ① Fix cámara proporcional al área
  ② Fix exageración Y para terrenos planos
  ③ Deploy + regenerar twins de test

ESTA SEMANA:
  ④ Multi-parcela
  ⑤ Frontend refcats
  ⑥ Debug bodega 50ha

SEMANA 4+:
  ⑪ ComfyUI hiperrealismo (opcional, botón "✨ Render")
```

**Veredicto del prompt**: ComfyUI es FUTURO, no prioritario ahora. Se implementó prematuramente.

### 2. Prompt Hyperreal ComfyUI

**Arquitectura propuesta**:
- Captura depth map del visor Three.js
- Envía a ComfyUI local (puerto 8003)
- ControlNet preserva geometría
- IP-Adapter aplica texturas reales
- Retorna imagen hiperrealista como "capa de render"

**Estilos preconfigurados**: bodega, granja, extensivo (prompts específicos)

---

## QUÉ SE IMPLEMENTÓ

### Commit 1cee84f — Selector de Canvas Específico

**Problema inicial**: `getThreeState()` usaba `document.querySelector('canvas')` que podía capturar el canvas de Cesium en vez del de R3F.

**Solución aplicada**:

1. **TerrainCanvas.tsx**:
   - Añadido wrapper `<div id="terrain-studio-canvas-container">`
   - El `<Canvas>` de R3F queda dentro de un contenedor identificable

2. **HyperrealButton.tsx**:
   - `getThreeState()` ahora busca:
     ```typescript
     const container = document.getElementById('terrain-studio-canvas-container');
     const canvas = container.querySelector('canvas');
     const root = canvas.__r3f; // ← Aquí falla
     ```
   - Añadidos console.warn para cada failure case

**Archivos modificados**:
- `apps/web/src/components/terrain-studio/TerrainCanvas.tsx`
- `apps/web/src/components/terrain-studio/toolbar/HyperrealButton.tsx`

**Resultado**: Deploy exitoso, PERO el error persistió.

---

### Commit 0b2e5cb — Retry Logic con Delays

**Problema observado**: La consola mostraba `[Hyperreal] __r3f store not found on canvas` inmediatamente. Hipótesis: el store se adjunta **después** de que el Canvas monta.

**Solución aplicada**:

1. **Nueva función** `getThreeStateWithRetry()`:
   ```typescript
   async function getThreeStateWithRetry(
     maxAttempts = 5,
     delayMs = 150
   ): Promise<...> {
     for (let attempt = 1; attempt <= maxAttempts; attempt++) {
       const state = getThreeState();
       if (state) return state;
       
       await new Promise(resolve => setTimeout(resolve, delayMs));
     }
     return null;
   }
   ```

2. **handleClick actualizado**:
   - Ahora espera hasta 750ms (5 × 150ms)
   - Muestra estado: `"Esperando R3F..."` mientras reintenta
   - Logs progresivos: `Retry 1/5`, `Retry 2/5`, etc.

**Archivos modificados**:
- `apps/web/src/components/terrain-studio/toolbar/HyperrealButton.tsx`

**Resultado**: Deploy exitoso, PERO el error persistió (ver captura adjunta).

---

## POR QUÉ NO FUNCIONA (Análisis)

### Evidencia de la Consola (Captura de Pantalla)

```
[StudioViewer] FINAL TERRAIN STATUS: ...
[StudioViewer] Vertical exaggeration: 1x
[StudioViewer] Globe lighting: false
[StudioViewer] Terrain shadows: 0
[helStore] Listed 12 snapshot(s)
[helStore] Saved snapshot: wIiYY1vjw

[TerrainStudio] Camera re-targeted to building complex: center=[17.29, -13.44, 17.32], size=(0.70, 0.60, 2.18)
[TerrainModel] Camera re-targeted
[UniversalGLTF] Fixing complex: center=[7.29, -13.44, 17.32]
(TerrainModel) local_origin loaded: {"x":Object}

⚠️ [Hyperreal] __r3f store not found on canvas (764.dd926248bf31c8f9.js:1:1)
[Hyperreal] Retry 1/5 in 150ms... (764.dd926248bf31c8f9.js:1:1)
⚠️ [Hyperreal] __r3f store not found on canvas (764.dd926248bf31c8f9.js:1:1)
[Hyperreal] Retry 2/5 in 150ms... (764.dd926248bf31c8f9.js:1:1)
⚠️ [Hyperreal] __r3f store not found on canvas (764.dd926248bf31c8f9.js:1:1)
[Hyperreal] Retry 3/5 in 150ms... (764.dd926248bf31c8f9.js:1:1)
⚠️ [Hyperreal] __r3f store not found on canvas (764.dd926248bf31c8f9.js:1:1)
[Hyperreal] Retry 4/5 in 150ms... (764.dd926248bf31c8f9.js:1:1)
⚠️ [Hyperreal] __r3f store not found on canvas (764.dd926248bf31c8f9.js:1:1)
⚠️ [Hyperreal] Failed to acquire R3F state after 5 attempts (378.c4f255488f71c82d4a.js:1:231)
```

### Diagnóstico

1. **El contenedor se encuentra**: No hay error "container not found"
2. **El canvas se encuentra**: No hay error "canvas not found"
3. **El store NO se encuentra**: `canvas.__r3f` es `undefined` SIEMPRE

### Hipótesis de Fallo

#### Opción A: Versión de React Three Fiber
La propiedad `__r3f` puede no existir en la versión actual de R3F. Algunas versiones usan un store interno no expuesto al DOM.

#### Opción B: Timing Extremo
Incluso con 750ms de delay, el store podría inicializarse en el `useEffect` de un componente hijo que aún no ha montado completamente.

#### Opción C: Modo de Renderizado
Si R3F usa un `frameloop="demand"` o similar, el store podría no crearse hasta que haya un render explícito.

#### Opción D: Arquitectura Incorrecta
Acceder a `__r3f` desde FUERA del `<Canvas>` es un anti-pattern. El botón debería estar **dentro** del Canvas usando `useThree()`.

---

## ARQUITECTURA ACTUAL vs CORRECTA

### Como Está Ahora (❌ INCORRECTO)

```
TerrainStudio.tsx
├── StudioToolbar (fuera del Canvas)
│   └── HyperrealButton ← intenta acceder __r3f via DOM
├── TerrainCanvas
    └── <Canvas>
        └── TerrainModel (usa useThree() ✓)
```

El `HyperrealButton` está **fuera** del árbol de React Three Fiber, por lo que:
- NO puede usar `useThree()` (hook solo válido dentro de `<Canvas>`)
- Debe acceder al store a través del DOM (`canvas.__r3f`)
- Esto es frágil y propenso a fallos de timing

### Como Debería Ser (✓ CORRECTO)

```
TerrainStudio.tsx
├── StudioToolbar (UI exterior)
│   └── <button onClick={() => captureRef.current?.capture()}>
├── TerrainCanvas
    └── <Canvas>
        ├── TerrainModel
        └── CaptureHelper ref={captureRef} ← componente interno con useThree()
```

**Componente interno** `CaptureHelper`:
```typescript
// Dentro del <Canvas>
const CaptureHelper = forwardRef((props, ref) => {
  const { gl, scene, camera } = useThree(); // ✓ Hook nativo de R3F
  
  useImperativeHandle(ref, () => ({
    capture: async () => {
      const depthBlob = captureDepthMap(gl, scene, camera);
      const rgbBlob = captureRGB(gl, scene, camera);
      await sendToComfyUI(depthBlob, rgbBlob);
    }
  }));
  
  return null; // Invisible
});
```

---

## SOLUCIÓN RECOMENDADA (No Implementada)

### Paso 1: Crear Componente Interno de Captura

**Archivo nuevo**: `apps/web/src/components/terrain-studio/CaptureHelper.tsx`

```typescript
import { useThree } from '@react-three/fiber';
import { forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';

export interface CaptureHelperRef {
  captureDepthAndRGB: () => Promise<{ depth: Blob; rgb: Blob }>;
}

export const CaptureHelper = forwardRef<CaptureHelperRef>((props, ref) => {
  const { gl, scene, camera } = useThree();

  useImperativeHandle(ref, () => ({
    async captureDepthAndRGB() {
      // Captura depth map (mismo código que captureDepthMap actual)
      const depthBlob = captureDepthMap(gl, scene, camera);
      
      // Captura RGB (mismo código que captureRGB actual)
      const rgbBlob = captureRGB(gl, scene, camera);
      
      return { depth: depthBlob, rgb: rgbBlob };
    }
  }));

  return null; // Componente invisible
});

function captureDepthMap(gl, scene, camera): Blob {
  // ... código existente de HyperrealButton
}

function captureRGB(gl, scene, camera): Blob {
  // ... código existente de HyperrealButton
}
```

### Paso 2: Añadir al Canvas

**Modificar**: `apps/web/src/components/terrain-studio/TerrainCanvas.tsx`

```typescript
export default function TerrainCanvas({ glbUrl, geojson }: TerrainCanvasProps) {
  const captureRef = useRef<CaptureHelperRef>(null);
  
  // Exponer captureRef al store global para que HyperrealButton acceda
  useEffect(() => {
    useStudioStore.setState({ captureRef });
  }, []);

  return (
    <div id="terrain-studio-canvas-container">
      <Canvas ...>
        <CaptureHelper ref={captureRef} />
        {/* ... resto de componentes */}
      </Canvas>
    </div>
  );
}
```

### Paso 3: HyperrealButton Simplificado

**Modificar**: `apps/web/src/components/terrain-studio/toolbar/HyperrealButton.tsx`

```typescript
export default function HyperrealButton({ twinId }: HyperrealButtonProps) {
  const captureRef = useStudioStore(s => s.captureRef);
  
  const handleClick = async () => {
    if (!captureRef?.current) {
      setError('Terrain Studio no está listo');
      return;
    }

    setLoading(true);
    try {
      const { depth, rgb } = await captureRef.current.captureDepthAndRGB();
      
      // Enviar a ComfyUI (código existente)
      // ...
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  // ... resto del componente
}
```

---

## ESTADO ACTUAL DE ARCHIVOS

### Modificados en Esta Sesión

1. **apps/web/src/components/terrain-studio/TerrainCanvas.tsx**
   - Línea 48: Añadido `<div id="terrain-studio-canvas-container">`
   - Línea 141: Cerrado `</div>`

2. **apps/web/src/components/terrain-studio/toolbar/HyperrealButton.tsx**
   - Líneas 27-58: `getThreeState()` con selector específico + console.warn
   - Líneas 60-80: `getThreeStateWithRetry()` con 5 intentos @ 150ms
   - Líneas 157-172: `handleClick()` actualizado para usar retry async

### Deployados

- Commit `1cee84f`: "fix: specific canvas selector for Hyperreal R3F detection"
- Commit `0b2e5cb`: "fix: add retry logic for R3F store acquisition in Hyperreal"
- Ambos en producción: `geotwin-web` container en 192.168.30.101

---

## FUNCIONALIDAD COMFYUI (Backend)

### Estado del Servicio

**Container**: `geotwin-hyperreal` (puerto 8003)  
**Stack**: ComfyUI + FLUX + ControlNet  
**Hardware**: RTX 5080 16GB (192.168.30.101)

**Endpoint implementado**: `/api/hyperreal`

**Flujo esperado**:
```
1. Frontend captura depth.png + rgb.png
2. POST multipart/form-data a http://localhost:8003/api/hyperreal
3. ComfyUI procesa con workflow específico (bodega/granja/extensivo)
4. Retorna imagen hiperrealista 2048x2048
```

**Estado**: ✅ Backend funcional (verificado con curl)  
**Problema**: ❌ Frontend no puede capturar las imágenes

---

## PRÓXIMOS PASOS SUGERIDOS

### Opción 1: Refactorizar con CaptureHelper (RECOMENDADO)

**Esfuerzo**: 1-2 horas  
**Riesgo**: Bajo  
**Beneficio**: Arquitectura correcta, usa patrones oficiales de R3F

1. Crear `CaptureHelper.tsx` (componente interno del Canvas)
2. Exponer `captureRef` vía store Zustand
3. HyperrealButton llama a `captureRef.current.captureDepthAndRGB()`
4. Eliminar toda la lógica de `getThreeState()` / `__r3f`

### Opción 2: Investigar R3F Internals

**Esfuerzo**: 2-4 horas (investigación + debugging)  
**Riesgo**: Alto (puede no tener solución)  
**Beneficio**: Entender por qué `__r3f` no está disponible

1. Verificar versión de `@react-three/fiber` (actual vs docs)
2. Inspeccionar canvas en DevTools → propiedades enumerables
3. Ver si el store está en otro namespace (`__r3f__`, `_fiber`, etc.)

### Opción 3: Portal React para el Botón

**Esfuerzo**: 4-6 horas  
**Riesgo**: Medio  
**Beneficio**: Mantener el botón en el toolbar pero acceder al contexto R3F

1. El botón renderiza un `<Portal>` dentro del Canvas
2. El Portal contiene un componente invisible con `useThree()`
3. Comunicación via eventos custom o ref

### Opción 4: Posponer Hyperreal (ALINEADO CON PROMPT MAESTRO)

**Esfuerzo**: 0 (no hacer nada)  
**Riesgo**: Ninguno  
**Beneficio**: Priorizar fixes críticos del prompt maestro

**Justificación**: El prompt maestro_cto_definitivo marca ComfyUI como "SEMANA 4+", NO urgente. Las prioridades AHORA son:

1. ✅ ~~Fix cámara proporcional~~ (PENDIENTE)
2. ✅ ~~Fix exageración Y~~ (PENDIENTE)
3. ❌ Multi-parcela (SIN EMPEZAR)
4. ❌ Debug bodega 50ha (SIN EMPEZAR)

Implementar Hyperreal prematuramente ha consumido tiempo de desarrollo sin ROI inmediato.

---

## LECCIONES APRENDIDAS

### ❌ Anti-Patterns Encontrados

1. **Acceso directo al DOM desde React**: `document.querySelector('canvas').__r3f`
   - Frágil, rompe con cambios en R3F
   - No aprovecha el sistema de hooks de React

2. **Retry logic en timing**: `setTimeout()` en bucle
   - Oculta el problema real (arquitectura incorrecta)
   - Añade latencia innecesaria

3. **Componente fuera del árbol R3F**: `HyperrealButton` en toolbar externo
   - No puede usar `useThree()`
   - Obliga a hacks para acceder al contexto

### ✅ Mejores Prácticas

1. **Componentes internos del Canvas** para lógica que necesita acceso a gl/scene/camera
2. **Refs/callbacks** para comunicación Canvas ↔ UI externa
3. **Zustand store** para estado compartido entre componentes R3F y React normal
4. **Priorización** según roadmap (Maestro CTO) en vez de features "cool"

---

## MÉTRICAS

### Tiempo Invertido
- Diagnóstico inicial: 30 min
- Implementación commit 1cee84f: 45 min
- Implementación commit 0b2e5cb: 30 min
- Deploy + verify (×2): 20 min
- Documentación handoff: 40 min
- **TOTAL**: ~2h 45min

### Deuda Técnica Generada
- `getThreeState()` con retry logic que nunca funcionará
- Código muerto: `captureDepthMap()`, `captureRGB()` nunca ejecutados
- Console.warn spam en producción (5 mensajes por click en Hyperreal)

### ROI
- **Valor entregado**: 0 (feature no funcional)
- **Costo**: 2h 45min + deploy cycles
- **Impacto en usuarios**: Negativo (botón roto, mensajes de error)

---

## RECOMENDACIÓN FINAL

**ROLLBACK TEMPORAL** del botón Hyperreal hasta implementar correctamente:

1. **Ocultar botón**: Comentar `<HyperrealButton>` en `StudioToolbar.tsx`
2. **Mantener código**: NO borrar, dejar para refactorización futura
3. **Priorizar**: Fixes del prompt maestro (cámara + Y exag + multi-parcela)
4. **Retomar**: Semana 4+ con arquitectura CaptureHelper correcta

**Siguiente acción**: Volver a `BLOQUE A: FIXES INMEDIATOS` del prompt maestro:
- Fix 1: Cámara proporcional al tamaño de parcela
- Fix 2: Exageración Y controlada

---

## REFERENCIAS

- **Prompt Maestro CTO**: `/home/davidia/Descargas/prompt_maestro_cto_definitivo.md`
- **Prompt Hyperreal**: `/home/davidia/Descargas/prompt_hyperreal_comfyui.md`
- **Commits**:
  - 1cee84f: Selector específico de canvas
  - 0b2e5cb: Retry logic
- **Producción**: https://geotwin.es (container geotwin-web @ 192.168.30.101)

---

**Handoff preparado por**: Engine Expert Agent  
**Fecha**: 6 abril 2026 17:18 UTC  
**Estado del sistema**: Producción estable, Hyperreal no funcional pero no bloquea otras features
