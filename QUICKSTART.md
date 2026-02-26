# GeoTwin Engine - Quick Start Guide

## Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** >= 8.0.0
- **Cesium Ion Token** (optional but recommended) - Get free token at [ion.cesium.com/tokens](https://ion.cesium.com/tokens)
- **Copernicus Credentials** (optional, for real NDVI) - Register at [dataspace.copernicus.eu](https://dataspace.copernicus.eu/)

## Installation

```bash
# Install pnpm if you don't have it
npm install -g pnpm

# Clone repository
git clone https://github.com/karaokedurrif/Geotwin.git
cd Geotwin

# Install all dependencies
pnpm install

# Build shared types
pnpm --filter @geotwin/types build

# Build CLI (optional but recommended)
cd packages/cli
pnpm install && pnpm build
cd ../..
```

## Setup

### Option 1: Interactive Setup (Recommended)

```bash
# Run setup wizard
pnpm --filter @geotwin/cli geotwin init
```

This will:
1. Prompt for your Cesium Ion token
2. Optionally configure Copernicus credentials
3. Create `.env` files in `apps/web` and `apps/api`

### Option 2: Manual Setup

1. **Configure Web App** (Required for World Terrain):

```bash
cp apps/web/.env.example apps/web/.env
```

Edit `apps/web/.env`:
```bash
NEXT_PUBLIC_CESIUM_ION_TOKEN=your_actual_token_here
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

2. **Configure API** (Optional, for Real NDVI):

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env`:
```bash
PORT=3001
COPERNICUS_CLIENT_ID=your_client_id
COPERNICUS_CLIENT_SECRET=your_client_secret
```

## Running the Application

### Option 1: Using CLI (Easiest)

```bash
pnpm --filter @geotwin/cli geotwin dev
```

This:
- Starts API server (auto-selects port if 3001 is busy)
- Starts web server on port 3000
- Shows live status for both servers

### Option 2: Using pnpm dev

```bash
pnpm dev
```

Servers will be at:
- Web: http://localhost:3000
- API: http://localhost:3001 (or next available port)

### Option 3: Run Separately

Terminal 1 (API):
```bash
pnpm --filter @geotwin/api dev
```

Terminal 2 (Web):
```bash
pnpm --filter @geotwin/web dev
```

## Using the Application

### Load Sample Data

1. Open http://localhost:3000
2. Click **"Load Sample Data"** button
3. Wait for terrain, imagery, and geometry to load
4. Check status badges in top-right:
   - **Terrain**: loading → success (World Terrain) or fallback (Ellipsoid)
   - **Imagery**: loading → success (Ion imagery) or fallback (OSM)
   - **API**: Shows green if healthy

### Upload Your Own File

1. Click **"📁 New Upload"**
2. Select a file (KML, GeoJSON, or ZIP)
3. Choose a preset:
   - **Mountain**: High terrain exaggeration (1.4x), cool tones
   - **Dehesa**: Moderate terrain (1.15x), oak trees, warm Mediterranean colors
   - **Mediterranean**: Subtle terrain (1.1x), coastal palette
4. Click **"Generate Twin"**

### Enable Real Features

**Real Terrain & Slopes** (requires Cesium Ion token):
- Status badge shows "worldTerrain" when active
- Toggle off/on to see difference between real DEM and ellipsoid
- Terrain exaggeration adapts to preset

**Real NDVI (Sentinel-2)** (requires Copernicus credentials):
- Enable toggle in layer panel
- Yellow bbox appears while loading (15s timeout)
- Red bbox when loaded successfully
- Shows actual vegetation health from last 30 days
- Fallback to demo data if credentials not configured

## CLI Commands

### Import a File

```bash
pnpm --filter @geotwin/cli geotwin import path/to/file.kml --preset dehesa
```

Output:
```
📦 Importing Digital Twin
  ✓ Digital Twin created successfully!

📊 Twin Details:
  ID: dehesa_1234567890
  Area: 135.05 ha
  Center: -5.2, 40.3

🌍 Open in browser:
  http://localhost:3000/?twin=dehesa_1234567890
```

## Testing the API

```bash
# Health check
curl http://localhost:3001/health

# Upload file via API
curl -X POST \
  'http://localhost:3001/api/import?preset=mountain' \
  -F 'file=@sample-data/40212A00200007.kml'

# Fetch real NDVI
curl -X POST \
  'http://localhost:3001/api/ndvi' \
  -H 'Content-Type: application/json' \
  -d '{
    "bbox": [-5.3, 40.2, -5.1, 40.4],
    "from": "2026-01-01",
    "to": "2026-02-18"
  }' \
  --output ndvi.png
```

## Troubleshooting

### "Port 3001 already in use"

✅ **Fixed!** The API now auto-selects the next available port using `get-port`.

Check console output to see actual port:
```
⚠️  Port 3001 is in use, using 3002 instead
🚀 GeoTwin API running at http://0.0.0.0:3002
```

### "Terrain: ellipsoid (no token)"

Your Cesium Ion token is not configured or invalid:

1. Get a free token: https://ion.cesium.com/tokens
2. Add to `apps/web/.env`:
   ```
   NEXT_PUBLIC_CESIUM_ION_TOKEN=your_actual_token_here
   ```
3. Restart web server

### "Cannot read properties of undefined (reading 'scene')"

✅ **Fixed!** The viewer now uses `waitForViewerReady()` utility to ensure Cesium is fully initialized before operations.

If you still see this:
1. Clear browser cache
2. Restart web server
3. Check browser console for detailed error

### Real NDVI Not Working

**If you see "API offline" error:**
- Make sure API server is running
- Check `http://localhost:3001/health`

**If you see "COPERNICUS credentials required":**
1. Register at https://dataspace.copernicus.eu/
2. Create OAuth client credentials
3. Add to `apps/api/.env`:
   ```
   COPERNICUS_CLIENT_ID=cdse-public-xxxx
   COPERNICUS_CLIENT_SECRET=xxxxx
   ```
4. Restart API server

**If NDVI loads but shows black image:**
- Check date range (Sentinel-2 data only available from 2015+)
- Try different bbox (must be on land with vegetation)
- Check cloud coverage (max 30%, try different dates)

### Build Errors

```bash
# Clean and rebuild everything
rm -rf node_modules pnpm-lock.yaml
rm -rf apps/*/node_modules apps/*/.next
rm -rf packages/*/node_modules packages/*/dist

pnpm install
pnpm --filter @geotwin/types build
pnpm --filter @geotwin/cli build
```

## Understanding the UI

### Status Badges (Top Right)

- **Terrain**: 
  - 🔵 `loading` → fetching World Terrain
  - 🟢 `worldTerrain` → real DEM active
  - 🟡 `ellipsoid` → fallback (smooth sphere)

- **Imagery**:
  - 🔵 `loading` → fetching Ion imagery
  - 🟢 `ion` → Bing Maps active
  - 🟡 `osm` → OpenStreetMap fallback

- **API**:
  - 🟢 `online (45ms)` → healthy
  - 🔴 `offline` → check server

### Logs Panel (Bottom Left)

Real-time messages:
```
ℹ Initializing Cesium viewer...
✓ Cesium Ion token configured (eyJhbGciOi...)
✓ Viewer scene ready
✓ World Terrain loaded
✓ Ion imagery loaded
✓ Loading geometry...
✓ NDVI layer displayed (red bbox)
```

## Next Steps

- 📖 Read the full [README.md](README.md)
- 🏗️ Check [ARCHITECTURE.md](ARCHITECTURE.md) for system design
- 🤝 See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute
- 🎨 Customize presets in `apps/api/src/config/presets.ts`
- 🧪 Run tests (coming soon)

## Advanced Configuration

### Custom Terrain Provider

Want to use your own DEM instead of Cesium World Terrain?

Edit `apps/web/src/components/CesiumViewer.tsx`:

```typescript
// Replace Cesium World Terrain with custom
const terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
  'https://your-terrain-server.com/tiles',
  {
    requestWaterMask: true,
    requestVertexNormals: true,
  }
);
```

### NDVI Date Range

The default is last 30 days. To customize:

Edit `apps/web/src/components/CesiumViewer.tsx` around line 408:

```typescript
// Change from 30 to 90 days
const fromDate = new Date(toDate.getTime() - 90 * 24 * 60 * 60 * 1000);
```

### Timeout Configuration

Edit `apps/web/src/components/CesiumViewer.tsx` around line 27:

```typescript
const TIMEOUTS = {
  TERRAIN: 12000,  // Increase if slow connection
  IMAGERY: 12000,
  NDVI: 15000,
  API_HEALTH: 5000,
};
```

Enjoy building geospatial twins! 🌍🚀

