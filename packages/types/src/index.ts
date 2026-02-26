/**
 * Style presets for the GeoTwin viewer
 */
export type StylePreset = 'mountain' | 'dehesa' | 'mediterranean';

/**
 * Layer types available in the GeoTwin
 */
export type LayerType = 'parcel' | 'extrusion' | 'ndvi_demo' | 'water_demo' | 'roi_demo' | 'plinth' | 'oak_trees';

/**
 * GeoJSON geometry types
 */
export interface GeoJSONGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

/**
 * Camera configuration for Cesium viewer
 */
export interface CameraConfig {
  longitude: number;
  latitude: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
}

/**
 * Bounding box [west, south, east, north]
 */
export type BBox = [number, number, number, number];

/**
 * Point [longitude, latitude]
 */
export type Point = [number, number];

/**
 * Color configuration in RGBA
 */
export interface ColorConfig {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Material configuration for rendering
 */
export interface MaterialConfig {
  color: ColorConfig;
  opacity: number;
  outlineColor?: ColorConfig;
  outlineWidth?: number;
}

/**
 * Heatmap configuration for NDVI layer
 */
export interface HeatmapConfig {
  enabled: boolean;
  intensity: number;
  colorStops: Array<{ value: number; color: ColorConfig }>;
}

/**
 * Point of interest configuration
 */
export interface POIConfig {
  id: string;
  position: Point;
  label: string;
  value?: string;
  icon?: string;
  scale?: number;
}

/**
 * Layer configuration for a specific data layer
 */
export interface LayerConfig {
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

/**
 * Preset-specific visual configuration
 */
export interface PresetConfig {
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
  markers?: {
    type: string;
    count: number;
    icon: string;
    scale: number;
  };
  ndviIntensity?: number;
  waterPointsScale?: number;
  labelStyle?: {
    fillColor: ColorConfig;
    outlineColor: ColorConfig;
  };
}

/**
 * Complete Twin Recipe returned by API
 */
export interface TwinRecipe {
  twinId: string;
  preset: StylePreset;
  createdAt: string;
  
  // Geometry
  centroid: Point;
  bbox: BBox;
  area_ha: number;
  
  // Camera defaults
  camera: CameraConfig;
  
  // Preset configuration
  presetConfig: PresetConfig;
  
  // Layer configurations
  layers: LayerConfig[];
  
  // Geometry reference
  geometryPath: string;
  
  // === PHASE 2 EXTENSIONS (optional) ===
  
  // IoT sensor nodes
  sensors?: Array<{
    id: string;
    type: 'TEMPERATURE' | 'NH3' | 'CO2' | 'MOISTURE' | 'WEIGHT';
    lat: number;
    lon: number;
    value: number;
    unit: string;
    status: 'ok' | 'warning' | 'error';
    lastUpdate: string;
  }>;
  
  // Cattle GPS tracking
  cattle?: Array<{
    id: string;
    lat: number;
    lon: number;
    weight: number;
    collarId: string;
    health: 'good' | 'attention' | 'alert';
  }>;
  
  // Infrastructure elements (buildings, fences, silos)
  infrastructure?: Array<{
    id: string;
    type: 'BARN' | 'SILO' | 'WATER_POINT' | 'FENCE';
    geometry: any; // GeoJSON Feature
    height?: number;
  }>;
  
  // Environmental/ESG metrics
  esg?: {
    co2eq_ton_year: number;
    ndvi_mean: number;
    carbon_credits_potential: number;
  };
}

/**
 * API request for importing cadastral file
 */
export interface ImportRequest {
  preset: StylePreset;
}

/**
 * API response for import
 */
export interface ImportResponse {
  success: boolean;
  twinId?: string;
  recipe?: TwinRecipe;
  error?: string;
}

/**
 * NDVI grid cell for demo layer
 */
export interface NDVICell {
  polygon: number[][];
  value: number; // 0-1
}

/**
 * Generated demo data
 */
export interface DemoData {
  ndviGrid: NDVICell[];
  waterPoints: POIConfig[];
  roiLabels: POIConfig[];
}
