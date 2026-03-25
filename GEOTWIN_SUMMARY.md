# GeoTwin Engine - Resumen Técnico Completo

## 🌍 Descripción General

**GeoTwin Engine** es una plataforma web de visualización 3D geoespacial que genera gemelos digitales interactivos de parcelas catastrales y explotaciones agrícolas/ganaderas. Utiliza Cesium.js para renderizar terreno real, imágenes satelitales de alta resolución, datos NDVI de vegetación y edificaciones en un entorno 3D navegable.

## 🎯 Propósito Principal

Transformar datos catastrales (KML/GML) en **experiencias 3D inmersivas** que permiten:
- Visualizar parcelas con contexto geográfico completo (terreno, vegetación, infraestructura)
- Analizar salud de cultivos mediante NDVI (Sentinel-2)
- Planificar infraestructura ganadera con visualización 3D del terreno
- Exportar geometrías y metadatos para análisis externos
- Generar vistas isNEXT_PUBLIC_MDT02_ASSET_IDométricas profesionales para documentación

---

## 🏗️ Arquitectura del Sistema

### **Frontend** (Next.js 14.2.35 + React + Cesium.js 1.113.0)
```
apps/web/
├── src/
│   ├── components/
│   │   ├── CesiumViewer.tsx      # Motor 3D principal (2081 líneas)
│   │   └── ControlPanel.tsx      # Panel de control UI
│   ├── lib/
│   │   ├── exportUtils.ts        # Sistema de exportación GeoJSON/metadata
│   │   └── geo/
│   │       └── reprojectKml.ts   # Reproyección UTM → WGS84
│   ├── utils/
│   │   ├── cesiumUtils.ts        # Utilidades de escena (waitForSceneReady)
│   │   └── withTimeout.ts        # Gestión de timeouts robusta
│   └── pages/
│       └── index.tsx             # Página principal con estado
```

### **Backend** (Fastify API - Node.js)
```
apps/api/
├── src/
│   ├── config/
│   │   └── presets.ts            # Configuración visual (Dehesa, Mountain, Mediterranean)
│   ├── routes/
│   │   └── recipe.ts             # Generación de TwinRecipe JSON
│   └── lib/
│       └── kml-parser.ts         # Parser de geometrías KML/GML
```

### **Base de Datos de Parcelas**
```
apps/api/data/
├── {parcelId}/
│   ├── geometry.kml              # Polígono catastral
│   ├── buildings.gml             # Edificaciones (opcional)
│   └── metadata.json             # Información administrativa
```

---

## 🚀 Funcionalidades Principales

### 1. **Carga de Parcelas Catastrales**
- **Entrada**: KML/GML con coordenadas en cualquier sistema (UTM, WGS84)
- **Reproyección automática**: Detecta EPSG de origen → convierte a WGS84
- **Cálculo de bounding sphere**: Para encuadre automático de cámara
- **Soporte de edificaciones**: Parser GML para estructuras 3D

### 2. **Visualización 3D Multicapa**

#### **Capas Disponibles**
| Capa | Descripción | Fuente |
|------|-------------|--------|
| **Parcel Boundary** | Polígono de parcela con extrusión opcional | KML/GML |
| **Parcel Extrusion** | Volumen 3D de la parcela | Calculado |
| **NDVI Heatmap** | Mapa de calor de vegetación | Sentinel-2 (21/02/2026) |
| **Water Points** | Puntos de agua (demo) | Generados |
| **ROI Labels** | Etiquetas de zonas de interés | Calculadas |
| **Oak Trees** | Árboles decorativos (Dehesa preset) | Billboards 3D |
| **Tile Plinth** | Base rectangular bajo parcela | OFF por defecto |
| **Buildings (GML)** | Edificaciones catastrales | GML parsing |

#### **Servicios de Datos Visuales**
- **Terrain**: Cesium World Terrain (30m) o MDT02 local (2m)
- **Imagery**: PNOA - Ortofoto España 25cm/px (IGN) vía Ion
- **NDVI**: Sentinel-2 L2A procesado con Copernicus

### 3. **Sistema de Presets Visuales**

#### **Preset "Dehesa"** (Pastizal mediterráneo)
```javascript
{
  terrainExaggeration: 1.0,
  lightingIntensity: 1.0,
  atmosphere: {
    brightness: 1.1,
    saturation: 1.05,
    hueShift: 15,        // Tonos cálidos dorados
    hazeIntensity: 0.08
  },
  groundTint: rgba(220, 200, 140, 0.25),  // Color pastura
  markers: {
    type: 'oak',
    count: 120,           // 120 encinas
    icon: '🌳',
    scale: 1.2
  },
  ndviIntensity: 0.85     // NDVI enfatizado
}
```

