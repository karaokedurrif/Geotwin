# GeoTwin — Plan de refactorización para BIM territorial

## 1. Visión

GeoTwin pasa de ser un visor geoespacial con capas demo a ser una **plataforma de reconstrucción territorial con mallado real, capas semánticas y simulación**.

La analogía correcta es: **BIM, pero para fincas y territorio rural**.

En BIM arquitectónico, un edificio tiene su geometría 3D, sus materiales, sus instalaciones, sus sensores y su modelo de simulación (energética, estructural, etc.). En GeoTwin, una finca tiene su terreno mallado, su vegetación, sus infraestructuras, sus sensores IoT, su ganado y su modelo de simulación (incendios, pastos, hidrología).

## 2. Estado actual (lo que ya tienes)

Basado en el snapshot `geotwin_geometry_snapshot (55).json`:

| Componente | Estado |
|---|---|
| Parcela/geometría | ✅ Polígono real, 361.4 ha, centroide definido |
| Sensores IoT | ✅ 12 nodos (TEMP, NH3, CO2, MOISTURE), pero value=0 |
| Ganado | ✅ 8 reses con posición y peso |
| Capas | ⚠️ Activas pero demo: ndvi_demo, water_demo, roi_demo |
| Cámara | ✅ Definida con heading, pitch, range |
| Terreno mallado | ❌ No existe |
| NDVI real | ❌ Es pseudo-NDVI |
| 3D Tiles | ❌ No se generan |
| Temporal/histórico | ❌ No hay series temporales |
| Drones | ❌ No hay pipeline |
| Simulación | ❌ No hay motor |

## 3. El salto que hay que dar

### De esto:
```
GeoJSON → capas demo → Cesium (visualización plana)
```

### A esto:
```
DEM + Orto + GeoJSON + IoT + Drones
        ↓
   [Processing Engine - Python]
        ↓
   Terrain Mesh + NDVI real + Capas semánticas
        ↓
   3D Tiles (LOD jerárquico)
        ↓
   Cesium (visualización 3D real con mallado)
        ↓
   Simulación (incendios, pastos, hidrología)
```

## 4. Arquitectura corregida

### Stack principal

| Capa | Tecnología | Responsabilidad |
|---|---|---|
| **Frontend** | Next.js + CesiumJS | Visor, capas, timeline, paneles |
| **API** | FastAPI (Python) o mantener Fastify (TS) | Auth, tenants, jobs, API REST |
| **Processing Engine** | Python (GDAL, rasterio, Open3D, trimesh, py3dtiles) | Mallado, NDVI, tiles, exportación |
| **Workers** | Celery / dramatiq + Redis | Jobs asíncronos pesados |
| **Spatial DB** | PostGIS | Geometrías, índices espaciales |
| **Time Series** | TimescaleDB o InfluxDB | IoT, históricos |
| **Object Storage** | S3 / MinIO | Rásteres, tiles, meshes, vuelos |
| **Premium (futuro)** | OpenUSD + Omniverse | Hiperrealismo, simulación avanzada |

### Estructura de código (realista, no aspiracional)

```
geotwin/
├── apps/
│   ├── web/                    # Next.js + CesiumJS (ya existe)
│   ├── api/                    # API (ya existe, Fastify o migrar a FastAPI)
│   └── worker/                 # Procesamiento asíncrono
│
├── engine/                     # Python - Motor de procesamiento
│   ├── __init__.py
│   ├── terrain/                # DEM → mesh → tiles
│   │   ├── mesh_generator.py   # DEM a malla triangulada
│   │   ├── lod_builder.py      # Niveles de detalle
│   │   └── tile_exporter.py    # Exportación a 3D Tiles
│   ├── raster/                 # Procesamiento de rásteres
│   │   ├── ndvi.py             # NDVI/NDRE real desde bandas
│   │   ├── ortho.py            # Ortofotos, mosaicos
│   │   └── catalog.py          # Catálogo STAC de rásteres
│   ├── vector/                 # Operaciones vectoriales
│   │   ├── aoi.py              # Recorte, buffer, simplificación
│   │   └── semantic.py         # Capas semánticas (vegetación, infraestructura)
│   └── exporters/              # Formatos de salida
│       ├── tiles3d.py          # 3D Tiles
│       ├── gltf.py             # glTF para assets
│       └── geotiff.py          # GeoTIFF para rásteres procesados
│
├── packages/
│   └── types/                  # Contratos compartidos TS
│
├── infra/
│   ├── docker/
│   └── migrations/
│
├── scripts/                    # Utilidades y herramientas
│   ├── ingest_dem.py           # Ingestión de DEM desde IGN/Copernicus
│   ├── ingest_ortho.py         # Ingestión de ortofotos PNOA
│   └── seed_twin.py            # Generación de twin de prueba con datos reales
│
└── docs/
```

