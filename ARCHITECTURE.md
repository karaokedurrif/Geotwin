# GeoTwin Engine - Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │          Next.js Web App (Port 3000)               │     │
│  │  ├─ Upload UI (React Components)                   │     │
│  │  ├─ CesiumJS Viewer (3D Rendering)                 │     │
│  │  └─ Layer Controls (React State)                   │     │
│  └────────────────────────────────────────────────────┘     │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP/REST
                       │
┌──────────────────────▼──────────────────────────────────────┐
│              Fastify API Server (Port 3001)                 │
│  ┌────────────────────────────────────────────────────┐     │
│  │ Routes (/api/import, /api/twin/:id)                │     │
│  └──┬──────────────────────────────────────────────┬──┘     │
│     │                                              │         │
│  ┌──▼──────────────────┐              ┌───────────▼──────┐  │
│  │ File Parsers        │              │ Recipe Generator │  │
│  │ ├─ KML Parser       │              │ ├─ Geometry Calc │  │
│  │ ├─ GML Parser       │              │ ├─ Demo Layers   │  │
│  │ └─ ZIP Extractor    │              │ └─ Preset Config │  │
│  └─────────────────────┘              └──────────────────┘  │
│                                              │               │
│                                       ┌──────▼───────────┐   │
│                                       │ Local Storage    │   │
│                                       │ /data/<twinId>/  │   │
│                                       │ ├─ scene.json    │   │
│                                       │ └─ geometry.json │   │
│                                       └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. File Upload Flow

```
User uploads file
    ↓
Upload Panel (UploadPanel.tsx)
    ↓ FormData
POST /api/import?preset=mountain
    ↓
Import Router (routes/import.ts)
    ↓
File Parser (parsers/index.ts)
    ├─ KML Parser → Extract coordinates
    ├─ GML Parser → Extract coordinates
    └─ ZIP Parser → Extract & parse
    ↓
Recipe Generator (services/recipe-generator.ts)
    ├─ Calculate metrics (area, centroid, bbox)
    ├─ Generate demo layers (NDVI, water, ROI)
    └─ Apply preset configuration
    ↓
Storage Service (services/storage.ts)
    ├─ Save scene.json
    └─ Save geometry.geojson
    ↓
Return TwinRecipe JSON
    ↓
Web App receives recipe
    ↓
Cesium Viewer renders 3D scene
```

### 2. Layer Rendering Flow

```
TwinRecipe received
    ↓
ViewerContainer mounts
    ↓
CesiumViewer initializes
    ├─ Create Cesium.Viewer instance
    ├─ Apply PresetConfig
    │   ├─ Terrain exaggeration
    │   ├─ Atmosphere settings
    │   └─ Ground tint
    ├─ Set camera position
    └─ Load geometry
        ↓
Fetch geometry.geojson
        ↓
Create DataSources for each layer
    ├─ Parcel (polygon + outline)
    ├─ Extrusion (3D polygon)
    ├─ NDVI (heatmap cells)
    ├─ Water points (billboards + labels)
    └─ ROI labels (billboards + labels)
        ↓
Render in Cesium scene
        ↓
User toggles layers
    ↓
LayerControls updates state
    ↓
DataSource.show = enabled/disabled
```

## Key Components

### Web App (`apps/web`)

| Component | Purpose |
|-----------|---------|
| `pages/index.tsx` | Main page, state management |
| `UploadPanel.tsx` | File upload UI and preset selection |
| `ViewerContainer.tsx` | Layout for viewer + controls |
| `CesiumViewer.tsx` | Cesium initialization and rendering |
| `LayerControls.tsx` | Toggle layer visibility |

### API Server (`apps/api`)

| Module | Purpose |
|--------|---------|
| `server.ts` | Fastify server initialization |
| `routes/import.ts` | Upload and retrieval endpoints |
| `parsers/*.ts` | KML, GML, ZIP parsing |
| `services/recipe-generator.ts` | Generate TwinRecipe from geometry |
| `services/demo-generator.ts` | Create demo NDVI, water, ROI data |
| `services/storage.ts` | Save to local filesystem |
| `config/presets.ts` | Style preset definitions |

### Shared Types (`packages/types`)

| Type | Purpose |
|------|---------|
| `TwinRecipe` | Complete twin configuration |
| `LayerConfig` | Individual layer settings |
| `PresetConfig` | Visual style configuration |
| `GeoJSONGeometry` | Normalized geometry format |
| `POIConfig` | Point of interest definition |

## Technology Choices

### Why CesiumJS?
- Industry-standard 3D geospatial engine
- Built-in terrain and imagery support
- Excellent performance for large datasets
- Camera controls and navigation

### Why Fastify?
- High performance Node.js framework
- Excellent TypeScript support
- Built-in schema validation
- Plugin ecosystem

### Why Next.js?
- React framework with SSR capability
- Great developer experience
- Built-in routing
- Easy deployment

### Why pnpm workspaces?
- Efficient disk usage
- Fast installs
- Strict dependency management
- Perfect for monorepos

### Why Turf.js?
- Comprehensive geospatial operations
- Pure JavaScript (no GDAL dependencies)
- GeoJSON native
- Well-documented

## Extensibility Points

### Adding Real Satellite Data

Replace `demo-generator.ts` with real data sources:

```typescript
// Example: Fetch Sentinel-2 NDVI
import { sentinel } from '@sentinel-hub/sentinelhub-js';

async function fetchRealNDVI(bbox: BBox, date: string) {
  const ndvi = await sentinel.getNDVI({
    bbox,
    date,
    resolution: 10,
  });
  
  return ndvi; // Process into grid cells
}
```

### Adding Cloud Storage

Replace `storage.ts` with S3/GCS:

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

async function saveTwinData(recipe: TwinRecipe, geometry: GeoJSONGeometry) {
  const s3 = new S3Client({ region: 'us-east-1' });
  
  await s3.send(new PutObjectCommand({
    Bucket: 'geotwin-data',
    Key: `twins/${recipe.twinId}/scene.json`,
    Body: JSON.stringify(recipe),
  }));
}
```

### Adding Authentication

Use NextAuth.js for web and JWT for API:

```typescript
// apps/web/pages/api/auth/[...nextauth].ts
import NextAuth from 'next-auth';

export default NextAuth({
  providers: [
    // Configure providers
  ],
});

// apps/api - protect routes
fastify.addHook('onRequest', async (request, reply) => {
  const token = request.headers.authorization;
  // Verify JWT
});
```

## Performance Considerations

### Current Limitations (MVP)
- Local filesystem storage (single server)
- No caching layer
- Demo data only (not real satellite)
- Client-side rendering only

### Production Improvements
- CDN for static assets
- Redis cache for recipes
- PostgreSQL + PostGIS for geometry
- Server-side rendering for SEO
- WebSocket for real-time updates
- Worker threads for heavy processing

## Security Considerations

### MVP Security Gaps
⚠️ No authentication
⚠️ No rate limiting
⚠️ Open CORS
⚠️ No file size validation beyond 50MB
⚠️ No malware scanning

### Production Security Checklist
- [ ] Implement authentication (OAuth2, JWT)
- [ ] Add rate limiting (express-rate-limit, fastify-rate-limit)
- [ ] Restrict CORS origins
- [ ] Validate and sanitize all input
- [ ] Scan uploaded files for malware
- [ ] Implement HTTPS/TLS
- [ ] Add CSP headers
- [ ] Audit dependencies regularly
- [ ] Implement logging and monitoring
- [ ] Set up WAF (Web Application Firewall)

---

**Note**: This is an MVP architecture for demonstration. Production deployment requires significant hardening and infrastructure planning.