#### **Preset "Mountain"** (Montaña rocosa)
```javascript
{
  terrainExaggeration: 2.0,   // Relieve exagerado
  lightingIntensity: 1.2,
  atmosphere: {
    brightness: 0.9,
    saturation: 0.85,
    hueShift: -10,            // Tonos fríos azulados
    hazeIntensity: 0.15
  },
  groundTint: rgba(180, 190, 200, 0.3),
  markers: {
    type: 'rock',
    count: 15,
    icon: '🏔️'
  }
}
```

#### **Preset "Mediterranean"** (Mediterráneo seco)
```javascript
{
  terrainExaggeration: 1.2,
  lightingIntensity: 1.3,     // Luz intensa
  atmosphere: {
    brightness: 1.2,
    hazeIntensity: 0.25       // Atmósfera polvorienta
  },
  groundTint: rgba(210, 190, 120, 0.3),
  markers: {
    type: 'olive',
    count: 10,
    icon: '🫒'
  }
}
```

### 4. **Sistema de Cámara Inteligente**

#### **Modo Isométrico** (Vista técnica profesional)
```javascript
{
  heading: 315°,           // Suroeste (vista diagonal)
  pitch: -45°,             // 45° hacia abajo
  range: max(radius × 2.2 × framingMargin, 150m)
}
```

- **Framing Margin**: Slider 1.1-2.0 (control de zoom)
- **Espera de tiles**: `waitForSceneReady()` previene pantallas negras
- **Dual strategy**: Listeners de `tileLoadProgressEvent` + `postRender`
- **Ready conditions**: `tilesLoaded=true` durante 2 frames + ≥4 frames renderizados

#### **Funciones de Navegación**
- `🎯 Recenter Camera`: Vuelve al encuadre isométrico inicial
- `📐 Isometric View`: Fuerza vista técnica predefinida
- Navegación libre con mouse (pan, zoom, rotate)

### 5. **Sistema de Exportación de Geometría** ✨ (NUEVO)

#### **Archivos Exportados**

**`parcel.geojson`** - Geometría estándar GeoJSON
```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[lon, lat], [lon, lat], ...]]
    },
    "properties": {
      "sourceFileName": "40212A00200007.kml",
      "timestamp": "2026-02-22T10:30:00.000Z",
      "area_m2": 135050.45,
      "perimeter_m": 1702.34
    }
  }]
}
```

**`parcel.meta.json`** - Metadatos técnicos completos
```json
{
  "centroid": [-3.98273, 40.08715],
  "bbox": {
    "minLon": -3.98527,
    "minLat": 40.08604,
    "maxLon": -3.98020,
    "maxLat": 40.08826
  },
  "boundingSphere": {
    "centerLon": -3.98273,
    "centerLat": 40.08715,
    "radiusMeters": 971
  },
  "cameraPreset": {
    "headingDeg": 315,
    "pitchDeg": -45,
    "range_m": 2139.42
  },
  "localFrameENU": {
    "origin": {
      "lon": -3.98273,
      "lat": 40.08715,
      "height": 0
    },
    "matrix4": [
      0.9876, 0.0523, 0.0000, 0.0000,
      -0.0334, 0.6284, 0.7771, 0.0000,
      0.0407, -0.7662, 0.6284, 0.0000,
      0.0000, 0.0000, 0.0000, 1.0000
    ]
  }
}
```

#### **Cálculos Implementados**
- **Área**: Fórmula shoelace adaptada a coordenadas esféricas
- **Perímetro**: Suma de distancias geodésicas entre vértices
- **Bounding Box**: Min/max de coordenadas
- **Local Frame ENU**: Matriz 4×4 de transformación ECEF→ENU (East-North-Up)

#### **Flujo de Export**
1. Usuario hace click en `📦 Export Parcel`
2. Extracción de posiciones desde `entity.polygon.hierarchy`
3. Cálculo de geometrías y metadatos
4. Descarga automática vía Blob API (no requiere librerías)
5. Logs en consola: `📦 Exported parcel.geojson (N points)`

---

## 🔧 Stack Tecnológico

