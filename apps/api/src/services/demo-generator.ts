import squareGrid from '@turf/square-grid';
import bbox from '@turf/bbox';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { polygon, point } from '@turf/helpers';
import type {
  GeoJSONGeometry,
  Point,
  POIConfig,
  DemoData,
} from '@geotwin/types';

/**
 * Generate demo layers (NDVI, water points, ROI labels, oak trees for dehesa)
 */
export async function generateDemoLayers(
  twinId: string,
  geometry: GeoJSONGeometry,
  centroid: Point,
  preset?: string
): Promise<DemoData & { oakTrees?: POIConfig[] }> {
  const poly = polygon(geometry.coordinates as number[][][]);

  // Generate NDVI grid
  const ndviGrid = generateNDVIGrid(twinId, poly);

  // Generate water points
  const waterPoints = generateWaterPoints(twinId, poly, centroid);

  // Generate ROI labels
  const roiLabels = generateROILabels(centroid);

  // Generate oak trees for dehesa preset
  const oakTrees = preset === 'dehesa' ? generateOakTrees(twinId, poly, centroid) : undefined;

  return {
    ndviGrid,
    waterPoints,
    roiLabels,
    oakTrees,
  };
}

/**
 * Generate pseudo-NDVI grid
 */
function generateNDVIGrid(twinId: string, poly: any) {
  const bboxArray = bbox(poly);
  const cellSide = Math.min(
    (bboxArray[2] - bboxArray[0]) / 10, // Max 10 cells wide
    0.001 // Min cell size
  );

  const grid = squareGrid(bboxArray as [number, number, number, number], cellSide, {
    units: 'degrees',
  });

  // Use twinId as seed for consistent random values
  const seed = hashCode(twinId);
  const rng = seededRandom(seed);

  const cells = grid.features
    .filter((cell) => {
      // Keep cells that intersect with polygon
      // Calculate centroid from cell coordinates instead of bbox
      const cellCoords = cell.geometry.coordinates[0];
      if (!cellCoords || cellCoords.length === 0) return false;
      
      const lons = cellCoords.map((coord: number[]) => coord[0]);
      const lats = cellCoords.map((coord: number[]) => coord[1]);
      const cellCentroid = [
        (Math.min(...lons) + Math.max(...lons)) / 2,
        (Math.min(...lats) + Math.max(...lats)) / 2
      ];
      
      return booleanPointInPolygon(point(cellCentroid), poly);
    })
    .slice(0, 50) // Limit to 50 cells
    .map((cell) => ({
      polygon: cell.geometry.coordinates[0],
      value: rng(), // Random NDVI value 0-1
    }));

  return cells;
}

/**
 * Generate demo water points
 */
function generateWaterPoints(twinId: string, poly: any, centroid: Point): POIConfig[] {
  const seed = hashCode(twinId + '_water');
  const rng = seededRandom(seed);
  const bboxArray = bbox(poly);

  const points: POIConfig[] = [];
  const numPoints = 2 + Math.floor(rng() * 3); // 2-4 points

  for (let i = 0; i < numPoints; i++) {
    // Generate random point near centroid
    const offsetLon = (rng() - 0.5) * (bboxArray[2] - bboxArray[0]) * 0.3;
    const offsetLat = (rng() - 0.5) * (bboxArray[3] - bboxArray[1]) * 0.3;

    points.push({
      id: `water_${i}`,
      position: [centroid[0] + offsetLon, centroid[1] + offsetLat],
      label: `Water Point ${i + 1}`,
      icon: '💧',
      scale: 1.5,
    });
  }

  return points;
}

/**
 * Generate ROI labels
 */
function generateROILabels(centroid: Point): POIConfig[] {
  return [
    {
      id: 'roi_payback',
      position: [centroid[0] - 0.0002, centroid[1] + 0.0002],
      label: 'Payback',
      value: '8.5 years',
      icon: '💰',
      scale: 1.2,
    },
    {
      id: 'roi_npv',
      position: [centroid[0] + 0.0002, centroid[1] + 0.0002],
      label: 'NPV',
      value: '€125k',
      icon: '📈',
      scale: 1.2,
    },
    {
      id: 'roi_irr',
      position: [centroid[0], centroid[1] - 0.0002],
      label: 'IRR',
      value: '12.3%',
      icon: '📊',
      scale: 1.2,
    },
  ];
}

/**
 * Simple hash function for string
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Seeded random number generator
 */
function seededRandom(seed: number) {
  let state = seed;
  return function () {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

/**
 * Generate oak trees using Poisson-disc sampling for dehesa
 */
function generateOakTrees(twinId: string, poly: any, centroid: Point): POIConfig[] {
  const seed = hashCode(twinId + '_oaks');
  const rng = seededRandom(seed);
  const bboxArray = bbox(poly);
  
  // Calculate area to determine tree count
  const width = bboxArray[2] - bboxArray[0];
  const height = bboxArray[3] - bboxArray[1];
  const area = width * height * 111000 * 111000; // Rough m² conversion
  
  // Target: 80-250 trees depending on area (sparse distribution)
  const targetCount = Math.min(250, Math.max(80, Math.floor(area / 500)));
  const minDistance = Math.min(width, height) / 15; // Minimum separation
  
  const trees: POIConfig[] = [];
  const maxAttempts = targetCount * 10;
  let attempts = 0;
  
  while (trees.length < targetCount && attempts < maxAttempts) {
    attempts++;
    
    // Generate random position within bbox
    const lon = bboxArray[0] + rng() * width;
    const lat = bboxArray[1] + rng() * height;
    const testPoint = point([lon, lat]);
    
    // Check if inside polygon
    if (!booleanPointInPolygon(testPoint, poly)) continue;
    
    // Check minimum distance from existing trees
    const tooClose = trees.some((tree) => {
      const dx = tree.position[0] - lon;
      const dy = tree.position[1] - lat;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist < minDistance;
    });
    
    if (tooClose) continue;
    
    // Add tree with slight scale variation
    trees.push({
      id: `oak_${trees.length}`,
      position: [lon, lat],
      label: '', // No label for trees
      icon: '🌳',
      scale: 1.0 + (rng() - 0.5) * 0.4, // 0.8 to 1.2 scale variation
    });
  }
  
  return trees;
}

