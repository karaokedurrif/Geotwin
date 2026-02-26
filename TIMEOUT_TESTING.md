# Timeout Watchdog - Testing Guide

## ✅ Implementation Summary

Se han implementado los siguientes mecanismos de protección contra bloqueos:

### 1. **Timeouts Configurables**
```typescript
const TIMEOUTS = {
  TERRAIN: 12000,    // 12 segundos
  IMAGERY: 12000,    // 12 segundos  
  NDVI: 15000,       // 15 segundos
  API_HEALTH: 5000,  // 5 segundos
};
```

### 2. **Estados de Carga**
- `idle`: Sin actividad
- `loading`: Cargando (con animación pulse)
- `success`: Carga exitosa (verde)
- `fallback`: Timeout/error pero con fallback (amarillo)
- `error`: Error sin recuperación (rojo)

### 3. **Inicialización No-Bloqueante**
El viewer ahora se inicializa en 3 pasos:
1. **Crear viewer inmediatamente** con OSM + Ellipsoid (siempre funciona)
2. **Cargar geometría** sin esperar terrain/imagery
3. **Actualizar terrain/imagery** de forma asíncrona con timeout

### 4. **Health Check de API**
Al cargar la página se verifica si la API está disponible:
- ✅ Online: Se muestra latencia en ms
- ❌ Offline: Se muestra error y se deshabilita NDVI

---

## 🧪 Escenarios de Testing

### Escenario 1: Todo Funciona (Happy Path)
**Estado inicial**: API corriendo, Ion token válido

**Pasos**:
1. Abrir http://localhost:3000
2. Click en "Load Sample Data"

**Resultado esperado**:
```
Status Badges:
🔌 API: online (15ms)
🏔️ Terrain: success (verde)
🗺️ Imagery: success (verde)

Logs:
ℹ Checking API health...
✓ API online (15ms)
ℹ Initializing Cesium viewer...
✓ Viewer initialized (OSM + Ellipsoid)
ℹ Loading geometry...
ℹ Loading Ion imagery...
✓ Ion imagery loaded
ℹ Loading World Terrain...
✓ World Terrain loaded
✓ Loaded 7 layers
```

---

### Escenario 2: Sin Token de Cesium Ion
**Estado inicial**: API corriendo, sin `NEXT_PUBLIC_CESIUM_ION_TOKEN`

**Pasos**:
1. Comentar token en `.env.local`:
   ```bash
   # NEXT_PUBLIC_CESIUM_ION_TOKEN=...
   ```
2. Reiniciar servidor web
3. Load Sample Data

**Resultado esperado**:
```
Status Badges:
🔌 API: online (12ms)
🏔️ Terrain: success (verde)
🗺️ Imagery: success (verde)

Logs:
✓ Viewer initialized (OSM + Ellipsoid)
ℹ Using OSM imagery (no Ion token)
ℹ Using ellipsoid terrain (disabled or no token)
```

**Comportamiento**: Todo funciona pero con OSM y ellipsoid (sin 3D terrain).

---

### Escenario 3: API Offline
**Estado inicial**: API detenida

**Pasos**:
1. Detener API:
   ```bash
   pkill -f "tsx.*server.ts"
   ```
2. Recargar página web
3. Load Sample Data

**Resultado esperado**:
```
Status Badges:
🔌 API: offline (Timeout after 5000ms) (rojo)
🏔️ Terrain: success/fallback
🗺️ Imagery: success/fallback

Logs:
ℹ Checking API health...
⚠ API offline: Timeout after 5000ms
✓ Viewer initialized (OSM + Ellipsoid)
```

**Comportamiento**: 
- Viewer sigue funcionando
- Toggle de NDVI deshabilitado (no se puede cargar sin API)
- Geometry no carga (depende de API)

---

### Escenario 4: Timeout de Terrain
**Simulación**: Desconectar internet temporalmente mientras carga terrain

**Pasos**:
1. Load Sample Data
2. Inmediatamente desconectar WiFi/Ethernet
3. Esperar 12 segundos

**Resultado esperado**:
```
Status Badges:
🏔️ Terrain: fallback (amarillo)

Logs:
ℹ Loading World Terrain...
⚠ Terrain timeout (12000ms) - using ellipsoid
```

**Comportamiento**: 
- Viewer sigue funcionando con ellipsoid
- No bloquea la UI
- Estado cambia automáticamente a fallback

---

### Escenario 5: Timeout de NDVI
**Estado inicial**: API muy lenta o Copernicus saturado