### **Core Technologies**
| Tecnología | Versión | Uso |
|------------|---------|-----|
| **Next.js** | 14.2.35 | Framework React SSR/CSR |
| **React** | 18.3.1 | UI Components |
| **Cesium.js** | 1.113.0 | Motor 3D WebGL |
| **TypeScript** | 5.x | Type safety |
| **Tailwind CSS** | 3.x | Styling |
| **Fastify** | 4.x | API Backend |
| **pnpm** | Workspace | Monorepo manager |

### **Geospatial Libraries**
- **proj4** (2.12.1): Reproyección de coordenadas
- **@tmcw/togeojson** (5.8.1): Parsing KML
- **fast-xml-parser** (4.5.0): Parsing GML

### **Data Sources**
- **Cesium Ion**: Imagery PNOA + Terrain
- **Sentinel-2 (Copernicus)**: NDVI real-time
- **Catastro España**: Geometrías KML/GML

---

## 🎨 Interfaz de Usuario

### **Panel de Control Izquierdo**

#### **PRESET**
- Selector: Dehesa / Mountain / Mediterranean

#### **UPLOAD CADASTRAL FILE**
- Upload KML/GML custom
- Botón `Generate Twin`
- Botón `Load Sample Data` (40212A00200007.kml)

#### **LAYERS** (Checkboxes multi-selección)
- ☑ Parcel Boundary
- ☐ Parcel Extrusion
- ☑ NDVI Heatmap (Demo)
- ☑ Water Points (Demo)
- ☑ ROI Labels (Demo)
- ☑ Oak Trees
- ☐ Tile Plinth
- ☑ Buildings (GML)

#### **VISUALIZATION**
- Slider `🎯 Framing`: 1.1x - 2.0x (control de zoom)
- Botón `🎯 Recenter Camera` (habilitado si hay parcela)
- Botón `📐 Isometric View` (habilitado si hay parcela)
- Botón `📦 Export Parcel` (habilitado si hay parcela) ✨

#### **Parcel Info**
```
Centroid: [-3.98273, 40.08715]
Radius: 971m
⚠ Reprojected from EPSG:25830
```

#### **Real Terrain & Slopes** (Toggle)
- Terrain Source:
  - ◉ Cesium World Terrain
  - ○ Local MDT02 (CNIG)

#### **PNOA Imagery (IGN)** (Toggle)
- Ortofoto 25cm/píxel vía Cesium Ion

#### **Real NDVI (Sentinel-2)** (Toggle)
- Date selector: 21/02/2026

#### **LOGS** (Últimos 10 mensajes)
```
[12:34:56] Viewer initialized (OSM + Ellipsoid)
[12:34:57] Terrain: success
[12:34:58] Imagery: success
[12:34:59] NDVI: OK (0 KB)
```

### **Visor 3D Principal** (Derecha)

- Canvas Cesium a pantalla completa
- Badges flotantes (superior derecha):
  - `API: online (undefined ms)`
  - `Terrain: success`
  - `Imagery: success`
  - `NDVI: OK (43 KB)`
- Logo Cesium (inferior derecha)

---

## 🔌 API Backend

### **Endpoint Principal**

**`POST /api/recipe/generate`**

**Request Body:**
```json
{
  "geometryPath": "/data/40212A00200007/geometry.kml",
  "preset": "dehesa"
}
```

**Response: TwinRecipe**
```json
{
  "id": "qWe7Rt2iDC",
  "geometryPath": "/data/40212A00200007/geometry.kml",
  "buildingsPath": "/data/40212A00200007/buildings.gml",
  "preset": "dehesa",
  "area_ha": 13.51,
  "bbox": [-3.98527, 40.08604, -3.98020, 40.08826],
  "layers": [
    { "id": "boundary", "visible": true, "zIndex": 1 },
    { "id": "ndvi", "visible": true, "zIndex": 2 },
    { "id": "trees", "visible": true, "zIndex": 3 }
  ]
}
```

### **Endpoint de Carga de Muestras**

**`GET /api/sample-parcel-ids`**
```json
["40212A00200007", "28001A00100001", ...]
```

**`POST /api/load-sample`**
```json
{
  "preset": "dehesa",
  "parcelId": "40212A00200007"
}
```

---

## 🌐 Sistema de Conectividad

### **Detección de Offline Multi-nivel**

1. **`navigator.onLine`**: Detección de red del navegador
2. **Contador de errores de tiles**: ≥5 errores en 30s → offline
3. **Event listeners**: `'online'` / `'offline'` de window

### **Fallbacks Visuales**
```javascript
if (isOffline) {
  globe.baseColor = Cesium.Color.DARKGRAY;  // Nunca negro
  globe.show = true;
  imageryLayer.alpha = 1.0;
}
```

