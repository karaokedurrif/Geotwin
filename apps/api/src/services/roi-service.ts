import { createHash } from 'crypto';
import bbox from '@turf/bbox';
import centroid from '@turf/centroid';
import buffer from '@turf/buffer';
import { polygon } from '@turf/helpers';
import type { GeoJSONGeometry } from '@geotwin/types';

export interface ROI {
  id: string;
  geometry: GeoJSONGeometry;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  centroid: [number, number]; // [lon, lat]
  bufferedBbox: [number, number, number, number];
  bufferMeters: number;
  area_m2: number;
  createdAt: string;
}

const roiCache = new Map<string, ROI>();

/**
 * Generate a stable ROI ID from geometry
 */
function generateROIId(geometry: GeoJSONGeometry): string {
  const hash = createHash('md5')
    .update(JSON.stringify(geometry))
    .digest('hex');
  return `roi_${hash.substring(0, 12)}`;
}

/**
 * Create or retrieve an ROI from geometry
 * @param geometry - GeoJSON geometry (must be Polygon or MultiPolygon in EPSG:4326)
 * @param bufferMeters - Buffer distance in meters for extended ROI
 */
export function createROI(
  geometry: GeoJSONGeometry,
  bufferMeters: number = 100
): ROI {
  const roiId = generateROIId(geometry);

  // Check cache first
  if (roiCache.has(roiId)) {
    const cached = roiCache.get(roiId)!;
    // Update buffer if different
    if (cached.bufferMeters !== bufferMeters) {
      // Recalculate buffered bbox
      const buffered = buffer(polygon(geometry.coordinates as number[][][]), bufferMeters / 1000, {
        units: 'kilometers',
      });
      const bufferedBbox = bbox(buffered) as [number, number, number, number];
      cached.bufferedBbox = bufferedBbox;
      cached.bufferMeters = bufferMeters;
    }
    return cached;
  }

  // Calculate bbox
  const bboxArray = bbox(geometry) as [number, number, number, number];

  // Calculate centroid
  const centroidFeature = centroid(geometry);
  const centroidCoords = centroidFeature.geometry.coordinates as [number, number];

  // Calculate buffered bbox
  const bufferedGeometry = buffer(polygon(geometry.coordinates as number[][][]), bufferMeters / 1000, {
    units: 'kilometers',
  });
  const bufferedBbox = bbox(bufferedGeometry) as [number, number, number, number];

  // Approximate area calculation (rough for small parcels)
  const width = bboxArray[2] - bboxArray[0];
  const height = bboxArray[3] - bboxArray[1];
  const area_m2 = Math.abs(width * height * 111000 * 111000);

  const roi: ROI = {
    id: roiId,
    geometry,
    bbox: bboxArray,
    centroid: centroidCoords,
    bufferedBbox,
    bufferMeters,
    area_m2,
    createdAt: new Date().toISOString(),
  };

  roiCache.set(roiId, roi);
  return roi;
}

/**
 * Get ROI by ID
 */
export function getROI(roiId: string): ROI | null {
  return roiCache.get(roiId) || null;
}

/**
 * Get all cached ROIs
 */
export function getAllROIs(): ROI[] {
  return Array.from(roiCache.values());
}

/**
 * Clear ROI cache (for testing)
 */
export function clearROICache(): void {
  roiCache.clear();
}
