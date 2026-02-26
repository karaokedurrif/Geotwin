# GeoTwin Engine

[![GitHub](https://img.shields.io/badge/GitHub-karaokedurrif%2FGeotwin-blue)](https://github.com/karaokedurrif/Geotwin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![TypeScript](https://img.shields.io/badge/TypeScript-End--to--End-blue)
![Monorepo](https://img.shields.io/badge/Monorepo-pnpm%20workspaces-orange)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![CesiumJS](https://img.shields.io/badge/CesiumJS-1.113-green)

An MVP platform for ingesting cadastral files and rendering interactive 3D geospatial twins in the browser using CesiumJS.

🌍 **[Live Demo](#)** | 📖 **[Documentation](docs/)** | 🐛 **[Report Bug](https://github.com/karaokedurrif/Geotwin/issues)** | 💡 **[Request Feature](https://github.com/karaokedurrif/Geotwin/issues)**

## 🌍 Features

### Core Functionality
- **Multi-format Support**: Ingest KML, GML, and ZIP cadastral files
- **3D Visualization**: Powered by CesiumJS with terrain and satellite imagery
- **Style Presets**: Three visual themes (Mountain, Dehesa, Mediterranean)
- **Data Layers**: Parcel boundaries, extrusion, NDVI heatmap, water points, ROI labels
- **Clean Architecture**: TypeScript monorepo with shared types

### Advanced Capabilities
- **🏔️ Real Terrain & Slopes**: Cesium World Terrain with high-resolution DEM (requires Ion token)
  - Automatic fallback to ellipsoid if token unavailable
  - Terrain exaggeration based on preset (1.1x - 1.4x)
  - Real slope visualization for parcels
  - **NEW**: Local MDT02 CNIG terrain support (optional, see [Local MDT02 Terrain](#-local-mdt02-terrain-optional))
  
- **🌱 Real NDVI (Sentinel-2)**: Live vegetation analysis from Copernicus Dataspace
  - Fetches actual NDVI from Sentinel-2 L2A imagery
  - 30-day rolling window with automatic cloud filtering (<30% coverage)
  - Fallback to demo data if credentials unavailable
  - Overlay with adjustable transparency

- **⚡ Resilient Architecture**:
  - Non-blocking initialization (viewer renders immediately)
  - Timeout protection on all async operations (12s terrain, 12s imagery, 15s NDVI)
  - Automatic port selection (no more EADDRINUSE errors)
  - API health checks with latency monitoring

- **🛠️ Developer-Friendly CLI**:
  - `geotwin init` - Interactive setup wizard
  - `geotwin import <file>` - Upload and process files
  - `geotwin dev` - Start all servers with one command

## 🏗️ Architecture

```
Geotwin/
├── apps/
│   ├── web/          # Next.js web application
│   └── api/          # Fastify API server
├── packages/
│   └── types/        # Shared TypeScript types
├── sample-data/      # Example cadastral files
└── data/             # Generated twin data (gitignored)
```

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- **Cesium Ion Token** (free tier available at [ion.cesium.com](https://ion.cesium.com/tokens))
- **Copernicus Credentials** (optional, for real NDVI) - Register at [dataspace.copernicus.eu](https://dataspace.copernicus.eu/)

### Installation

```bash
# Clone and install dependencies
git clone https://github.com/karaokedurrif/Geotwin.git
cd Geotwin
pnpm install

# Build shared packages
pnpm --filter @geotwin/types build

# Build CLI (optional, for geotwin command)
cd packages/cli
pnpm install
pnpm build
cd ../..
```

### Quick Setup with CLI

The easiest way to get started:

```bash
# Initialize config files
pnpm --filter @geotwin/cli geotwin init

# Start development servers (auto-selects ports if occupied)
pnpm --filter @geotwin/cli geotwin dev

# Import a KML file
pnpm --filter @geotwin/cli geotwin import sample-data/40212A00200007.kml --preset dehesa
```

### Manual Setup

1. **Configure Cesium Ion Token** (Required for World Terrain):

```bash
# Create apps/web/.env
cp apps/web/.env.example apps/web/.env

# Edit apps/web/.env and add your token:
NEXT_PUBLIC_CESIUM_ION_TOKEN=your_actual_token_here
```

2. **Configure Copernicus** (Optional, for Real NDVI):

```bash
# Create apps/api/.env
cp apps/api/.env.example apps/api/.env

# Edit apps/api/.env and add:
COPERNICUS_CLIENT_ID=your_client_id
COPERNICUS_CLIENT_SECRET=your_client_secret
```

3. **Start Servers**:

```bash
# Terminal 1: API
pnpm --filter @geotwin/api dev    # Auto-selects port (default: 3001)

# Terminal 2: Web
pnpm --filter @geotwin/web dev    # Runs on http://localhost:3000
```

> **Note**: Ports are auto-selected if occupied. Check console output for actual ports.

### Development

```bash
# Start both web and API servers
pnpm dev

# Or use the CLI for better UX
pnpm --filter @geotwin/cli geotwin dev
```

## 🎬 Landing Demo Mode

GeoTwin includes a premium autoplay demo mode perfect for landing pages and presentations.

### Access Demo Page

```bash
# Navigate to demo page (default: Dehesa preset, tile mode ON, autoplay ON)
http://localhost:3000/demo

# Customize with query parameters:
http://localhost:3000/demo?preset=mediterranean&autoplay=1&tileMode=1
```

### Query Parameters

| Parameter | Options | Default | Description |
|-----------|---------|---------|-------------|
| `preset` | `mountain`, `dehesa`, `mediterranean` | `dehesa` | Visual style preset |
| `autoplay` | `0`, `1` | `1` | Enable 90-second layer sequence |
| `tileMode` | `0`, `1` | `1` | Enable floating tile diorama effect |

### Autoplay Sequence

The autoplay demo runs a 90-second orchestrated sequence:

1. **0-10s**: Parcel boundary loads
2. **10-25s**: Terrain extrusion appears
3. **25-40s**: NDVI vegetation heatmap fades in
4. **40-55s**: Water sources appear
5. **55-90s**: Full simulation with oak trees (dehesa) and ROI labels

### Tile Mode Features

- 🎭 **Hero Camera Angle**: 45° pitch, 15° heading for optimal viewing
- 🌑 **Vignette Effect**: Radial gradient overlay for cinematic depth
- 🔳 **Floating Tile**: Plinth base with negative extrusion (-15m)
- 🎨 **Dark Background**: Preset-specific skybox colors
- ✨ **Drop Shadow**: Elevated diorama appearance

### Snapshot Export

Click the **📸 Export Snapshot** button to download the current 3D view as a PNG image.

- Captures full Cesium canvas at current resolution
- Filename format: `geotwin-{twinId}-{timestamp}.png`
- Works in both standard and tile modes

### Building for Production

```bash
# Build all packages
pnpm build

# Start production servers
pnpm --filter @geotwin/api start
pnpm --filter @geotwin/web start
```

## 📋 Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Build all packages and apps |
| `pnpm lint` | Run linting across all packages |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm format` | Format code with Prettier |
| `pnpm format:check` | Check code formatting |

## 🎨 Style Presets

### Mountain 🏔️
- Cool blue-gray tones
- Enhanced terrain exaggeration (2x)
- Stronger relief shading
- Rocky terrain aesthetic

### Dehesa 🌳
- Warm pasture colors
- Oak tree markers
- Natural terrain exaggeration
- Mediterranean parkland feel

### Mediterranean 🫒
- Bright, sunny atmosphere
- Dry grass tones
- Olive tree markers
- Dusty, warm lighting

### Customizing Presets

Preset configurations are defined in:
- **API**: [`apps/api/src/config/presets.ts`](apps/api/src/config/presets.ts)
- **Web**: Applied in [`apps/web/src/components/CesiumViewer.tsx`](apps/web/src/components/CesiumViewer.tsx)

To modify a preset:
1. Edit the preset config in `apps/api/src/config/presets.ts`
2. Adjust terrain exaggeration, atmosphere settings, ground tint, etc.
3. The changes will be reflected in newly created twins

## 🗂️ Data Layers

| Layer | Description | Toggle |
|-------|-------------|--------|
| **Parcel Boundary** | Polygon outline of cadastral parcel | ✅ On by default |
| **Parcel Extrusion** | 3D extrusion of parcel footprint | ❌ Off by default |
| **NDVI Heatmap** | Pseudo-vegetation index demo | ✅ On by default |
| **Water Points** | Demo water source locations | ✅ On by default |
| **ROI Labels** | Financial metrics (Payback, NPV, IRR) | ✅ On by default |

### Modifying Layers

Layer rendering logic is in:
- **API Generation**: [`apps/api/src/services/recipe-generator.ts`](apps/api/src/services/recipe-generator.ts)
- **Cesium Rendering**: [`apps/web/src/components/CesiumViewer.tsx`](apps/web/src/components/CesiumViewer.tsx)

To add a new layer:
1. Add layer type to `@geotwin/types` in [`packages/types/src/index.ts`](packages/types/src/index.ts)
2. Generate layer data in `apps/api/src/services/demo-generator.ts`
3. Add layer config in `recipe-generator.ts`
4. Render layer in `CesiumViewer.tsx`

## 🏔️ Local MDT02 Terrain (Optional)

GeoTwin Engine supports using local CNIG MDT02 Digital Elevation Models as Cesium terrain tiles, providing high-resolution terrain data for Spain without requiring an Ion token.

### Why Use Local MDT02?

- **🌍 High Resolution**: 2-meter resolution terrain data from CNIG
- **🇪🇸 Spain-Specific**: Optimized for Spanish cadastral parcels
- **💰 Free**: No Cesium Ion credits required
- **🔒 Offline**: Works without internet once tiles are built
- **🎯 Accurate**: Official government DEM data

### Step 1: Obtain MDT02 GeoTIFF

Download MDT02 files from CNIG:

1. Visit [CNIG Download Center](https://centrodedescargas.cnig.es/CentroDescargas/)
2. Select **Producto**: **MDT02** (Modelo Digital del Terreno 02)
3. Choose your area of interest (e.g., Hoja 0001)
4. Download format: **GeoTIFF** (`.tif`)
5. Projection: **EPSG:25829**, **EPSG:25830**, or **EPSG:25831** (ETRS89 UTM zones)

**Example files**:
- `MDT02-ETRS89-HU29-0001-2-COB2.tif` (20 MB, Hoja 0001, Zone 29)
- `MDT02-ETRS89-HU30-0002-2-COB1.tif` (18 MB, Hoja 0002, Zone 30)

### Step 2: Place GeoTIFF in Project

Save your downloaded MDT02 file to:

```
data/raw/mdt02.tif
```

**Example**:
```bash
# Create directory if it doesn't exist
mkdir -p data/raw

# Copy your downloaded file
cp ~/Downloads/MDT02-ETRS89-HU29-0001-2-COB2.tif data/raw/mdt02.tif
```

### Step 3: Build Terrain Tiles

Convert the GeoTIFF into Cesium quantized-mesh tiles:

```bash
# Ensure ts-node is installed (should be in devDependencies)
pnpm install

# Build terrain tiles
pnpm terrain:build
```

**What this does**:
1. Verifies Docker is running
2. Spins up `geodata/cesium-terrain-builder` container
3. Converts `data/raw/mdt02.tif` into quantized-mesh tiles
4. Outputs tiles to `apps/web/public/terrain/mdt02/`
5. Creates `layer.json` metadata file

**Requirements**:
- **Docker** must be installed and running ([docker.com](https://www.docker.com/get-started))
- Input file must be a valid GeoTIFF with proper CRS
- ~2-10 GB free disk space (depending on MDT02 coverage area)

**Expected Output**:
```
🌍 Cesium Terrain Builder
========================

✓ Input file: /path/to/data/raw/mdt02.tif (20.1 MB)
✓ Docker is available
✓ Output directory: /path/to/apps/web/public/terrain/mdt02
✓ Temp directory: /path/to/data/temp/terrain-build

🔧 Building terrain tiles (this may take several minutes)...

Running Docker command: docker run --rm -v ...

[Docker output...]

✓ Terrain tiles generated
📦 Moving tiles to public folder...
✓ Tiles copied to /path/to/apps/web/public/terrain/mdt02
✓ Created layer.json metadata
🧹 Cleaning up temporary files...

✅ SUCCESS! Terrain tiles are ready

📍 Location: /path/to/apps/web/public/terrain/mdt02
🎯 Enable "Local MDT02 Terrain" in the GeoTwin UI to use these tiles.
```

**Build Time**: Typically 3-10 minutes for a standard MDT02 tile (~20 MB GeoTIFF)

### Step 4: Enable Local MDT02 in UI

1. Start GeoTwin: `pnpm dev`
2. Open http://localhost:3000
3. Load a sample or upload a parcel
4. In the Control Panel:
   - ✅ Enable **🏔️ Real Terrain & Slopes**
   - Select **Terrain Source**: `Local MDT02 (CNIG)`

The 3D viewer will now use your locally-built terrain tiles!

### Verify Terrain Loading

Check browser console for:
```
✓ Loading Local MDT02 Terrain...
✓ Local MDT02 Terrain loaded
```

Status badge should show:
- **🏔️ Terrain: ✓ SUCCESS** with message: `CNIG MDT02 Local Terrain`

### Advanced: Custom Input File

To build terrain from a different GeoTIFF:

```bash
pnpm terrain:build --input /path/to/custom-dem.tif
```

### Troubleshooting

#### ❌ Error: "Local terrain tiles not found"

**Solution**:
1. Verify tiles exist: `ls apps/web/public/terrain/mdt02/`
2. Check for `layer.json`: `cat apps/web/public/terrain/mdt02/layer.json`
3. Re-run build: `pnpm terrain:build`

#### ❌ Error: "Docker is not installed or not running"

**Solution**:
1. Install Docker: [docker.com/get-docker](https://docs.docker.com/get-docker/)
2. Start Docker Desktop
3. Verify: `docker --version` and `docker ps`

#### ❌ Build fails or hangs

**Solution**:
1. Check Docker memory/CPU limits (increase if needed)
2. Verify GeoTIFF is valid: `gdalinfo data/raw/mdt02.tif`
3. Try smaller tile: Download a smaller MDT02 area
4. Check logs: `docker logs <container_id>`

#### ⚠️ Terrain appears flat/incorrect

**Solution**:
1. Verify GeoTIFF projection matches parcel location
2. Check that tiles cover your parcel's bbox
3. Try different MDT02 tile (different Hoja number)
4. Ensure CRS is EPSG:25829-25831 or EPSG:4326

### Performance Notes

- **Tile Coverage**: MDT02 tiles only cover Spain
- **File Size**: Built tiles typically 2-5x larger than source GeoTIFF
- **Loading Speed**: Local tiles load faster than Cesium World Terrain (no CDN latency)
- **Browser Cache**: Tiles are cached by browser for faster reloads

### Switching Back to World Terrain

Simply select **Terrain Source**: `Cesium World Terrain` in the UI. Both sources can be toggled without restarting the server.

## 📦 API Endpoints

### POST `/api/import`

Upload a cadastral file and generate a Twin Recipe.

**Query Parameters:**
- `preset`: `mountain` | `dehesa` | `mediterranean` (default: `mountain`)

**Request:**
```bash
curl -X POST \
  'http://localhost:3001/api/import?preset=mountain' \
  -F 'file=@40212A00200007.kml'
```

**Response:**
```json
{
  "success": true,
  "twinId": "abc123def4",
  "recipe": {
    "twinId": "abc123def4",
    "preset": "mountain",
    "centroid": [-4.1229, 40.9871],
    "area_ha": 12.34,
    "camera": { ... },
    "layers": [ ... ]
  }
}
```

### GET `/api/twin/:twinId`

Retrieve an existing Twin Recipe.

### GET `/api/twin/:twinId/geometry`

Retrieve the GeoJSON geometry for a twin.

### GET `/health`

Health check endpoint.

## 🧪 Testing with Sample Data

Sample cadastral files are included:
- `apps/web/public/sample-data/40212A00200007.kml`
- `apps/web/public/sample-data/40212A00200007 (1).gml`
- `apps/web/public/sample-data/40212A00200007.zip` (contains KML)

Use the **Load Sample Data** button in the web UI to test without uploading.

## 🛠️ Technology Stack

### Web App (`apps/web`)
- **Framework**: Next.js 14
- **3D Engine**: CesiumJS 1.113
- **Styling**: Tailwind CSS
- **Language**: TypeScript

### API Server (`apps/api`)
- **Framework**: Fastify
- **File Parsing**: fast-xml-parser, JSZip
- **Geospatial**: Turf.js
- **Language**: TypeScript

### Shared (`packages/types`)
- **TypeScript types** shared between web and API

## 📝 Twin Recipe Contract

The `TwinRecipe` type defines the contract between API and web:

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
}
```

See [`packages/types/src/index.ts`](packages/types/src/index.ts) for full type definitions.

## 🔧 Configuration

### Environment Variables

**API (`apps/api`):**
- `PORT`: API server port (default: 3001)
- `HOST`: API server host (default: 0.0.0.0)

**Web (`apps/web`):**
- No environment variables required for MVP

### Cesium Ion Token

The web app uses a default Cesium Ion access token for terrain and imagery. For production, replace the token in [`apps/web/src/components/CesiumViewer.tsx`](apps/web/src/components/CesiumViewer.tsx):

```typescript
Cesium.Ion.defaultAccessToken = 'YOUR_TOKEN_HERE';
```

Get a free token at: https://cesium.com/ion/signup

## 📂 Data Storage

Generated twin data is stored locally in `/data/<twinId>/`:
- `scene.json`: Complete Twin Recipe
- `geometry.geojson`: Parcel 

## 🚀 Deployment

### Vercel (Web App)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy web app
cd apps/web
vercel
```

### Railway / Render (API)

The API can be deployed to any Node.js hosting platform:

1. Set environment variable: `PORT=3001`
2. Build command: `pnpm install && pnpm --filter @geotwin/types build && pnpm --filter @geotwin/api build`
3. Start command: `pnpm --filter @geotwin/api start`

### Docker (Coming Soon)

Docker support will be added in a future release.

## 🔗 Repository

GitHub: [karaokedurrif/Geotwin](https://github.com/karaokedurrif/Geotwin)

**Quick clone:**
```bash
git clone https://github.com/karaokedurrif/Geotwin.git
cd Geotwin
pnpm install
```geometry in GeoJSON format

This directory is gitignored.

## 🎯 Roadmap

Future enhancements:
- [ ] Real NDVI from satellite imagery (Sentinel-2, Planet)
- [ ] Cloud storage integration (S3, GCS)
- [ ] User authentication
- [ ] Twin sharing and collaboration
- [ ] Time-series data visualization
- [ ] Solar panel placement optimization
- [ ] Carbon sequestration modeling

## 🤝 Contributing

This is an MVP. For production use:
1. Add robust error handling
2. Implement comprehensive tests
3. Add input validation and sanitization
4. Set up proper logging and monitoring
5. Configure CORS properly
6. Add rate limiting
7. Implement authentication

## 📄 License

MIT

## 🙏 Acknowledgments

- **CesiumJS** for 3D geospatial visualization
- **Turf.js** for geospatial analysis
- **Next.js** for the web framework
- **Fastify** for the API framework

---

**Built with ❤️ for climate tech**