## 5. Pipeline de mallado (la pieza clave)

Este es el pipeline concreto que necesitas para que GeoTwin sea un BIM territorial:

### Paso 1: Obtener DEM real
```python
# Fuentes para España:
# - IGN MDT05 (5m resolución) → gratuito
# - IGN MDT02 (2m resolución) → gratuito
# - Copernicus DEM (30m global) → gratuito
# - LiDAR PNOA (nubes de puntos) → gratuito, resolución submétrica

import rasterio
from rasterio.mask import mask
from shapely.geometry import shape

# Recortar DEM por AOI de la finca
with rasterio.open("mdt05_huso30.tif") as src:
    aoi = shape(finca_geojson["geometry"])
    dem_cropped, transform = mask(src, [aoi], crop=True)
```

### Paso 2: DEM → Malla triangulada
```python
import numpy as np
import trimesh
from scipy.spatial import Delaunay

# Crear grid de puntos desde DEM
rows, cols = dem_cropped.shape[1], dem_cropped.shape[2]
x = np.linspace(bounds.left, bounds.right, cols)
y = np.linspace(bounds.bottom, bounds.top, rows)
xx, yy = np.meshgrid(x, y)
zz = dem_cropped[0]

# Simplificar: no todos los puntos, submuestreo adaptativo
# (más detalle en pendientes fuertes, menos en zonas planas)
points_2d = np.column_stack([xx.ravel(), yy.ravel()])
tri = Delaunay(points_2d)

# Crear mesh 3D
vertices = np.column_stack([xx.ravel(), yy.ravel(), zz.ravel()])
mesh = trimesh.Trimesh(vertices=vertices, faces=tri.simplices)
```

### Paso 3: LOD jerárquico
```python
# Generar 4 niveles de detalle
# L0: 100% triángulos (detalle máximo, solo zona visible cercana)
# L1: 25% triángulos
# L2: 6% triángulos
# L3: 1.5% triángulos (vista general)

import open3d as o3d

mesh_o3d = o3d.geometry.TriangleMesh(
    vertices=o3d.utility.Vector3dVector(vertices),
    triangles=o3d.utility.Vector3iVector(faces)
)

lod_levels = [1.0, 0.25, 0.06, 0.015]
for i, ratio in enumerate(lod_levels):
    target = int(len(faces) * ratio)
    simplified = mesh_o3d.simplify_quadric_decimation(target)
    # Exportar cada LOD
```

### Paso 4: Texturizado con ortofoto
```python
# La ortofoto del PNOA se mapea como textura UV sobre la malla
# Cada vértice del mesh tiene coordenadas geográficas → se mapean a píxeles de la orto
# Resultado: malla 3D con textura fotorrealista del terreno real
```

### Paso 5: Exportación a 3D Tiles
```python
# py3dtiles genera el tileset.json + tiles binarios
# Cesium los consume directamente con streaming LOD
# El navegador solo carga los tiles visibles en el viewport

from py3dtiles.tileset.tileset import TileSet
# ... generación de tileset jerárquico
```

### Estimación de peso para 500 ha

