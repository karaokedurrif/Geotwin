import type { MultipartFile } from '@fastify/multipart';
import { XMLParser } from 'fast-xml-parser';
import type { GeoJSONGeometry } from '@geotwin/types';

/**
 * Parse GML file and extract polygon coordinates
 */
export async function parseGML(file: MultipartFile): Promise<GeoJSONGeometry | null> {
  const buffer = await file.toBuffer();
  const xmlContent = buffer.toString('utf-8');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  const parsed = parser.parse(xmlContent);

  // GML structure varies, search for common patterns
  const coords = extractCoordinatesFromGML(parsed);

  if (!coords || coords.length === 0) {
    return null;
  }

  return {
    type: 'Polygon',
    coordinates: [coords],
  };
}

/**
 * Recursively extract coordinates from GML structure
 */
function extractCoordinatesFromGML(obj: any): number[][] {
  if (typeof obj !== 'object' || obj === null) {
    return [];
  }

  // Check for posList (common in GML)
  if (obj.posList && typeof obj.posList === 'string') {
    return parseGMLPosList(obj.posList);
  }

  // Check for coordinates
  if (obj.coordinates && typeof obj.coordinates === 'string') {
    return parseGMLCoordinates(obj.coordinates);
  }

  // Check for pos (individual positions)
  if (obj.pos) {
    if (typeof obj.pos === 'string') {
      return [parseGMLPos(obj.pos)];
    } else if (Array.isArray(obj.pos)) {
      return obj.pos.map(parseGMLPos);
    }
  }

  // Recursively search nested objects
  for (const key in obj) {
    const result = extractCoordinatesFromGML(obj[key]);
    if (result.length > 0) {
      return result;
    }
  }

  return [];
}

/**
 * Parse GML posList to array of [lon, lat] pairs
 */
function parseGMLPosList(posList: string): number[][] {
  const values = posList.trim().split(/\s+/).map(parseFloat);
  const coords: number[][] = [];

  // posList format: x1 y1 x2 y2 ... (lon lat pairs)
  for (let i = 0; i < values.length; i += 2) {
    if (i + 1 < values.length) {
      coords.push([values[i], values[i + 1]]);
    }
  }

  return coords;
}

/**
 * Parse GML coordinates string
 */
function parseGMLCoordinates(coordString: string): number[][] {
  // Similar to KML format
  const coords = coordString
    .trim()
    .split(/\s+/)
    .map((coord) => {
      const parts = coord.split(',').map(parseFloat);
      return [parts[0], parts[1]];
    })
    .filter((coord) => !isNaN(coord[0]) && !isNaN(coord[1]));

  return coords;
}

/**
 * Parse single GML pos element
 */
function parseGMLPos(pos: string): number[] {
  const values = pos.trim().split(/\s+/).map(parseFloat);
  return [values[0], values[1]];
}
