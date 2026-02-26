import { nanoid } from 'nanoid';
import area from '@turf/area';
import bbox from '@turf/bbox';
import centroid from '@turf/centroid';
import { polygon } from '@turf/helpers';
import type {
  GeoJSONGeometry,
  StylePreset,
  TwinRecipe,
  LayerConfig,
  CameraConfig,
  Point,
  BBox,
} from '@geotwin/types';
import { getPresetConfig } from '../config/presets.js';
import { generateDemoLayers } from './demo-generator.js';

/**
 * Generate a complete Twin Recipe from geometry and preset
 */
export async function generateTwinRecipe(
  geometry: GeoJSONGeometry,
  preset: StylePreset
): Promise<TwinRecipe> {
  const twinId = nanoid(10);

  // Validate geometry structure
  if (!geometry || !geometry.coordinates || !Array.isArray(geometry.coordinates)) {
    throw new Error(`Invalid geometry: coordinates missing or not an array`);
  }

  if (!geometry.coordinates[0] || !Array.isArray(geometry.coordinates[0])) {
    throw new Error(`Invalid geometry: coordinates[0] missing or not an array`);
  }

  // Convert to Turf polygon
  const poly = polygon(geometry.coordinates as number[][][]);

  // Calculate metrics
  const calculatedArea = area(poly);
  const area_ha = calculatedArea / 10000; // Convert m² to hectares

  const bboxArray = bbox(poly) as BBox;
  const centroidPoint = centroid(poly);
  const centroidCoords = centroidPoint.geometry.coordinates as Point;

  // [STEP 1.3 DIAGNOSTIC LOGGING] Track coordinate flow through pipeline
  console.log('[KML Parse] First coordinate WGS84:', geometry.coordinates[0][0]);
  console.log('[KML Parse] Bounding box:', {
    minLon: bboxArray[0],
    minLat: bboxArray[1],
    maxLon: bboxArray[2],
    maxLat: bboxArray[3],
  });
  console.log('[KML Parse] Centroid WGS84:', centroidCoords);
  console.log('[KML Parse] Estimated area ha:', area_ha.toFixed(2));

  // Calculate camera position
  const camera: CameraConfig = {
    longitude: centroidCoords[0],
    latitude: centroidCoords[1],
    height: Math.max(1000, area_ha * 50), // Scale based on area
    heading: 0,
    pitch: -45,
    roll: 0,
  };

  // Get preset configuration
  const presetConfig = getPresetConfig(preset);

  // Generate demo layers (pass preset for oak trees in dehesa)
  const demoLayers = await generateDemoLayers(twinId, geometry, centroidCoords, preset);

  // Build layer configurations
  const layers: LayerConfig[] = [
    {
      id: 'parcel',
      name: 'Parcel Boundary',
      enabled: true,
      visible: true,
      material: {
        color: { r: 0, g: 255, b: 255, a: 255 },
        opacity: 0.3,
        outlineColor: { r: 0, g: 255, b: 255, a: 255 },
        outlineWidth: 3,
      },
      zIndex: 1,
    },
    {
      id: 'extrusion',
      name: 'Parcel Extrusion',
      enabled: false,
      visible: false,
      material: {
        color: { r: 100, g: 200, b: 100, a: 200 },
        opacity: 0.6,
      },
      extrusionHeight: 10,
      zIndex: 0,
    },
    {
      id: 'ndvi_demo',
      name: 'NDVI Heatmap (Demo)',
      enabled: true,
      visible: true,
      heatmap: {
        enabled: true,
        intensity: 0.7,
        colorStops: [
          { value: 0, color: { r: 139, g: 69, b: 19, a: 200 } }, // Brown
          { value: 0.3, color: { r: 255, g: 255, b: 0, a: 200 } }, // Yellow
          { value: 0.6, color: { r: 144, g: 238, b: 144, a: 200 } }, // Light green
          { value: 1.0, color: { r: 0, g: 128, b: 0, a: 200 } }, // Dark green
        ],
      },
      zIndex: 2,
    },
    {
      id: 'water_demo',
      name: 'Water Points (Demo)',
      enabled: true,
      visible: true,
      points: demoLayers.waterPoints,
      zIndex: 3,
    },
    {
      id: 'roi_demo',
      name: 'ROI Labels (Demo)',
      enabled: true,
      visible: true,
      points: demoLayers.roiLabels,
      zIndex: 4,
    },
  ];

  // Add oak trees layer for dehesa preset
  if (demoLayers.oakTrees && demoLayers.oakTrees.length > 0) {
    layers.push({
      id: 'oak_trees',
      name: 'Oak Trees',
      enabled: true,
      visible: true,
      points: demoLayers.oakTrees,
      zIndex: 5,
    });
  }

  // Add plinth layer for tile mode
  layers.push({
    id: 'plinth',
    name: 'Tile Plinth',
    enabled: false,
    visible: false,
    material: {
      color: presetConfig.plinthColor || { r: 150, g: 150, b: 150, a: 230 },
      opacity: 0.9,
    },
    extrusionHeight: -15, // Negative for downward extrusion
    zIndex: -1,
  });

  const recipe: TwinRecipe = {
    twinId,
    preset,
    createdAt: new Date().toISOString(),
    centroid: centroidCoords,
    bbox: bboxArray,
    area_ha: parseFloat(area_ha.toFixed(2)),
    camera,
    presetConfig,
    layers,
    geometryPath: `/api/twin/${twinId}/geometry`,
  };

  return recipe;
}