| Componente | Resolución | Peso crudo | Peso en 3D Tiles (con LOD + compresión) |
|---|---|---|---|
| DEM | 5m | ~4 MB | ~2 MB |
| DEM | 1m | ~100 MB | ~30 MB |
| Mesh del terreno | 1m base, 4 LODs | ~600 MB | ~80 MB |
| Ortofoto textura | 25 cm/px | ~8 GB | ~800 MB (tiles JPEG) |
| Ortofoto textura | 10 cm/px | ~50 GB | ~3 GB (tiles JPEG) |
| Vegetación (instancias) | por especie/densidad | ~200 MB | ~40 MB |
| Infraestructura | vectorial | ~5 MB | ~2 MB |

**Total realista para 500 ha con orto a 25cm**: ~950 MB en 3D Tiles servidos. El usuario solo descarga ~50-100 MB a la vez (lo que ve).

## 6. Capas semánticas (de demo a real)

### Reemplazos concretos

| Capa actual (demo) | Reemplazo real | Fuente de datos |
|---|---|---|
| `ndvi_demo` | NDVI real desde Sentinel-2 o dron multiespectral | Copernicus Hub / vuelo DJI con payload NIR |
| `water_demo` | Capa hidrológica real | NDWI desde Sentinel-2 + MDT (acumulación de flujo) |
| `roi_demo` | Zonas de interés definidas por el usuario | Editor interactivo en Cesium |
| `oak_trees` (procedural) | Inventario forestal real o detección desde orto/LiDAR | LIDAR PNOA + clasificación |

## 7. Lo que NO cambiaría del informe de ChatGPT

- La separación Cesium (operativo) vs OpenUSD (premium) es correcta
- No meter Blender como runtime — correcto
- Instancing para vegetación — correcto
- Deltas temporales en vez de copias completas — correcto
- Simulación de incendios como módulo separado y posterior — correcto
- 3D Tiles para streaming jerárquico — correcto

## 8. Lo que SÍ cambiaría

| El informe dice | Yo haría |
|---|---|
| Engine en C++ | Engine en Python con librerías nativas (GDAL, Open3D, trimesh) |
| Python solo para tooling | Python como lenguaje principal del procesamiento |
| 15 carpetas de engine | 3-4 módulos reales, se crean cuando tienen código |
| Rust para workers | Python con Celery/dramatiq (más productivo, mismo resultado) |
| N-API bindings C++ → Node | Workers Python independientes, comunicación por cola de jobs |
| gRPC entre engine y API | API REST + cola de jobs (Redis/RabbitMQ), más simple |
| "Formalizar engine como producto separado" como primer paso | Primer paso = pipeline DEM → mesh → 3D Tiles funcionando end-to-end |

## 9. Orden de ejecución (primeros 90 días)

### Sprint 1 (semanas 1-3): Terrain Mesh Pipeline
- Descargar MDT05 del IGN para la zona de tu finca
- Pipeline Python: DEM → mesh → LOD → 3D Tiles
- Servir tiles desde carpeta estática o S3
- Cargar en Cesium con `Cesium3DTileset`
- **Resultado**: tu finca se ve con relieve real en el visor

### Sprint 2 (semanas 4-6): NDVI Real
- Descargar imagen Sentinel-2 de la zona (Copernicus Hub)
- Calcular NDVI real (banda NIR - banda RED) / (NIR + RED)
- Generar raster overlay georreferenciado
- Reemplazar `ndvi_demo` por capa real
- **Resultado**: NDVI real sobre el terreno mallado

### Sprint 3 (semanas 7-9): Ortofoto como textura
- Descargar PNOA de la zona (IGN)
- Texturizar el mesh del terreno con la ortofoto
- Regenerar 3D Tiles con textura
- **Resultado**: terreno con foto aérea real, navegable en 3D

### Sprint 4 (semanas 10-12): IoT temporal + persistencia
- Migrar de localStorage a PostGIS + TimescaleDB
- Conectar sensores IoT reales (o simulados con datos realistas)
- Timeline con playback temporal
- **Resultado**: twin operativo con datos reales y persistencia