### **Badge UI Offline**
```
🔴 OFFLINE MODE
Check DevTools Network throttling
```

---

## 📊 Flujo de Trabajo Típico

### **1. Inicio de Aplicación**
```
User → http://localhost:3000
  ↓
API Health Check (3001/health)
  ↓
Cesium Viewer Init
  ├─ OSM Base Imagery
  ├─ Ellipsoid Terrain
  └─ globe.baseColor = DARKGRAY
```

### **2. Carga de Parcela**
```
User → "Load Sample Data" → 40212A00200007
  ↓
POST /api/load-sample
  ↓
TwinRecipe Generation
  ├─ Parse geometry.kml
  ├─ Parse buildings.gml (opcional)
  ├─ Calculate bbox + area
  └─ Apply preset config
  ↓
Frontend receives TwinRecipe
  ↓
loadGeometry()
  ├─ Reproject KML (UTM → WGS84 si necesario)
  ├─ Create Polygon Entity
  ├─ Calculate BoundingSphere
  ├─ onExportReady(true) ✨
  └─ waitForSceneReady()
  ↓
flyToIsometric()
  ├─ heading: 315°
  ├─ pitch: -45°
  └─ range: radius × 2.2 × margin
```

### **3. Upgrade de Servicios**
```
Terrain Upgrade
  └─ Cesium World Terrain (async)
  
Imagery Upgrade
  ├─ PNOA Ion Imagery
  └─ NDVI Overlay (Sentinel-2)
```

### **4. Exportación de Datos** ✨
```
User → Click "📦 Export Parcel"
  ↓
viewer.exportParcel()
  ├─ Extract positions from polygon.hierarchy
  ├─ Calculate area (shoelace formula)
  ├─ Calculate perimeter (geodesic)
  ├─ Calculate bbox, centroid
  ├─ Calculate local ENU frame (ECEF→ENU)
  ├─ Generate parcel.geojson
  ├─ Generate parcel.meta.json
  └─ Download via Blob API
  ↓
User receives 2 files locally
```

---

## 🐛 Robustez y Gestión de Errores

### **Prevención de Pantalla Negra**
1. **Globe.baseColor = DARKGRAY** en inicialización
2. **Check de luminancia + alpha efectivo**:
   ```javascript
   effectiveBrightness = luminance × alpha
   if (effectiveBrightness < 0.3) {
     globe.baseColor = DARKGRAY;
   }
   ```
3. **Background color explícito**: `scene.backgroundColor = DARKGRAY`
4. **Verificación de visibilidad**: `globe.show = true`, `imageryLayer.show = true`

### **Gestión de Sessions**
```javascript
sessionRef.current += 1;  // Invalida sesiones anteriores
if (currentSessionRef.current !== thisSession) {
  viewer.destroy();
  return;
}
```

### **Timeouts Robustos**
- API Health: 5000ms
- Terrain: 15000ms
- NDVI: 10000ms
- waitForSceneReady: 6000ms

### **Error Handlers**
- **Tile errors**: Contador con reset cada 30s
- **API errors**: Fallback a estado offline
- **Geometry errors**: Logs detallados + rollback

---

## 📈 Métricas y Logging

### **Console Logs DEBUG** (Desarrollo)
```javascript
[DEBUG] Container dimensions: {
  offsetWidth: 1265,
  offsetHeight: 866,
  computed: 'block'
}

[DEBUG] Viewer created: {
  canvas: HTMLCanvasElement,
  canvasWidth: 1265,
  canvasHeight: 866,
  globeShow: true,
  baseColor: "(0.66, 0.66, 0.66, 1)",
  backgroundColor: "(0.66, 0.66, 0.66, 1)",
  imageryLayersLength: 1
}

[DEBUG] After applyPresetConfig: {
  globeShow: true,
  baseColor: "(0.66, 0.66, 0.66, 1)",
  backgroundColor: "(0.66, 0.66, 0.66, 1)"
}
```

### **User-facing Logs**
```
✓ API online (42ms)
ℹ Loading parcel geometry...
✓ Geometry loaded: 135.05 ha
✓ Terrain: success
✓ Imagery: success
✓ NDVI: OK (43 KB)
✓ Scene ready, flying to parcel...
📦 Exported parcel.geojson (347 points)
📦 Exported parcel.meta.json
```

---

## 🚀 Casos de Uso para Explotaciones Ganaderas

