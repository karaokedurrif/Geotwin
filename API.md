# API Reference

## Base URL

```
http://localhost:3001
```

## Authentication

None (MVP - add authentication for production)

## Endpoints

### Health Check

Get server status.

**Request**
```http
GET /health
```

**Response** `200 OK`
```json
{
  "status": "ok",
  "timestamp": "2026-02-18T10:30:00.000Z"
}
```

---

### Import Cadastral File

Upload a cadastral file and generate a Twin Recipe.

**Request**
```http
POST /api/import?preset={preset}
Content-Type: multipart/form-data

file: <binary>
```

**Query Parameters**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `preset` | string | No | `mountain` | Style preset: `mountain`, `dehesa`, or `mediterranean` |

**Response** `200 OK`
```json
{
  "success": true,
  "twinId": "Qx7mK9nP2w",
  "recipe": {
    "twinId": "Qx7mK9nP2w",
    "preset": "mountain",
    "createdAt": "2026-02-18T10:35:00.000Z",
    "centroid": [-4.1229, 40.9871],
    "bbox": [-4.123456, 40.986654, -4.122456, 40.987654],
    "area_ha": 1.23,
    "camera": {
      "longitude": -4.1229,
      "latitude": 40.9871,
      "height": 1500,
      "heading": 0,
      "pitch": -45,
      "roll": 0
    },
    "presetConfig": {
      "name": "mountain",
      "displayName": "Mountain",
      "description": "Cool tones, strong relief, rocky terrain",
      "terrain": {
        "terrainExaggeration": 2.0,
        "lightingIntensity": 1.2
      },
      "atmosphere": {
        "brightness": 0.9,
        "saturation": 0.85,
        "hueShift": -10
      },
      "groundTint": {
        "r": 180,
        "g": 190,
        "b": 200,
        "a": 0.3
      },
      "markers": {
        "type": "rock",
        "count": 15,
        "icon": "🏔️",
        "scale": 1.0
      }
    },
    "layers": [
      {
        "id": "parcel",
        "name": "Parcel Boundary",
        "enabled": true,
        "visible": true,
        "material": {
          "color": { "r": 0, "g": 255, "b": 255, "a": 255 },
          "opacity": 0.3,
          "outlineColor": { "r": 0, "g": 255, "b": 255, "a": 255 },
          "outlineWidth": 3
        },
        "zIndex": 1
      },
      {
        "id": "extrusion",
        "name": "Parcel Extrusion",
        "enabled": false,
        "visible": false,
        "material": {
          "color": { "r": 100, "g": 200, "b": 100, "a": 200 },
          "opacity": 0.6
        },
        "extrusionHeight": 10,
        "zIndex": 0
      },
      {
        "id": "ndvi_demo",
        "name": "NDVI Heatmap (Demo)",
        "enabled": true,
        "visible": true,
        "heatmap": {
          "enabled": true,
          "intensity": 0.7,
          "colorStops": [
            { "value": 0, "color": { "r": 139, "g": 69, "b": 19, "a": 200 } },
            { "value": 0.3, "color": { "r": 255, "g": 255, "b": 0, "a": 200 } },
            { "value": 0.6, "color": { "r": 144, "g": 238, "b": 144, "a": 200 } },
            { "value": 1.0, "color": { "r": 0, "g": 128, "b": 0, "a": 200 } }
          ]
        },
        "zIndex": 2
      },
      {
        "id": "water_demo",
        "name": "Water Points (Demo)",
        "enabled": true,
        "visible": true,
        "points": [
          {
            "id": "water_0",
            "position": [-4.12291, 40.98715],
            "label": "Water Point 1",
            "icon": "💧",
            "scale": 1.5
          }
        ],
        "zIndex": 3
      },
      {
        "id": "roi_demo",
        "name": "ROI Labels (Demo)",
        "enabled": true,
        "visible": true,
        "points": [
          {
            "id": "roi_payback",
            "position": [-4.12309, 40.98732],
            "label": "Payback",
            "value": "8.5 years",
            "icon": "💰",
            "scale": 1.2
          },
          {
            "id": "roi_npv",
            "position": [-4.12271, 40.98732],
            "label": "NPV",
            "value": "€125k",
            "icon": "📈",
            "scale": 1.2
          },
          {
            "id": "roi_irr",
            "position": [-4.1229, 40.98688],
            "label": "IRR",
            "value": "12.3%",
            "icon": "📊",
            "scale": 1.2
          }
        ],
        "zIndex": 4
      }
    ],
    "geometryPath": "/api/twin/Qx7mK9nP2w/geometry"
  }
}
```

**Error Response** `400 Bad Request`
```json
{
  "success": false,
  "error": "No file uploaded"
}
```

**Error Response** `500 Internal Server Error`
```json
{
  "success": false,
  "error": "Could not parse geometry from file"
}
```