---

## PARTE 3: Prompt para VS Code Copilot

---

```markdown
# CONTEXTO DEL PROYECTO

GeoTwin es una plataforma de gemelos digitales territoriales (BIM para fincas).
Actualmente es un MVP con:
- Frontend: Next.js + CesiumJS
- API: Fastify (TypeScript)
- Tipos compartidos en packages/types
- Capas: parcela, ndvi_demo, water_demo, roi_demo, oak_trees, sensores, ganado
- Formato de twin: TwinRecipe (JSON que describe capas y configuración)
- Las capas son DEMO (generadas sintéticamente), NO datos reales

## OBJETIVO DE ESTA REFACTORIZACIÓN

Convertir GeoTwin de "visor con capas demo" a "plataforma de reconstrucción territorial con mallado real".

Tres objetivos concretos:
1. **Pipeline de mallado**: KML → DEM → mesh → LOD → 3D Tiles → Cesium
2. **Multi-parcela**: el usuario sube N parcelas y el sistema las une en una finca
3. **Onboarding self-service**: sube tu KML, espera 2-10 min, ve tu finca en 3D (gratis). Paga para más.

## REQUISITO CRÍTICO: MULTI-PARCELA Y ONBOARDING SELF-SERVICE

### Unión de parcelas catastrales
Una "finca" en GeoTwin NO es una parcela catastral. Una finca puede contener N parcelas.
El usuario sube 1 o más KML/GeoJSON del catastro y el sistema:
1. Parsea cada archivo
2. Hace `unary_union` con Shapely para unir geometrías
3. Genera un AOI unificado como geometría de la finca
4. Todo el pipeline posterior (DEM, mesh, NDVI) usa ese AOI unificado

Implementar en `engine/vector/aoi.py`:
```python
from shapely.ops import unary_union
from shapely.geometry import shape

def merge_parcels(geojson_list: list[dict]) -> dict:
    """Une N parcelas catastrales en una sola geometría de finca."""
    geometries = [shape(gj["geometry"]) for gj in geojson_list]
    merged = unary_union(geometries)
    return mapping(merged)