**Pasos**:
1. Load Sample Data
2. Toggle "🛰️ Real NDVI (Sentinel-2)"
3. Esperar más de 15 segundos sin respuesta

**Resultado esperado**:
```
Status Badges:
🛰️ NDVI: Timeout (amarillo)

Logs:
ℹ Loading NDVI from Sentinel-2...
❌ NDVI failed: Timeout (NDVI Fetch)
ℹ   (Yellow bbox shows expected region)
```

**Comportamiento**:
- Yellow rectangle visible en el mapa (muestra región esperada)
- No bloquea UI
- Usuario puede seguir navegando

---

### Escenario 6: Token de Cesium Ion Inválido
**Estado inicial**: Token corrupto en `.env.local`

**Pasos**:
1. Establecer token inválido:
   ```bash
   NEXT_PUBLIC_CESIUM_ION_TOKEN=invalid_token_123
   ```
2. Reiniciar servidor web
3. Load Sample Data

**Resultado esperado**:
```
Status Badges:
🏔️ Terrain: fallback (amarillo)
🗺️ Imagery: fallback (amarillo)

Logs:
⚠ Ion imagery failed: ... - using OSM
⚠ Terrain failed: ... - using ellipsoid
```

**Comportamiento**: Fallback automático a OSM + Ellipsoid.

---

## 🎯 Verificaciones Críticas

### ✅ Nunca Debe Bloquearse
- [ ] Viewer renderiza aunque terrain/imagery fallen
- [ ] UI responde aunque API esté offline
- [ ] Logs siempre visibles
- [ ] Status badges actualizan en tiempo real

### ✅ Timeouts Funcionan
- [ ] Terrain timeout a los 12s → fallback a ellipsoid
- [ ] Imagery timeout a los 12s → fallback a OSM
- [ ] NDVI timeout a los 15s → mostrar error
- [ ] API health timeout a los 5s → marcar offline

### ✅ Estados Visuales Correctos
- [ ] `loading`: Badge azul con animación pulse
- [ ] `success`: Badge verde
- [ ] `fallback`: Badge amarillo
- [ ] `error`: Badge rojo

### ✅ Logs Claros
- [ ] ℹ Info: gris
- [ ] ✓ Success: verde
- [ ] ⚠ Warning: amarillo
- [ ] ❌ Error: rojo

---

## 🔧 Debugging Tips

### Si el viewer no carga:
1. Abrir DevTools Console (F12)
2. Buscar errores de Cesium
3. Verificar que `window.Cesium` existe
4. Check status badges en top-right

### Si terrain/imagery se queda en "loading":
1. Console → buscar timeout después de 12s
2. Verificar token en Network tab (401/403 = inválido)
3. Check logs en sidebar izquierdo

### Si NDVI falla:
1. Verificar API health badge (debe estar "online")
2. Console → ver HTTP status del POST /api/ndvi
3. Buscar yellow rectangle en mapa (bbox debug)

---

## 📊 Métricas de Performance

### Tiempos Esperados (con todo funcionando):
- **API Health Check**: < 50ms
- **Viewer Init**: < 500ms (inmediato con OSM)
- **Ion Imagery**: 2-5 segundos
- **World Terrain**: 3-8 segundos
- **NDVI Load**: 5-12 segundos (depende de Copernicus)

### Timeouts Configurados:
- Terrain: 12s
- Imagery: 12s
- NDVI: 15s
- API Health: 5s

Si algún timeout se alcanza regularmente, considerar aumentarlo en `TIMEOUTS` dentro de `CesiumViewer.tsx`.

---

## 🚑 Recuperación de Errores

### Fallback Automático:
| Componente | Fallback |
|------------|----------|
| Terrain | Ellipsoid (flat) |
| Imagery | OpenStreetMap |
| NDVI | Demo grid (si disponible) |
| API | Viewer funciona sin geometry |

### Manual Recovery:
1. **Recargar página**: Ctrl+R / Cmd+R
2. **Toggle terrain**: Off → On para reintentar carga
3. **Toggle NDVI**: Off → On para reintentar fetch
4. **Restart API**: Si health check falla

---

## 📝 Checklist de Producción

Antes de deploy:
- [ ] Verificar todos los timeouts son apropiados para red lenta
- [ ] Testing con API offline
- [ ] Testing sin Ion token
- [ ] Testing con token inválido
- [ ] Verificar logs no exponen secretos
- [ ] Testing en mobile (latencia más alta)
- [ ] Monitorear rate de fallbacks en analytics

---

**Última actualización**: 18 Feb 2026
**Versión**: 1.0.0 MVP con Watchdog
