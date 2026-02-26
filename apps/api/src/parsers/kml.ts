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

  // Ensure the polygon is closed (first point === last point)
  const firstCoord = coords[0];
  const lastCoord = coords[coords.length - 1];
  if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
    coords.push([firstCoord[0], firstCoord[1]]);
  }

  return {
    type: 'Polygon',
    coordinates: [coords], // Must be array of rings
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
