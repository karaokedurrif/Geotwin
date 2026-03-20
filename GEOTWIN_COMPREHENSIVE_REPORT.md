# GeoTwin — Comprehensive Technical Report

> **Generated**: 2025 · **Scope**: Full codebase exploration (research-only)  
> **Repository**: `/home/davidia/Documentos/Geotwin`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Full Tech Stack & Versions](#2-full-tech-stack--versions)
3. [Architecture Overview](#3-architecture-overview)
4. [Monorepo Structure & File Tree](#4-monorepo-structure--file-tree)
5. [API Endpoints (Fastify)](#5-api-endpoints-fastify)
6. [TypeScript Types & Interfaces](#6-typescript-types--interfaces)
7. [Layer System Architecture](#7-layer-system-architecture)
8. [CesiumJS Configuration & Usage](#8-cesiumjs-configuration--usage)
9. [Data Flow](#9-data-flow)
10. [Features: Current vs Planned](#10-features-current-vs-planned)
11. [Dependencies (All Packages)](#11-dependencies-all-packages)
12. [Key Code Patterns](#12-key-code-patterns)
13. [Integration Points & External Services](#13-integration-points--external-services)
14. [Illustration Service (Python)](#14-illustration-service-python)
15. [Configuration Files](#15-configuration-files)
16. [Studio Mode](#16-studio-mode)
17. [CLI Tool](#17-cli-tool)
18. [Terrain Pipeline](#18-terrain-pipeline)
19. [Known TODOs & Stubs](#19-known-todos--stubs)

---

## 1. Executive Summary

**GeoTwin** is a TypeScript monorepo that provides a **3D GIS / Digital Twin platform** for agricultural parcels in Spain. It ingests cadastral geometry files (KML, GML, GeoJSON), processes them server-side via a Fastify API, and renders interactive 3D scenes in the browser using **CesiumJS**. The platform supports terrain elevation from Spain's MDT02 dataset (2 m resolution), satellite imagery from PNOA (Plan Nacional de Ortofotografía Aérea), NDVI vegetation indices from Copernicus/Sentinel-2, and an optional Python-based illustration service that produces 3D isometric renders with orthophoto texture mapping.

The project is organized as a **pnpm workspace monorepo** with five packages:

| Package | Purpose | Runtime |
|---------|---------|---------|
| `apps/web` | Next.js 14 frontend with CesiumJS viewer | Browser |
| `apps/api` | Fastify 4 backend API | Node.js |
| `apps/illustration-service` | Python FastAPI illustration renderer | Python |
| `packages/types` | Shared TypeScript type definitions | Compile-time |
| `packages/cli` | Interactive CLI tool (`geotwin`) | Node.js |

---

## 2. Full Tech Stack & Versions

### Frontend (`apps/web`)

| Library | Version | Purpose |
|---------|---------|---------|
| Next.js | `^14.1.0` (actual `14.2.35`) | React framework with SSR, routing, API routes |
| React | `^18.2.0` | UI rendering |
| CesiumJS | `^1.113.0` | 3D globe, terrain, imagery, entity rendering |
| Resium | `^1.17.1` | React bindings for CesiumJS (available but primary use is imperative) |
| Tailwind CSS | `^3.4.1` | Utility-first CSS |
| proj4 | `^2.20.2` | Coordinate reprojection (UTM → WGS84) |
| TypeScript | `^5.3.3` | Static typing |

### Backend (`apps/api`)

| Library | Version | Purpose |
|---------|---------|---------|
| Fastify | `^4.26.0` | HTTP server with plugin architecture |
| @fastify/multipart | `^8.1.0` | File upload handling |
| @fastify/cors | `^8.5.0` | Cross-origin requests |
| @turf/area | `^6.5.0` | Polygon area calculation |
| @turf/bbox | `^6.5.0` | Bounding box computation |
| @turf/centroid | `^6.5.0` | Centroid calculation |
| @turf/boolean-point-in-polygon | `^6.5.0` | Point-in-polygon testing |
| @turf/buffer | `^6.5.0` | Buffered geometry |
| @turf/square-grid | `^6.5.0` | Grid generation for NDVI sampling |
| @turf/helpers | `^6.5.0` | GeoJSON helper constructors |
| fast-xml-parser | `^4.3.4` | KML/GML XML parsing |
| JSZip | `^3.10.1` | ZIP file extraction |
| nanoid | `^3.3.7` | Unique ID generation |
| axios | `^1.13.5` | HTTP client (Copernicus API) |
| dotenv | `^17.3.1` | Environment variables |
| TypeScript | `^5.3.3` | Static typing |

### CLI (`packages/cli`)

| Library | Version | Purpose |
|---------|---------|---------|
| Commander | `^11.1.0` | CLI framework |
| chalk | `^5.3.0` | Terminal colors |
| inquirer | `^9.2.12` | Interactive prompts |
| ora | `^8.0.1` | Spinner indicators |
| node-fetch | `^3.3.2` | HTTP client |

### Illustration Service (`apps/illustration-service`)

| Library | Version | Purpose |
|---------|---------|---------|
| FastAPI | `0.115.0` | Python ASGI web framework |
| uvicorn | `0.30.0` | ASGI server |
| Pillow | `10.4.0` | Image processing (PIL) |
| numpy | `1.26.4` | Numerical computation (terrain mesh) |
| httpx | `0.27.0` | Async HTTP client |
| replicate | `0.32.0` | AI image generation (Flux models) |

### Build & Tooling

| Tool | Version | Purpose |
|------|---------|---------|
| pnpm | `>=8.0.0` | Monorepo package manager |
| Node.js | `>=18.0.0` | Runtime requirement |
| turbo (implied) | — | Monorepo build orchestration |
| Docker | — | Terrain builder (cesium-terrain-builder) |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Next.js)                        │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────┐│
│  │ ControlPanel │  │ CesiumViewer   │  │ Studio Mode          ││
│  │              │  │ (2512 lines)   │  │ [twinId].tsx         ││
│  │ - Upload KML │  │ - 3D Globe     │  │ - StudioViewer       ││
│  │ - Presets    │  │ - Terrain      │  │ - SimulatorMode      ││
│  │ - Layers     │  │ - NDVI overlay │  │ - IllustrationModal  ││
│  │ - Controls   │  │ - IoT sensors  │  │ - Visual Style       ││
│  └──────────────┘  │ - Cattle GPS   │  └──────────────────────┘│
│                    └────────────────┘                           │
│  ┌──────────────────────────────────────────────────────────────┤
│  │ Libs: twinStore, exportUtils, reprojectKml, terrainAnalysis ││
│  │       cesiumUtils, withTimeout, api.ts, hq_capture.ts       ││
│  └──────────────────────────────────────────────────────────────┤
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP (port 3000 ↔ 3001)
┌───────────────────────────▼─────────────────────────────────────┐
│                   Fastify API (port 3001)                       │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────────────┐  │
│  │ /api/import│  │ /api/ndvi  │  │ /api/geospatial          │  │
│  │ POST upload│  │ POST fetch │  │ POST /roi, GET /terrain  │  │
│  │ GET twin   │  │ GET cached │  │ GET /imagery/pnoa        │  │
│  │ GET sample │  └──────┬─────┘  │ GET /lidar/tiles (stub)  │  │
│  └─────┬──────┘         │        └───────────┬───────────────┘  │
│        │                │                    │                  │
│  ┌─────▼──────┐  ┌──────▼─────┐  ┌──────────▼───────────────┐  │
│  │ Parsers    │  │ Copernicus │  │ Services                 │  │
│  │ KML / GML  │  │ OAuth2 →   │  │ ROI, Terrain (CNIG),     │  │
│  │ ZIP        │  │ Sentinel-2 │  │ Imagery (PNOA), LiDAR    │  │
│  └────────────┘  └────────────┘  └───────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┤
│  │ recipe-generator.ts → demo-generator.ts → storage.ts       ││
│  └──────────────────────────────────────────────────────────────┤
└─────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│             Illustration Service (port 8001)                    │
│  ┌──────────────────┐  ┌───────────────────────────────────┐   │
│  │ /generate-       │  │ illustration_renderer.py          │   │
│  │  illustration    │  │ - Downloads PNOA ortho (WMS)      │   │
│  │                  │  │ - Downloads MDT elevation (WCS)   │   │
│  │ /generate-ai-    │  │ - 3D isometric render (painter's) │   │
│  │  illustration    │  │ - Gold cadastral boundary overlay │   │
│  └──────────────────┘  └───────────────────────────────────┘   │
│                        ┌───────────────────────────────────┐   │
│                        │ image_generator.py (Replicate API)│   │
│                        │ Flux Schnell / Dev models         │   │
│                        └───────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Rendering Pipeline

1. **Non-blocking Init**: Viewer created with OSM imagery + EllipsoidTerrain immediately
2. **Async Upgrade**: Imagery (Bing Maps → PNOA WMS) and Terrain (MDT02 / World Terrain) upgraded in background
3. **Geometry Loading**: KML auto-reprojected from UTM (EPSG:25828-25831) → WGS84, styled with terrain-clamped polygons
4. **Camera Positioning**: Terrain-sampled isometric fly-to (315° heading, -38° pitch)
5. **Overlay Layers**: NDVI, demo sensors, cattle GPS markers added on demand

---

## 4. Monorepo Structure & File Tree

```
geotwin/
├── pnpm-workspace.yaml          # Workspace: apps/*, packages/*
├── package.json                 # Root: scripts, turbo, shared devDeps
├── tsconfig.json                # Base: ES2020, strict, paths
├── .env.local                   # Cesium Ion token, MDT02 asset
│
├── apps/
│   ├── web/                     # Next.js 14 frontend (port 3000)
│   │   ├── package.json
│   │   ├── next.config.mjs      # CesiumJS webpack config
│   │   ├── tailwind.config.ts
│   │   ├── public/
│   │   │   ├── sample-data/     # Sample KML files
│   │   │   └── Cesium/          # CesiumJS static assets
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── index.tsx    # Main page (state management)
│   │       │   ├── demo.tsx     # Auto-play demo page
│   │       │   └── studio/
│   │       │       └── [twinId].tsx  # Twin Studio editor
│   │       ├── components/
│   │       │   ├── CesiumViewer.tsx   # THE viewer (2512 lines)
│   │       │   ├── ControlPanel.tsx   # Left sidebar controls
│   │       │   ├── StatusHUD.tsx      # Floating status badges
│   │       │   ├── ParcelBadge.tsx    # Parcel info card
│   │       │   └── studio/
│   │       │       ├── StudioViewer.tsx
│   │       │       ├── StudioTopBar.tsx
│   │       │       ├── StudioRightPanel.tsx
│   │       │       ├── StudioBottomBar.tsx
│   │       │       ├── SimulatorMode.tsx
│   │       │       └── IllustrationModal.tsx
│   │       ├── lib/
│   │       │   ├── api.ts             # API client functions
│   │       │   ├── exportUtils.ts     # GeoJSON/metadata export
│   │       │   ├── twinStore.ts       # localStorage persistence
│   │       │   ├── geo/
│   │       │   │   ├── reprojectKml.ts  # UTM → WGS84 reprojection
│   │       │   │   └── reproject.ts
│   │       │   └── terrainAnalysis.ts   # Elevation grid sampling
│   │       ├── utils/
│   │       │   ├── cesiumUtils.ts     # Viewer readiness helpers
│   │       │   └── withTimeout.ts     # Timeout & retry wrappers
│   │       ├── services/
│   │       │   └── hq_capture.ts      # HQ canvas screenshot
│   │       └── styles/
│   │           └── studio.module.css
│   │
│   ├── api/                     # Fastify backend (port 3001)
│   │   ├── package.json
│   │   └── src/
│   │       ├── server.ts        # Entry point, plugin registration
│   │       ├── routes/
│   │       │   ├── import.ts    # File upload & twin retrieval
│   │       │   ├── ndvi.ts      # NDVI from Copernicus
│   │       │   └── geospatial.ts# ROI, terrain, imagery, LiDAR
│   │       ├── parsers/
│   │       │   ├── index.ts     # Parser router (by extension)
│   │       │   ├── kml.ts       # KML parser (recursive coords)
│   │       │   ├── gml.ts       # GML parser (posList/pos)
│   │       │   └── zip.ts       # ZIP extractor (KML/GML inside)
│   │       ├── services/
│   │       │   ├── recipe-generator.ts  # TwinRecipe builder
│   │       │   ├── demo-generator.ts    # Pseudo-NDVI, trees, water
│   │       │   ├── storage.ts           # Filesystem persistence
│   │       │   ├── copernicus.ts        # Sentinel-2 NDVI client
│   │       │   ├── roi-service.ts       # ROI management
│   │       │   ├── terrain-service.ts   # CNIG MDT integration
│   │       │   ├── imagery-service.ts   # PNOA WMTS/WMS
│   │       │   └── lidar-service.ts     # LiDAR stub (TODO)
│   │       └── config/
│   │           └── presets.ts   # 3 visual presets
│   │
│   └── illustration-service/   # Python FastAPI (port 8001)
│       ├── main.py
│       ├── requirements.txt
│       ├── routes/
│       │   └── generate.py
│       └── services/
│           ├── illustration_renderer.py  # 3D isometric renderer
│           ├── ortophoto_fetcher.py      # PNOA WMS downloader
│           ├── ndvi_analyzer.py          # Vegetation inference
│           ├── terrain_analyzer.py       # Shape analysis
│           ├── prompt_builder.py         # AI prompt construction
│           └── image_generator.py        # Replicate/Flux client
│
├── packages/
│   ├── types/                   # Shared TypeScript types
│   │   ├── package.json
│   │   └── src/
│   │       └── index.ts         # All type/interface exports
│   └── cli/                     # geotwin CLI tool
│       ├── package.json
│       └── src/
│           ├── index.ts         # Commander setup
│           └── commands/
│               ├── init.ts      # Interactive .env setup
│               ├── import.ts    # Upload KML to API
│               └── dev.ts       # Start dev servers
│
├── tools/
│   └── terrain/
│       └── build-terrain.ts     # Docker cesium-terrain-builder
│
└── data/                        # Runtime data (twins, MDT rasters)
    ├── mdt/                     # CNIG MDT02 GeoTIFF files
    └── <twinId>/                # Per-twin scene.json + geometry
```

---

## 5. API Endpoints (Fastify)

All routes are prefixed with `/api`. Server runs on port **3001** with a 50 MB body limit.

### Import Routes (`/api/import`)

| Method | Path | Description | Parameters |
|--------|------|-------------|------------|
| `POST` | `/api/import` | Upload cadastral file (KML/GML/GeoJSON/ZIP) | `?preset=mountain\|dehesa\|mediterranean`, multipart file |
| `GET` | `/api/twin/:twinId` | Retrieve twin scene JSON | Path: `twinId` |
| `GET` | `/api/twin/:twinId/geometry` | Retrieve geometry GeoJSON | Path: `twinId` |
| `GET` | `/api/sample` | Load sample KML | `?preset=` |

**POST /api/import flow**:
1. Validate preset parameter
2. Extract file from multipart upload
3. Route to parser by extension (KML → `parseKML`, GML → `parseGML`, ZIP → `parseZIP`)
4. Generate `TwinRecipe` with nanoid, Turf.js area/bbox/centroid
5. Generate demo data (NDVI grid, water points, oak trees, ROI labels)
6. Save `scene.json` + `geometry.geojson` to `data/<twinId>/`
7. Return `ImportResponse` with twinId, recipe, and demo data

### NDVI Routes (`/api/ndvi`)

| Method | Path | Description | Parameters |
|--------|------|-------------|------------|
| `POST` | `/api/ndvi` | Fetch NDVI from Copernicus | Body: `{ bbox, dateFrom?, dateTo? }` |
| `GET` | `/api/twin/:id/ndvi` | Cached NDVI per twin | `?refresh=true` to force re-fetch |

**NDVI pipeline**: OAuth2 → Copernicus Dataspace API → Sentinel-2 L2A Process API → evalscript computing `(B08 - B04) / (B08 + B04)` → 512×512 PNG with color ramp.

### Geospatial Routes (`/api/geospatial`)

| Method | Path | Description | Parameters |
|--------|------|-------------|------------|
| `POST` | `/api/roi` | Create ROI from geometry | Body: GeoJSON + optional buffer |
| `GET` | `/api/roi/:id` | Get single ROI | Path: `id` |
| `GET` | `/api/roi` | List all ROIs | — |
| `GET` | `/api/terrain` | Get terrain data | `?roi=<id>&source=cnig\|cesium` |
| `GET` | `/api/imagery/pnoa` | Get PNOA imagery config | `?roi=<id>&preferWMS=true` |
| `GET` | `/api/lidar/tiles` | LiDAR 3D tiles | `?roi=<id>` ⚠️ **stub** |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | API health check |

---

## 6. TypeScript Types & Interfaces

All shared types are defined in `packages/types/src/index.ts`:

### Core Enums (String Unions)

```typescript
type StylePreset = 'mountain' | 'dehesa' | 'mediterranean';

type LayerType = 
  | 'parcel' 
  | 'extrusion' 
  | 'ndvi_demo' 
  | 'water_demo' 
  | 'roi_demo' 
  | 'plinth' 
  | 'oak_trees';
```

### Geometry & Spatial

```typescript
type BBox = [west: number, south: number, east: number, north: number];
type Point = [longitude: number, latitude: number];

interface GeoJSONGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}
```

### Camera & Visual

```typescript
interface CameraConfig {
  longitude: number;
  latitude: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
}

interface ColorConfig {
  r: number; g: number; b: number; a: number;
}

interface MaterialConfig {
  type: 'color' | 'stripe' | 'grid' | 'checkerboard';
  color: ColorConfig;
  secondaryColor?: ColorConfig;
  repeat?: number;
}

interface HeatmapConfig {
  enabled: boolean;
  property: string;
  colorRamp: string[];
  min: number;
  max: number;
}

interface POIConfig {
  name: string;
  position: Point;
  icon?: string;
  description?: string;
}
```

### Layer Configuration

```typescript
interface LayerConfig {
  id: LayerType;
  name: string;
  enabled: boolean;
  visible: boolean;
  material?: MaterialConfig;
  extrusionHeight?: number;
  heatmap?: HeatmapConfig;
  points?: POIConfig[];
  zIndex?: number;
}
```

### Preset Configuration

```typescript
interface PresetConfig {
  name: StylePreset;
  displayName: string;
  description: string;
  terrain: {
    verticalExaggeration: number;
    lightingIntensity: number;
  };
  atmosphere: {
    brightness: number;
    saturation: number;
    hueShift: number;
    hazeIntensity?: number;
  };
  groundTint: ColorConfig;
  skyboxColor?: ColorConfig;
  plinthColor?: ColorConfig;
  markers?: { icon: string; scale: number };
  ndviIntensity?: number;
  waterPointsScale?: number;
  labelStyle?: { font: string; color: ColorConfig };
}
```

### TwinRecipe (Central Data Model)

```typescript
interface TwinRecipe {
  twinId: string;
  preset: StylePreset;
  createdAt: string;
  centroid: Point;
  bbox: BBox;
  area_ha: number;
  camera: CameraConfig;
  presetConfig: PresetConfig;
  layers: LayerConfig[];
  geometryPath: string;

  // Phase 2 extensions (optional)
  sensors?: Array<{
    id: string;
    type: string;
    position: Point;
    value: number;
    unit: string;
    status: 'ok' | 'warning' | 'error';
  }>;
  cattle?: Array<{
    id: string;
    position: Point;
    weight: number;
    collarId: string;
    health: 'good' | 'warning' | 'sick';
  }>;
  infrastructure?: Array<{
    id: string;
    type: string;
    geometry: GeoJSONGeometry;
    properties: Record<string, unknown>;
  }>;
  esg?: {
    carbonSequestration: number;
    waterEfficiency: number;
    biodiversityIndex: number;
  };
}
```

### API Request/Response

```typescript
interface ImportRequest {
  file: Buffer;
  filename: string;
  preset: StylePreset;
}

interface ImportResponse {
  twinId: string;
  recipe: TwinRecipe;
  demoData: DemoData;
}

interface NDVICell {
  lon: number;
  lat: number;
  value: number;        // -1.0 to 1.0
  color: string;        // hex color
}

interface DemoData {
  ndviCells: NDVICell[];
  waterPoints: Point[];
  roiLabels: Array<{ name: string; position: Point; value: string }>;
  oakTrees?: Point[];
}
```

### Frontend-Only Types (in `twinStore.ts`)

```typescript
interface TwinSnapshot {
  version: number;
  twinId: string;
  savedAt: string;
  parcel: {
    positions: Array<{ lon: number; lat: number; height: number }>;
    centroid: [number, number];
    areaHa: number;
    boundingRadius: number;
  };
  sensors: Array<{ ... }>;
  cattle: Array<{ ... }>;
  infrastructure: Array<{ ... }>;
  layers: Record<string, boolean>;
  camera: CameraConfig;
  visualStyle?: VisualStyle;
}

interface VisualStyle {
  preset: string;
  fillColor: string;
  fillOpacity: number;
  boundaryColor: string;
  boundaryWidth: number;
  terrainExaggeration: number;
  enableLighting: boolean;
  timeOfDay: string;
  atmosphereDensity: number;
}
```

---

## 7. Layer System Architecture

### Layer Types

The system defines **7 layer types**, each rendered differently:

| Layer ID | Type | Rendering | Default |
|----------|------|-----------|---------|
| `parcel` | Vector | Terrain-clamped polygon (cyan α=0.09) + gold polyline boundary (α=0.85) | Enabled |
| `extrusion` | 3D | Extruded polygon (8m height for GML buildings) | Enabled |
| `ndvi_demo` | Heatmap | Colored grid cells from Turf.js squareGrid, clamped to ground | Enabled |
| `water_demo` | Points | Blue markers at random positions within parcel | Enabled |
| `roi_demo` | Labels | Text labels (Payback/NPV/IRR) at positions near parcel | Enabled |
| `oak_trees` | Points | Green dots via Poisson-disc sampling (80-250 trees, dehesa only) | Enabled |
| `plinth` | 3D | Terrain-negative extrusion below parcel (uses `sampleTerrainMostDetailed`) | Disabled |

### Layer Toggle Flow

1. `ControlPanel.tsx` manages `enabledLayers: Set<LayerType>`
2. Changes propagate to `CesiumViewer.tsx` via props
3. `useEffect` watches `enabledLayers` and toggles `dataSource.show` per layer
4. Real NDVI overlay replaces `ndvi_demo` layer when enabled (removes demo, adds `SingleTileImageryProvider` at α=0.6)

### Demo Data Generation (Server-Side)

In `demo-generator.ts`:
- **NDVI Grid**: `@turf/square-grid` creates cells over parcel bbox → `booleanPointInPolygon` filters to parcel interior → max 50 cells → random NDVI values with color ramp
- **Water Points**: 2-4 random positions within bounding box
- **ROI Labels**: Fixed labels: "Payback", "NPV", "IRR" with mock values
- **Oak Trees** (dehesa only): Poisson-disc sampling within parcel, 80-250 trees, minimum 20m spacing

---

## 8. CesiumJS Configuration & Usage

### Viewer Initialization (`CesiumViewer.tsx`)

The viewer is the **heart of the application** at 2512 lines. Key configuration:

```typescript
// Viewer creation (non-blocking)
new Cesium.Viewer(container, {
  baseLayer: Cesium.ImageryLayer.fromProviderAsync(
    Cesium.TileMapServiceImageryProvider.fromUrl(
      Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
    )
  ),
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),  // placeholder
  timeline: false,
  animation: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  selectionIndicator: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: false,
  requestRenderMode: true,
  maximumRenderTimeChange: Infinity,
  maximumScreenSpaceError: 1.0,
  msaaSamples: 4,
});
```

### Visual Enhancements

| Feature | Configuration |
|---------|--------------|
| Frozen time | `2026-06-15T09:30:00Z` (morning light, sun at ~45°) |
| Screen space error | `1.0` (maximum detail loading) |
| Anti-aliasing | FXAA enabled, MSAA 4× |
| Atmosphere | Sky atmosphere enabled, fog optional per preset |
| Globe | `depthTestAgainstTerrain: true`, `enableLighting: true` |
| Shadows | Soft shadows enabled |

### Camera System (Helicopter-Style)

Custom `ScreenSpaceEventHandler` overrides default CesiumJS camera controls:

| Input | Action | Details |
|-------|--------|---------|
| Left drag | Rotate orbit | Rotates heading + pitch around look point |
| Right drag | Tilt | Adjusts pitch only |
| Middle drag | Look | Free-look (heading + pitch) |
| Scroll wheel | Zoom | Zooms toward/away from surface |
| Range limits | 50m – 80,000m | Clamped camera height |

### Terrain Sources

| Source | ID / URL | Resolution | Exaggeration |
|--------|----------|------------|-------------|
| Cesium World Terrain | Ion default | ~30m global | 1.0-1.4× |
| MDT02 (CNIG Spain) | Ion Asset `4475569` | 2m Spain | 1.1-1.4× |
| Ellipsoid (fallback) | Built-in | Flat | 1.0× |

**Fallback chain**: MDT02 → World Terrain → Ellipsoid (multi-level, with 12s timeout per level)

### Imagery Sources

| Source | URL | Type | Priority |
|--------|-----|------|----------|
| Bing Maps | Ion Asset `2` | Aerial | Primary (via Cesium Ion) |
| PNOA | `www.ign.es/wmts/pnoa-ma` | WMS 1.1.1 | Always-on second layer |
| Natural Earth II | Built-in tiles | Satellite | Initial load placeholder |
| OSM | OpenStreetMap | Street map | Ultimate fallback |

### Preset Configurations (3 Presets)

| Preset | Exaggeration | Lighting | Atmosphere | Ground Tint | Special |
|--------|-------------|----------|-----------|-------------|---------|
| **Mountain** | 2.0× | 1.8 | Bright, saturated, cool hue | Cool blue-gray | — |
| **Dehesa** | 1.0× | 1.2 | Warm, moderate | Warm pasture | 120 oak trees |
| **Mediterranean** | 1.2× | 1.5 | Bright, sunny, dusty haze | Dusty earth | Haze effect |

### Isometric Camera (`flyToIsometric`)

```
Heading:  315° (SE → NW view)
Pitch:    -38° (slightly above 45° for terrain relief)
Range:    max(radius × 2.0 × marginFactor, 400m)
Duration: 2.8s with sinusoidal easing
```

Samples terrain height at parcel centroid using `sampleTerrainMostDetailed` for accurate ground-relative positioning.

### Offline Detection

```typescript
// Tracks tile load errors
// If 5+ errors in 30 seconds → offline mode
// Uses navigator.onLine + tile error counting
```

---

## 9. Data Flow

### A. Import Flow

```
User uploads KML/GML/ZIP
        ↓
ControlPanel → api.ts:uploadCadastralFile()
        ↓ POST /api/import?preset=dehesa
Fastify receives multipart file
        ↓
parsers/index.ts routes by extension
        ↓
kml.ts / gml.ts / zip.ts → ParsedGeometry { coordinates, properties, sourceEPSG }
        ↓
recipe-generator.ts:
  - nanoid() → twinId
  - turf/area → area_ha
  - turf/bbox → bbox
  - turf/centroid → centroid
  - Lookup preset config
  - Build 7 LayerConfig objects
  - Build CameraConfig
        ↓
demo-generator.ts:
  - squareGrid + pointInPolygon → NDVI cells
  - Random water points
  - ROI labels
  - Poisson-disc oak trees (if dehesa)
        ↓
storage.ts:
  - Write data/<twinId>/scene.json
  - Write data/<twinId>/geometry.geojson
        ↓
Response: { twinId, recipe: TwinRecipe, demoData: DemoData }
        ↓
Frontend receives recipe → CesiumViewer loads geometry URL
        ↓
CesiumViewer:
  1. Fetches geometry from /api/twin/:id/geometry
  2. Auto-detects UTM → reprojects with proj4
  3. Loads via Cesium.KmlDataSource / GeoJsonDataSource
  4. Styles entities (cyan fill + gold boundary)
  5. Computes bounding sphere
  6. Generates demo IoT sensors + cattle markers
  7. Waits for scene tiles → flyToIsometric()
```

### B. NDVI Flow

```
User enables "Real NDVI" toggle
        ↓
CesiumViewer → POST /api/ndvi { bbox, dateFrom, dateTo }
        ↓
copernicus.ts:
  - OAuth2 token (cached 3600s)
  - POST to Copernicus Process API
  - Evalscript: (B08-B04)/(B08+B04)
  - 512×512 PNG output, ≤30% cloud
        ↓
Returns PNG buffer
        ↓
CesiumViewer:
  - Creates blob URL from PNG
  - SingleTileImageryProvider with parcel bbox
  - Alpha = 0.6, overlaid on terrain
  - Hides demo NDVI layer
```

### C. Twin Persistence Flow

```
CesiumViewer.saveTwinSnapshot()
  - Extracts: parcel positions, sensors, cattle, camera state, layer visibility
  - Builds TwinSnapshot object
        ↓
twinStore.save(twinId, snapshot)
  - Serializes to JSON
  - Stores in localStorage with key `geotwin_twin_<twinId>`
  - Maintains index in `geotwin_twin_index`
        ↓
Studio page /studio/[twinId]
  - twinStore.get(twinId) → loads snapshot
  - StudioViewer renders with saved state
  - Supports JSON import/export via drag-and-drop
```

---

## 10. Features: Current vs Planned

### ✅ Implemented (Phase 1)

| Feature | Status | Notes |
|---------|--------|-------|
| KML/GML/GeoJSON import | ✅ Complete | With ZIP support |
| UTM → WGS84 auto-reprojection | ✅ Complete | EPSG:25828-25831, auto zone detection |
| 3 visual presets | ✅ Complete | Mountain, Dehesa, Mediterranean |
| CesiumJS 3D viewer | ✅ Complete | 2512-line component |
| MDT02 terrain (2m) | ✅ Complete | Via Cesium Ion asset 4475569 |
| PNOA imagery (orthophoto) | ✅ Complete | WMS + WMTS from IGN España |
| Copernicus NDVI | ✅ Complete | Sentinel-2 L2A, OAuth2 |
| Demo NDVI grid | ✅ Complete | Turf.js squareGrid |
| Demo sensors (12 IoT nodes) | ✅ Complete | Hidden by default (Phase 2 toggle) |
| Demo cattle GPS (8 cows) | ✅ Complete | With grazing animation |
| Helicopter camera controls | ✅ Complete | Custom drag handlers |
| Isometric fly-to | ✅ Complete | Terrain-aware, 315° heading |
| GeoJSON export | ✅ Complete | With metadata (area, centroid, ENU matrix) |
| Twin localStorage persistence | ✅ Complete | Save/load/list/delete snapshots |
| Studio mode | ✅ Complete | Visual style editing, twin viewer |
| Illustration service | ✅ Complete | 3D isometric ortho-textured render |
| AI illustration (Flux) | ✅ Complete | Replicate img2img + text2img |
| CLI tool | ✅ Complete | init, import, dev commands |
| Terrain analysis | ✅ Complete | Slope/aspect grid sampling |
| HQ canvas capture | ✅ Complete | Multi-angle screenshot |
| Parcel plinth | ✅ Complete | Terrain-negative extrusion |
| Multi-level terrain fallback | ✅ Complete | MDT02 → World → Ellipsoid |
| Offline detection | ✅ Complete | Tile error counting |
| Session safety | ✅ Complete | Prevents ops on destroyed viewer |

### 🔲 Planned / Stubbed (Phase 2+)

| Feature | Status | Notes |
|---------|--------|-------|
| LiDAR 3D tiles | 🔲 Stub | `lidar-service.ts` returns "not ready" |
| CNIG terrain clipping (gdalwarp) | 🔲 Partial | Code exists, needs GDAL binary |
| Quantized-mesh from MDT02 | 🔲 TODO | Docker build-terrain.ts exists |
| IoT sensor toggle UI | 🔲 Prepared | Entities exist but hidden (`show: false`) |
| Cattle GPS toggle UI | 🔲 Prepared | Entities with animation, hidden |
| ESG metrics | 🔲 Type only | `esg?` field in TwinRecipe |
| Infrastructure layer | 🔲 Type only | `infrastructure?` in TwinRecipe |
| BIM mode (Studio) | 🔲 Placeholder | Tab exists in Studio sidebar |
| Simulator mode | 🔲 Component | `SimulatorMode.tsx` exists |
| Real-time sensor data | 🔲 — | Currently uses random demo values |

---

## 11. Dependencies (All Packages)

### Root `package.json`

```json
{
  "devDependencies": {
    "@types/node": "^20.11.5",
    "turbo": "^1.11.3",
    "typescript": "^5.3.3"
  }
}
```

### `apps/web` — Dependencies

| Package | Version | Category |
|---------|---------|----------|
| next | ^14.1.0 | Framework |
| react / react-dom | ^18.2.0 | UI |
| cesium | ^1.113.0 | 3D Globe |
| resium | ^1.17.1 | CesiumJS React |
| proj4 | ^2.20.2 | Reprojection |
| tailwindcss | ^3.4.1 | Styling |
| postcss | ^8.4.33 | CSS processing |
| autoprefixer | ^10.4.17 | CSS vendor prefixes |
| @geotwin/types | workspace:* | Shared types |

### `apps/api` — Dependencies

| Package | Version | Category |
|---------|---------|----------|
| fastify | ^4.26.0 | HTTP Server |
| @fastify/multipart | ^8.1.0 | File upload |
| @fastify/cors | ^8.5.0 | CORS |
| @turf/* (7 packages) | ^6.5.0 | Geospatial |
| fast-xml-parser | ^4.3.4 | XML/KML/GML |
| jszip | ^3.10.1 | ZIP handling |
| nanoid | ^3.3.7 | ID generation |
| axios | ^1.13.5 | HTTP client |
| dotenv | ^17.3.1 | Config |
| @geotwin/types | workspace:* | Shared types |

### `packages/cli` — Dependencies

| Package | Version | Category |
|---------|---------|----------|
| commander | ^11.1.0 | CLI framework |
| chalk | ^5.3.0 | Colors |
| inquirer | ^9.2.12 | Prompts |
| ora | ^8.0.1 | Spinners |
| node-fetch | ^3.3.2 | HTTP |
| @geotwin/types | workspace:* | Shared types |

### `apps/illustration-service` — Python Dependencies

```
fastapi==0.115.0
uvicorn==0.30.0
httpx==0.27.0
Pillow==10.4.0
numpy==1.26.4
replicate==0.32.0
python-dotenv
```

---

## 12. Key Code Patterns

### 1. Non-Blocking Initialization

The CesiumViewer uses a "show something immediately, upgrade later" pattern:

```typescript
// Phase 1: Instant render with basic layers
const viewer = new Cesium.Viewer(container, {
  baseLayer: naturalEarthLayer,           // built-in tiles
  terrainProvider: ellipsoidProvider,      // flat earth
});

// Phase 2: Async upgrade (doesn't block UI)
upgradeImagery(viewer);   // Bing Maps → PNOA
upgradeTerrain(viewer);   // MDT02 / World Terrain
loadGeometry(...);        // Parcel from API
```

### 2. Session Tracking (Viewer Lifecycle Safety)

```typescript
const sessionRef = useRef(0);
const currentSessionRef = useRef(0);

// On mount: create new session
sessionRef.current += 1;
currentSessionRef.current = sessionRef.current;

// Before any async operation:
if (currentSessionRef.current !== session) {
  logMessage('Session invalidated', 'warn');
  return;  // Stop — viewer was destroyed and recreated
}
```

### 3. Multi-Level Fallback with Timeouts

```typescript
// Terrain: MDT02 → World → Ellipsoid
try {
  provider = await withTimeout(loadMDT02(), 12000);
} catch {
  try {
    provider = await withTimeout(loadWorldTerrain(), 12000);
  } catch {
    provider = new EllipsoidTerrainProvider();  // always works
  }
}
```

### 4. Copernicus OAuth2 Token Caching

```typescript
let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const response = await axios.post(TOKEN_URL, params);
  cachedToken = response.data.access_token;
  tokenExpiry = Date.now() + 3600 * 1000;
  return cachedToken;
}
```

### 5. UTM Auto-Detection & Reprojection

```typescript
// In reprojectKml.ts
function analyzeCoordinates(coords: number[][]): UTMZone | null {
  // Heuristic: if X > 100000 and Y > 4000000 → likely UTM
  // Zone detection: X prefix 1-6 → zones 28-31
  // Uses proj4 definitions for EPSG:25828-25831
}

function reprojectKmlString(kml: string): { kml: string; zone?: number; message: string } {
  // Parse coordinates → detect UTM → reproject each coord pair → rebuild KML
}
```

### 6. Turf.js Geospatial Processing

```typescript
// demo-generator.ts
const grid = squareGrid(bbox, cellSize, { units: 'meters' });
const interior = grid.features.filter(cell =>
  booleanPointInPolygon(centroid(cell), parcelPolygon)
);
// Assign NDVI values with spatial coherence
```

### 7. Painter's Algorithm 3D Rendering (Python)

```python
# illustration_renderer.py
# Sort terrain quads by depth (back-to-front)
quads.sort(key=lambda q: q.depth, reverse=True)
for quad in quads:
    # Project 3D → 2D isometric
    # Texture map from orthophoto
    # Apply normal-based lighting
    draw.polygon(projected_points, fill=lit_color)
```

### 8. ROI with Stable MD5 IDs

```typescript
// roi-service.ts
const hash = crypto.createHash('md5')
  .update(JSON.stringify(geometry.coordinates))
  .digest('hex')
  .substring(0, 12);
const roiId = `roi_${hash}`;
```

---

## 13. Integration Points & External Services

### Cesium Ion

| Resource | Asset ID | Usage |
|----------|----------|-------|
| Bing Maps Aerial | `2` | Primary imagery layer |
| Cesium World Terrain | default | Global terrain fallback |
| MDT02 Spain | `4475569` | 2m resolution terrain (custom upload) |
| Ion Token | in `.env.local` | Required for all Ion services |

### IGN España (Instituto Geográfico Nacional)

| Service | URL | Protocol |
|---------|-----|----------|
| PNOA Orthophoto | `www.ign.es/wmts/pnoa-ma` | WMTS / WMS 1.1.1 |
| MDT Elevation (illustration) | `servicios.idee.es/wcs-inspire/mdt` | WCS |

### Copernicus Dataspace

| Service | URL | Auth |
|---------|-----|------|
| Token | `identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token` | OAuth2 client_credentials |
| Process API | `sh.dataspace.copernicus.eu/api/v1/process` | Bearer token |
| Satellite | Sentinel-2 L2A | Bands B04 (Red), B08 (NIR) |

### CNIG (Centro Nacional de Información Geográfica)

| Resource | Format | Usage |
|----------|--------|-------|
| MDT02 | GeoTIFF | 2m elevation rasters in `data/mdt/` |
| LiDAR | LAZ | **Planned** — not yet implemented |

### Replicate (Optional AI)

| Model | Usage |
|-------|-------|
| Flux Schnell | Fast text-to-image illustration |
| Flux Dev | Higher quality image generation |

### Docker

| Image | Usage |
|-------|-------|
| `geodata/cesium-terrain-builder` | GeoTIFF → quantized-mesh tiles |

---

## 14. Illustration Service (Python)

### Architecture

```
FastAPI (port 8001)
├── POST /generate-illustration     → async job → polling
│   └── illustration_renderer.py
│       ├── Fetches PNOA orthophoto (IGN WMS 1.3.0)
│       ├── Fetches MDT elevation (IGN WCS)
│       ├── Builds 3D terrain mesh (numpy)
│       ├── Computes normals + lighting
│       ├── Renders isometric view (painter's algorithm)
│       ├── Overlays gold cadastral boundary
│       └── Returns PNG (PIL Image)
│
├── POST /generate-ai-illustration  → Replicate API
│   ├── prompt_builder.py           → builds descriptive prompt
│   └── image_generator.py          → Flux Schnell/Dev
│
├── GET /status/{job_id}            → job polling
├── GET /generated/{filename}       → static file serving
└── GET /health                     → health check
```

### Rendering Pipeline Detail

1. **orthophoto_fetcher.py**: Downloads 1024×1024 orthophoto from PNOA WMS 1.3.0, projected in EPSG:4326
2. **Elevation fetch**: WCS request to MDT service for DEM grid matching parcel bbox
3. **Mesh construction**: numpy grid with elevation values, normalized to [-1, 1] range
4. **Isometric projection**: 3D coordinates → 2D screen using classic isometric angles (30°)
5. **Lighting**: Surface normal computation, directional light from top-left
6. **Texture mapping**: Orthophoto pixels mapped to terrain quads
7. **Boundary overlay**: Gold polyline traced over cadastral parcel boundary
8. **Output**: PIL Image saved as PNG to `/generated/` directory

---

## 15. Configuration Files

### `.env.local` (Frontend)

```env
NEXT_PUBLIC_CESIUM_ION_TOKEN=eyJhbGciOiJIUz...
NEXT_PUBLIC_MDT02_ASSET_ID=4475569
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

### `.env` (API — created by CLI `init` command)

```env
COPERNICUS_CLIENT_ID=<your-client-id>
COPERNICUS_CLIENT_SECRET=<your-client-secret>
PORT=3001
```

### `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### `tsconfig.json` (Root)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "paths": {
      "@geotwin/types": ["./packages/types/src"]
    }
  }
}
```

### Preset Configurations (`apps/api/src/config/presets.ts`)

| Key | Mountain | Dehesa | Mediterranean |
|-----|----------|--------|-------------- |
| `verticalExaggeration` | 2.0 | 1.0 | 1.2 |
| `lightingIntensity` | 1.8 | 1.2 | 1.5 |
| `atmosphere.brightness` | 1.1 | 1.0 | 1.15 |
| `atmosphere.saturation` | 1.2 | 1.0 | 1.1 |
| `atmosphere.hueShift` | 220 (cool) | 30 (warm) | 45 (bright) |
| `atmosphere.hazeIntensity` | — | — | 0.4 |
| `groundTint` | Blue-gray | Warm pasture | Dusty earth |
| Oak trees | — | 120 | — |

---

## 16. Studio Mode

Located at `/studio/[twinId]`, the Studio provides an advanced editing environment:

### Components

| Component | Purpose |
|-----------|---------|
| `StudioTopBar` | Title, mode selector, save/export buttons |
| `StudioRightPanel` | Visual style editor (colors, opacity, terrain exaggeration, lighting, time-of-day) |
| `StudioBottomBar` | Status indicators, layer toggles |
| `StudioViewer` | CesiumJS viewer with studio-specific controls |
| `SimulatorMode` | IoT/cattle simulation overlay |
| `IllustrationModal` | Triggers illustration generation |

### Modes

| Mode | Tab | Description |
|------|-----|-------------|
| `terrain` | Terrain | Terrain visualization and style editing |
| `iot` | IoT | Sensor placement and monitoring |
| `cattle` | Cattle | GPS tracking visualization |
| `bim` | BIM | Building/infrastructure overlay (placeholder) |
| `simulate` | Simulate | Digital twin simulation |

### Visual Style Defaults

```typescript
{
  preset: 'default',
  fillColor: '#00d4ff',
  fillOpacity: 0.09,
  boundaryColor: '#f0c040',
  boundaryWidth: 2.0,
  terrainExaggeration: 2.5,  // Minimum enforced: 2.0
  enableLighting: true,
  timeOfDay: '2024-01-01T08:00:00Z',
  atmosphereDensity: 1.0,
}
```

### Persistence

- Loads `TwinSnapshot` from `localStorage` via `twinStore.get(twinId)`
- Supports JSON file drag-and-drop import
- Merges saved visual style with defaults (ensures terrain exaggeration ≥ 2.0)

---

## 17. CLI Tool

Binary name: `geotwin` (via `packages/cli/package.json` `bin` field)

### Commands

#### `geotwin init`

Interactive setup wizard that creates `.env` files:
1. Prompts for Cesium Ion access token
2. Prompts for Copernicus credentials (optional)
3. Writes `apps/web/.env.local` and `apps/api/.env`

#### `geotwin import <file>`

Uploads KML/GeoJSON file to API:
1. Reads file from disk
2. POST to `/api/import` with optional `--preset` flag
3. Displays twin details: ID, area, centroid, layers

#### `geotwin dev`

Starts all development servers:
1. Spawns `pnpm --filter @geotwin/api dev` on port 3001
2. Spawns `pnpm --filter @geotwin/web dev` on port 3000
3. Monitors both processes, reports status

---

## 18. Terrain Pipeline

### Runtime (CesiumJS)

```
Cesium Ion → MDT02 Asset 4475569 → quantized-mesh tiles → CesiumTerrainProvider
  ↓ (fallback)
Cesium Ion → World Terrain → quantized-mesh tiles → CesiumTerrainProvider
  ↓ (fallback)
EllipsoidTerrainProvider (flat)
```

### Build Pipeline (`tools/terrain/build-terrain.ts`)

```
CNIG MDT02 GeoTIFF → Docker (cesium-terrain-builder) → quantized-mesh tiles
                                                         ↓
                                                    Upload to Cesium Ion
                                                    (Asset ID: 4475569)
```

### Terrain Analysis (`terrainAnalysis.ts`)

Client-side terrain grid sampling:
- `sampleTerrainGrid()`: Creates NxN grid over bounding box
- Uses `sampleTerrainMostDetailed` for each grid point
- Computes `SlopeGridResult` with slope angles and aspect directions
- Used for terrain-aware features (plinth depth, camera positioning)

---

## 19. Known TODOs & Stubs

| Location | TODO | Priority |
|----------|------|----------|
| `lidar-service.ts` | LiDAR LAZ → 3D Tiles pipeline | Medium |
| `terrain-service.ts` | `gdalwarp` clipping needs GDAL binary | Medium |
| `terrain-service.ts` | Quantized-mesh conversion from local GeoTIFF | Low |
| `CesiumViewer.tsx` | IoT sensor toggle UI (entities hidden, not wired) | High |
| `CesiumViewer.tsx` | Cattle GPS toggle UI (entities hidden, not wired) | High |
| `TwinRecipe` | `esg?` field defined but unused | Low |
| `TwinRecipe` | `infrastructure?` field defined but unused | Low |
| Studio BIM mode | Tab exists, no implementation | Low |
| Studio SimulatorMode | Component exists, minimal implementation | Medium |
| Real-time sensor data | Currently uses randomized demo values | Future |

---

## Summary Stats

| Metric | Value |
|--------|-------|
| Total packages | 5 (2 apps + 1 service + 2 packages) |
| TypeScript source files | ~45 |
| Python source files | 7 |
| Largest file | `CesiumViewer.tsx` (2512 lines) |
| API endpoints | 10 |
| Layer types | 7 |
| Visual presets | 3 |
| External service integrations | 5 (Cesium Ion, IGN/PNOA, Copernicus, CNIG, Replicate) |
| Frontend dependencies | ~10 |
| Backend dependencies | ~12 |
| Python dependencies | 7 |
| CLI commands | 3 |

---

*End of comprehensive report.*