**Examples**

```bash
# Upload KML with mountain preset
curl -X POST \
  'http://localhost:3001/api/import?preset=mountain' \
  -F 'file=@parcel.kml'

# Upload GML with dehesa preset
curl -X POST \
  'http://localhost:3001/api/import?preset=dehesa' \
  -F 'file=@parcel.gml'

# Upload ZIP with mediterranean preset
curl -X POST \
  'http://localhost:3001/api/import?preset=mediterranean' \
  -F 'file=@parcel.zip'
```

---

### Get Twin Recipe

Retrieve a previously created Twin Recipe.

**Request**
```http
GET /api/twin/:twinId
```

**Path Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `twinId` | string | Twin identifier (returned from import) |

**Response** `200 OK`
```json
{
  "success": true,
  "recipe": {
    // Same structure as import response
  }
}
```

**Error Response** `404 Not Found`
```json
{
  "success": false,
  "error": "Twin not found"
}
```

**Example**
```bash
curl http://localhost:3001/api/twin/Qx7mK9nP2w
```

---

### Get Twin Geometry

Retrieve the GeoJSON geometry for a twin.

**Request**
```http
GET /api/twin/:twinId/geometry
```

**Path Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `twinId` | string | Twin identifier |

**Response** `200 OK`
```json
{
  "type": "Feature",
  "properties": {
    "twinId": "Qx7mK9nP2w",
    "area_ha": 1.23
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      [
        [-4.123456, 40.987654],
        [-4.122456, 40.987654],
        [-4.122456, 40.986654],
        [-4.123456, 40.986654],
        [-4.123456, 40.987654]
      ]
    ]
  }
}
```

**Error Response** `404 Not Found`
```json
{
  "success": false,
  "error": "Geometry not found"
}
```

**Example**
```bash
curl http://localhost:3001/api/twin/Qx7mK9nP2w/geometry
```

---

## Data Models

### TwinRecipe

Complete twin configuration returned by `/api/import`.

```typescript
interface TwinRecipe {
  twinId: string;
  preset: 'mountain' | 'dehesa' | 'mediterranean';
  createdAt: string; // ISO 8601
  centroid: [number, number]; // [longitude, latitude]
  bbox: [number, number, number, number]; // [west, south, east, north]
  area_ha: number;
  camera: CameraConfig;
  presetConfig: PresetConfig;
  layers: LayerConfig[];
  geometryPath: string; // API path to geometry
}
```

### LayerConfig

Configuration for a single data layer.

```typescript
interface LayerConfig {
  id: 'parcel' | 'extrusion' | 'ndvi_demo' | 'water_demo' | 'roi_demo';
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

### PresetConfig

Visual style configuration.

```typescript
interface PresetConfig {
  name: 'mountain' | 'dehesa' | 'mediterranean';
  displayName: string;
  description: string;
  terrain: {
    terrainExaggeration: number;
    lightingIntensity: number;
  };
  atmosphere: {
    brightness: number;
    saturation: number;
    hueShift: number;
  };
  groundTint: ColorConfig;
  markers?: {
    type: string;
    count: number;
    icon: string;
    scale: number;
  };
}
```

### POIConfig

Point of interest (used for water points and ROI labels).

```typescript
interface POIConfig {
  id: string;
  position: [number, number]; // [longitude, latitude]
  label: string;
  value?: string;
  icon?: string;
  scale?: number;
}
```

---

## Rate Limits

**MVP**: No rate limits

**Production**: Implement rate limiting per IP/user

---

## CORS

**MVP**: All origins allowed

**Production**: Restrict to specific domains

```typescript
await fastify.register(cors, {
  origin: ['https://yourdomain.com'],
});
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad Request (invalid input) |
| 404 | Not Found (twin doesn't exist) |
| 500 | Internal Server Error |

---

## File Formats

### Supported Formats

- **KML**: Keyhole Markup Language (Google Earth format)
- **GML**: Geography Markup Language (OGC standard)
- **ZIP**: Archive containing KML or GML

### Coordinate System

All geometries must be in **WGS84 (EPSG:4326)**.

- Longitude: -180 to 180
- Latitude: -90 to 90

### Geometry Types

Supported: `Polygon`, `MultiPolygon`

Not supported (MVP): `Point`, `LineString`, `MultiPoint`, `MultiLineString`

---

## WebSocket Support

**Not available in MVP**

Future: Real-time updates for collaborative editing.

---

## Batch Operations

**Not available in MVP**

Future: Upload multiple files in one request.

---

## Changelog

### v0.1.0 (MVP)
- Initial release
- KML, GML, ZIP parsing
- Three style presets
- Demo layers (NDVI, water, ROI)
- Local storage

---

For complete type definitions, see [`packages/types/src/index.ts`](../packages/types/src/index.ts).
