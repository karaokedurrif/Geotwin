import type { MultipartFile } from '@fastify/multipart';
import { XMLParser } from 'fast-xml-parser';
import type { GeoJSONGeometry } from '@geotwin/types';

/**
 * Parse KML file and extract polygon coordinates
 */
export async function parseKML(file: MultipartFile): Promise<GeoJSONGeometry | null> {
  const buffer = await file.toBuffer();
  const xmlContent = buffer.toString('utf-8');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  const parsed = parser.parse(xmlContent);

  // Navigate KML structure to find coordinates
  const kml = parsed.kml || parsed.Document;
  if (!kml) {
    throw new Error('Invalid KML: missing kml or Document root');
  }

  const coords = extractCoordinatesFromKML(kml);
  
  if (!coords || coords.length === 0) {
    return null;
  }

  // Densify coordinates with adaptive spacing (auto-detects parcel size)
  // Ultra-small (< 20m): 0.2m spacing, Small (< 50m): 0.3m, Medium: 0.5m
  const densified = densifyCoordinates(coords);

  // Ensure the polygon is closed (first point === last point)
  const firstCoord = densified[0];
  const lastCoord = densified[densified.length - 1];
  if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
    densified.push([firstCoord[0], firstCoord[1]]);
  }

  return {
    type: 'Polygon',
    coordinates: [densified], // Must be array of rings
  };
}

/**
 * Recursively extract coordinates from KML structure
 */
function extractCoordinatesFromKML(obj: any): number[][] {
  if (typeof obj !== 'object' || obj === null) {
    return [];
  }

  // Check for coordinates string
  if (obj.coordinates && typeof obj.coordinates === 'string') {
    return parseKMLCoordinates(obj.coordinates);
  }

  // Recursively search nested objects
  for (const key in obj) {
    const result = extractCoordinatesFromKML(obj[key]);
    if (result.length > 0) {
      return result;
    }
  }

  return [];
}

/**
 * Parse KML coordinate string to array of [lon, lat] pairs
 */
function parseKMLCoordinates(coordString: string): number[][] {
  const coords = coordString
    .trim()
    .split(/\s+/)
    .map((coord) => {
      const parts = coord.split(',').map(parseFloat);
      return [parts[0], parts[1]]; // lon, lat (ignore elevation)
    })
    .filter((coord) => !isNaN(coord[0]) && !isNaN(coord[1]));

  return coords;
}

/**
 * Calculate approximate distance in meters between two WGS84 coordinates.
 * Uses Haversine formula for accuracy.
 */
function haversineDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => deg * Math.PI / 180;
  
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate polygon radius (approximate bounding circle)
 */
function calculatePolygonRadius(coords: number[][]): number {
  if (coords.length === 0) return 0;
  
  // Calculate centroid
  let sumLon = 0, sumLat = 0;
  for (const [lon, lat] of coords) {
    sumLon += lon;
    sumLat += lat;
  }
  const centroidLon = sumLon / coords.length;
  const centroidLat = sumLat / coords.length;
  
  // Find max distance from centroid
  let maxDist = 0;
  for (const [lon, lat] of coords) {
    const dist = haversineDistance(centroidLon, centroidLat, lon, lat);
    if (dist > maxDist) maxDist = dist;
  }
  
  return maxDist;
}

/**
 * Densify polygon coordinates by inserting intermediate vertices.
 * Adaptive spacing based on parcel size:
 * - Ultra-small parcels (< 20m radius): 0.2m spacing for maximum detail
 * - Small parcels (< 50m radius): 0.3m spacing
 * - Medium parcels: 0.5m spacing (default)
 * This prevents jagged edges from sparse DEM data (MDT05 = 5m resolution).
 */
function densifyCoordinates(coords: number[][], forceSpacing?: number): number[][] {
  if (coords.length < 2) return coords;
  
  // Calculate adaptive spacing if not forced
  let targetSpacing = 0.5; // Default for medium parcels
  let radius = 0;
  if (!forceSpacing) {
    radius = calculatePolygonRadius(coords);
    if (radius < 20) {
      targetSpacing = 0.2; // Ultra-small: aggressive densification
      console.log(`[KML Densify] Ultra-small parcel detected (radius=${radius.toFixed(1)}m) → using 0.2m vertex spacing`);
    } else if (radius < 50) {
      targetSpacing = 0.3; // Small: moderate densification
      console.log(`[KML Densify] Small parcel detected (radius=${radius.toFixed(1)}m) → using 0.3m vertex spacing`);
    } else {
      console.log(`[KML Densify] Medium parcel (radius=${radius.toFixed(1)}m) → using 0.5m vertex spacing`);
    }
  } else {
    targetSpacing = forceSpacing;
    console.log(`[KML Densify] Forced spacing: ${targetSpacing}m`);
  }
  
  const densified: number[][] = [];
  
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    
    densified.push([lon1, lat1]);
    
    const distance = haversineDistance(lon1, lat1, lon2, lat2);
    
    // Only densify if segment is longer than target spacing
    if (distance > targetSpacing) {
      const numSegments = Math.ceil(distance / targetSpacing);
      
      // Insert intermediate points
      for (let j = 1; j < numSegments; j++) {
        const t = j / numSegments;
        const lon = lon1 + (lon2 - lon1) * t;
        const lat = lat1 + (lat2 - lat1) * t;
        densified.push([lon, lat]);
      }
    }
  }
  
  // Add last point
  densified.push(coords[coords.length - 1]);
  
  console.log(`[KML Densify] Generated ${densified.length} vertices from ${coords.length} original (${(densified.length / coords.length).toFixed(1)}x increase)`);
  
  return densified;
}