```

### Funnel de onboarding automático (estilo Tripo3D)
El flujo de captación es:
1. El ganadero sube su KML del catastro (1 o más parcelas)
2. El sistema automáticamente:
   - Une las parcelas
   - Descarga el DEM del IGN (MDT05) para esa zona
   - Descarga la ortofoto PNOA
   - Descarga Sentinel-2 más reciente (NDVI)
   - Genera mesh + tiles + NDVI
3. En 2-10 minutos, le muestra su finca en 3D con vegetación real
4. GRATIS hasta aquí (visualización básica)
5. PAGO para: descargar, simular, IoT, campañas de dron, histórico

Este flujo debe ser un pipeline orquestado (Celery chain):
```python
pipeline = chain(
    parse_and_merge_parcels.s(uploaded_files),
    download_dem_for_aoi.s(),
    download_ortho_for_aoi.s(),
    download_sentinel_for_aoi.s(),
    generate_terrain_mesh.s(),
    generate_ndvi_layer.s(),
    build_3d_tiles.s(),
    create_twin_recipe.s(),
)
pipeline.apply_async()
```

Con barra de progreso visible en frontend (WebSocket o polling del job).

### Simulación demo como gancho comercial
DESPUÉS del onboarding gratis, ofrecer simulación "what-if":
- "¿Qué pasaría si pusieras 5 sensores IoT aquí?"
- "¿Cuánto mejoraría tu rotación de pastos con NDVI mensual?"
- "¿Cuál es tu riesgo de incendio actual?"
Resultado visual + informe → el ganadero ve el valor antes de pagar.

### Escalabilidad por tamaño de finca
El pipeline debe funcionar para cualquier tamaño, pero ajustando resolución:
- < 100 ha: DEM 2m, orto 10cm, mesh ~50K tris → procesamiento < 1 min
- 100-500 ha: DEM 5m, orto 25cm, mesh ~200K tris → procesamiento 2-5 min
- 500-2000 ha: DEM 5m, orto 25cm, mesh ~500K tris → procesamiento 5-15 min
- 2000-5000 ha: DEM 5m, orto 50cm, mesh ~1M tris → procesamiento 15-45 min
- > 5000 ha (wildfire): DEM 10m, combustible 25m, simulación celular → 1-10 min/escenario

La resolución se elige automáticamente por el tamaño del AOI.

## FASE 1: TERRAIN MESH PIPELINE (Python)

Crear un módulo Python en `engine/terrain/` que haga:

1. **Ingestión de DEM**: 
   - Leer GeoTIFF (MDT05 del IGN de España, resolución 5m)
   - Recortar por AOI (el polígono GeoJSON de la finca)
   - Reproyectar a EPSG:4326 si es necesario
   - Librerías: rasterio, pyproj, shapely

2. **Generación de malla**:
   - Convertir el grid DEM en una malla triangulada (Delaunay o marching)
   - Submuestreo adaptativo: más triángulos en pendientes fuertes, menos en zonas planas
   - Librerías: numpy, scipy, trimesh o Open3D

3. **LOD jerárquico**:
   - Generar 4 niveles de detalle por decimación cuadrática
   - L0: 100%, L1: 25%, L2: 6%, L3: 1.5%
   - Librería: Open3D (simplify_quadric_decimation)

4. **Exportación a 3D Tiles**:
   - Generar tileset.json con jerarquía espacial
   - Tiles binarios en formato b3dm o glb
   - Compresión con Draco o meshopt
   - Librería: py3dtiles o custom

5. **Servicio de tiles**:
   - Servir la carpeta de tiles como estático (nginx/S3)
   - O endpoint en la API que resuelva rutas de tiles

## FASE 2: NDVI REAL

Crear un módulo en `engine/raster/` que:

1. Descargue/lea imágenes Sentinel-2 (bandas B04=RED, B08=NIR)
2. Calcule NDVI: (B08 - B04) / (B08 + B04)
3. Recorte por AOI
4. Genere un raster overlay en formato compatible con Cesium
   (ImageryProvider desde GeoTIFF tileado o PNG tiles)
5. Reemplace la capa `ndvi_demo` en el TwinRecipe

## FASE 3: ORTOFOTO COMO TEXTURA

1. Descargar/leer ortofoto PNOA
2. Mapear como textura UV sobre la malla del terreno
3. Regenerar 3D Tiles con textura embebida
4. Servir en Cesium

## REGLAS DE CÓDIGO

- Lenguaje del engine: **Python 3.11+**
- Tipado estricto con type hints en todas las funciones
- Cada módulo tiene su `__init__.py` con interfaz pública limpia
- Tests con pytest
- Configuración con pydantic (Settings/BaseModel)
- Logs con structlog
- Jobs pesados se ejecutan como workers asíncronos (Celery con Redis)
- La API web (Fastify/FastAPI) solo encola jobs y consulta resultados
- Los artefactos generados (tiles, rasters) van a object storage (S3/MinIO)
- Las geometrías y metadatos van a PostGIS

## ESTRUCTURA OBJETIVO

```
geotwin/
├── apps/
│   ├── web/                    # Next.js + CesiumJS (existente)
│   ├── api/                    # API (existente)
│   └── worker/                 # Worker Python que ejecuta jobs del engine
│
├── engine/                     # Python
│   ├── __init__.py
│   ├── config.py               # Settings con pydantic
│   ├── terrain/
│   │   ├── __init__.py
│   │   ├── ingest.py           # Lectura y recorte de DEM
│   │   ├── mesh.py             # DEM → malla triangulada
│   │   ├── lod.py              # Generación de LODs
│   │   └── export.py           # Exportación a 3D Tiles
│   ├── raster/
│   │   ├── __init__.py
│   │   ├── ndvi.py             # Cálculo de NDVI real
│   │   ├── ortho.py            # Procesamiento de ortofotos
│   │   └── sentinel.py         # Descarga/lectura de Sentinel-2
│   ├── vector/
│   │   ├── __init__.py
│   │   └── aoi.py              # Operaciones sobre AOI
│   └── exporters/
│       ├── __init__.py
│       ├── tiles3d.py
│       └── gltf_export.py
│
├── tests/
│   ├── test_terrain.py
│   ├── test_raster.py
│   └── fixtures/               # DEMs y rasters pequeños de prueba
│
└── pyproject.toml              # Dependencias Python
```

## DEPENDENCIAS PYTHON

```toml
[project]
dependencies = [
    "rasterio>=1.3",
    "fiona>=1.9",
    "shapely>=2.0",
    "pyproj>=3.6",
    "numpy>=1.26",
    "scipy>=1.12",
    "trimesh>=4.0",
    "open3d>=0.18",
    "py3dtiles>=7.0",
    "pydantic>=2.5",
    "structlog>=24.0",
    "celery>=5.3",
    "redis>=5.0",
    "boto3>=1.34",
    "pytest>=8.0",
]
```

## SNAPSHOT ACTUAL DEL TWIN

El twin actual tiene:
- twinId: "F9rVw5EMds"
- Parcela: polígono complejo, 361.4 ha, centroide [-3.949, 40.936]
- 12 sensores IoT (TEMP, NH3, CO2, MOISTURE) — valores en 0
- 8 reses (COW-001 a COW-008) con lat/lon y peso
- Capas activas: parcel, ndvi_demo, water_demo, roi_demo, oak_trees
- Cámara: heading 315°, pitch -38°, range 4200m

## PRIMER ARCHIVO A CREAR

Empieza por `engine/vector/aoi.py`:
- Función `parse_kml(kml_path: Path) -> dict` (KML → GeoJSON)
- Función `merge_parcels(geojson_list: list[dict]) -> dict` (unión de N parcelas)
- Función `compute_aoi_metadata(aoi: dict) -> AOIMetadata` (área, centroide, bbox)
- Test en `tests/test_vector.py` con KMLs de ejemplo del catastro

Después `engine/terrain/ingest.py`:
- Función `load_dem(dem_path: Path, aoi: GeoJSON) -> xarray.DataArray`
- Función `crop_dem_by_aoi(dem: DataArray, aoi_geojson: dict) -> DataArray`
- Función `reproject_dem(dem: DataArray, target_crs: str = "EPSG:4326") -> DataArray`
- Todas con type hints, docstrings, y manejo de errores
- Test en `tests/test_terrain.py` con un DEM pequeño de fixtures
```

---

## PARTE 4: Resumen ejecutivo de correcciones

### Cambios principales respecto al informe de ChatGPT

1. **Python pasa de "apoyo" a lenguaje principal del engine** — es donde están las librerías geoespaciales maduras y donde tú produces más rápido.

2. **Se elimina la dependencia de C++ como requisito** — las librerías Python ya usan C/C++ internamente. Solo escribirías C++ si necesitas un kernel que no existe, y ahora mismo no es el caso.

3. **La arquitectura de carpetas se reduce a lo que vas a implementar realmente** — 4 módulos funcionales, no 15 carpetas vacías.

4. **Se añade el pipeline de mallado concreto con código** — esto es lo que falta en el informe original y lo que convierte a GeoTwin en un BIM territorial.

5. **Se cuantifica el problema de peso** — 500 ha con orto a 25cm son ~950 MB en 3D Tiles, manejable con streaming LOD.

6. **El roadmap se reduce a 4 sprints ejecutables** en vez de una lista de deseos mezclada con arquitectura a largo plazo.

7. **Se mantiene la visión estratégica** (doble runtime, instancing, OpenUSD futuro, simulación de incendios como módulo posterior) pero se aterriza en pasos que puedes dar esta semana.