### **1. Planificación de Infraestructura**
- Visualizar terreno 3D antes de construir cercados
- Identificar zonas óptimas para bebederos (elevación + acceso)
- Planificar accesos con pendientes reales

### **2. Gestión de Pastos**
- NDVI en tiempo real para detectar sobrepastoreo
- Identificar áreas con mejor vegetación
- Rotar ganado según salud del pasto

### **3. Análisis de Sombreado**
- Ubicación óptima de sombreaderos (encinas existentes)
- Orientación de naves/cobertizos según sol

### **4. Documentación Profesional**
- Exportar planos técnicos (vistas isométricas)
- Generar informes con screenshots 3D
- Compartir GeoJSON con técnicos/ingenieros

### **5. Integración con Sistemas Externos**
- Importar `parcel.geojson` en QGIS/ArcGIS
- Usar `localFrameENU` para geolocalización precisa en Unity/Unreal
- Calcular carga ganadera con `area_m2` exacta

---

## 🔮 Roadmap Futuro

### **Próximas Features Sugeridas**
- [ ] Medición de distancias/áreas manual (herramienta de dibujo)
- [ ] Capas climáticas (precipitación, temperatura)
- [ ] Simulación de sombras por hora del día
- [ ] Importación de puntos GPS de ganado
- [ ] Histórico temporal de NDVI (slider de fechas)
- [ ] Exportación a formatos CAD (DXF, DWG)
- [ ] Análisis de pendientes automático (zonas >15%)
- [ ] Cálculo de capacidad de carga ganadera por NDVI

---

## 📦 Instalación y Deployment

### **Desarrollo Local**
```bash
# Clonar repositorio
git clone <repo>
cd Geotwin

# Instalar dependencias
pnpm install

# Terminal 1: API Backend
cd apps/api
PORT=3001 pnpm dev

# Terminal 2: Frontend Web
cd apps/web
PORT=3000 pnpm dev

# Abrir navegador
http://localhost:3000
```

### **Variables de Entorno**
```bash
# apps/web/.env.local
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_CESIUM_ION_TOKEN=<your-token>

# apps/api/.env
COPERNICUS_USERNAME=<your-username>
COPERNICUS_PASSWORD=<your-password>
```

### **Build Producción**
```bash
# Build all workspaces
pnpm build

# Start production
pnpm start
```

---

## 🎓 Skills Técnicas Demostradas

### **Frontend**
- React Hooks avanzados (useRef, useEffect con cleanup)
- Gestión de estado complejo sin Redux
- Integración WebGL (Cesium.js)
- Performance optimization (session invalidation, async timeouts)
- Error boundaries y fallback states

### **Geospatial**
- Reproyección de coordenadas (proj4)
- Parsing KML/GML
- Cálculo de geometrías esféricas
- Sistemas de referencia (WGS84, UTM, ECEF, ENU)
- Integración con APIs satelitales (Sentinel-2)

### **Backend**
- API RESTful con Fastify
- File system management (monorepo de parcelas)
- JSON recipe generation
- CORS y seguridad básica

### **DevOps/Tooling**
- Monorepo con pnpm workspaces
- TypeScript en fullstack
- Debugging avanzado (console.log estratégico)
- Git workflow

---

## 📞 Contacto y Soporte

**Proyecto**: GeoTwin Engine  
**Versión**: 1.0.0  
**Última Actualización**: 22 de febrero de 2026  
**Autor**: David  
**Stack**: Next.js + Cesium.js + Fastify  

---

## 📄 Licencia

MIT License - Ver LICENSE file

---

## 🏆 Características Destacadas para Ops

### **Fortalezas Técnicas**
✅ **Robustez**: Sistema de fallbacks offline multi-nivel  
✅ **Performance**: Lazy loading de capas, session management  
✅ **UX**: Ninguna pantalla negra, feedback constante  
✅ **Extensibilidad**: Sistema de presets configurables  
✅ **Interoperabilidad**: Export estándar GeoJSON + metadatos  
✅ **Precisión**: Reproyección automática, cálculos geodésicos  

### **Innovaciones Implementadas**
- Dual-strategy scene readiness detection
- Effective brightness check (luminance × alpha)
- Local ENU frame generation para integración Unity/Unreal
- Framing margin dinámico con ref para evitar closure staleness
- Export sin dependencias externas (Blob API nativo)

---

**Este documento resume una plataforma completa de Digital Twin Geoespacial lista para escalar a sistemas de gestión ganadera más complejos.**
