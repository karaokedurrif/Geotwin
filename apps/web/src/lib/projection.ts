/**
 * Coordinate projection utilities for KML parsing
 * Handles CRS detection and reprojection to WGS84 (EPSG:4326)
 */

// Common CRS definitions for Spain (legacy - see reprojectKml.ts for active usage)
// If proj4 is not available, we'll use simple transformations
// const CRS_DEFINITIONS: Record<string, string> = {
//   'EPSG:4326': '+proj=longlat +datum=WGS84 +no_defs',
//   'EPSG:25829': '+proj=utm +zone=29 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', // ETRS89 UTM 29N
//   'EPSG:25830': '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', // ETRS89 UTM 30N
//   'EPSG:25831': '+proj=utm +zone=31 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', // ETRS89 UTM 31N
//   'EPSG:23029': '+proj=utm +zone=29 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs', // ED50 UTM 29N
//   'EPSG:23030': '+proj=utm +zone=30 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs', // ED50 UTM 30N
//   'EPSG:23031': '+proj=utm +zone=31 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs', // ED50 UTM 31N
// };

export interface CoordinateInfo {
  detectedCRS: string;
  isProjected: boolean;
  needsReprojection: boolean;
  utmZone?: number;
  datum?: string;
}

/**
 * Detect CRS from coordinate values
 * - WGS84: lon in [-180, 180], lat in [-90, 90]
 * - UTM: easting in [166000, 834000], northing in [0, 10000000]
 * - Spanish UTM zones: 28-31 (Canarias and Peninsula)
 */
export function detectCRSFromCoordinates(coordinates: number[][]): CoordinateInfo {
  if (coordinates.length === 0) {
    return {
      detectedCRS: 'EPSG:4326',
      isProjected: false,
      needsReprojection: false,
    };
  }

  // Sample first few coordinates
  const samples = coordinates.slice(0, Math.min(10, coordinates.length));
  
  // Calculate ranges
  const lons = samples.map(c => c[0]);
  const lats = samples.map(c => c[1]);
  
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  // Check if values are in WGS84 range
  const isWGS84 = 
    minLon >= -180 && maxLon <= 180 &&
    minLat >= -90 && maxLat <= 90 &&
    Math.abs(minLon) < 20 && Math.abs(maxLon) < 20; // Spain is roughly -10 to 5 lon

  if (isWGS84) {
    return {
      detectedCRS: 'EPSG:4326',
      isProjected: false,
      needsReprojection: false,
      datum: 'WGS84',
    };
  }

  // Check if values look like UTM
  const isUTM =
    minLon > 100000 && maxLon < 900000 && // Easting range
    minLat > 4000000 && maxLat < 5000000; // Northing range for Spain (roughly 36-44°N)

  if (isUTM) {
    // Detect UTM zone from easting
    // Central meridian: zone 29: -9°, zone 30: -3°, zone 31: 3°
    const avgEasting = (minLon + maxLon) / 2;
    
    let utmZone = 30; // Default for central Spain
    if (avgEasting < 300000) {
      utmZone = 29; // Western Spain
    } else if (avgEasting > 600000) {
      utmZone = 31; // Eastern Spain
    }

    // Assume ETRS89 for modern cadastral data (post-2007)
    return {
      detectedCRS: `EPSG:258${utmZone}`,
      isProjected: true,
      needsReprojection: true,
      utmZone,
      datum: 'ETRS89',
    };
  }

  // Default fallback
  console.warn('Could not detect CRS from coordinates, assuming WGS84');
  return {
    detectedCRS: 'EPSG:4326',
    isProjected: false,
    needsReprojection: false,
  };
}

/**
 * Simplified UTM to WGS84 conversion (approximate)
 * For production, use proj4js library
 */
function utmToWGS84Approximate(
  easting: number,
  northing: number,
  zone: number
): [number, number] {
  // This is a simplified conversion - for production use proj4js
  const k0 = 0.9996;
  const a = 6378137.0; // WGS84 semi-major axis
  const e = 0.081819191; // WGS84 eccentricity

  const falseEasting = 500000;
  const falseNorthing = 0;

  const x = easting - falseEasting;
  const y = northing - falseNorthing;

  const M = y / k0;
  const mu = M / (a * (1 - e * e / 4 - 3 * e * e * e * e / 64));

  const lat = mu +
    (3 * e / 2 - 27 * e * e * e / 32) * Math.sin(2 * mu) +
    (21 * e * e / 16 - 55 * e * e * e * e / 32) * Math.sin(4 * mu);

  const N = a / Math.sqrt(1 - e * e * Math.sin(lat) * Math.sin(lat));
  const lon0 = (zone - 1) * 6 - 180 + 3; // Central meridian

  const lon = lon0 + (x / (N * k0 * Math.cos(lat))) * (180 / Math.PI);
  const latDeg = lat * (180 / Math.PI);

  return [lon, latDeg];
}

/**
 * Reproject coordinates from detected CRS to WGS84
 */
export function reprojectToWGS84(
  coordinates: number[][],
  fromCRS: string
): number[][] {
  if (fromCRS === 'EPSG:4326') {
    return coordinates; // Already WGS84
  }

  // Extract UTM zone for ETRS89
  const utmMatch = fromCRS.match(/EPSG:258(\d{2})/);
  if (utmMatch) {
    const zone = parseInt(utmMatch[1], 10);
    return coordinates.map(coord => {
      const [lon, lat] = utmToWGS84Approximate(coord[0], coord[1], zone);
      return [lon, lat, coord[2] || 0]; // Preserve elevation if present
    });
  }

  // If we can't reproject, return original (fallback)
  console.warn(`Cannot reproject from ${fromCRS}, returning original coordinates`);
  return coordinates;
}

/**
 * Validate coordinates are within reasonable bounds for Spain
 */
export function validateSpanishCoordinates(coordinates: number[][]): {
  valid: boolean;
  message: string;
  bbox?: [number, number, number, number];
} {
  if (coordinates.length === 0) {
    return { valid: false, message: 'No coordinates provided' };
  }

  const lons = coordinates.map(c => c[0]);
  const lats = coordinates.map(c => c[1]);

  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  // Spain bounds (including Canarias)
  const spainBounds = {
    minLon: -18.5, // Canary Islands
    maxLon: 4.5,   // Eastern Spain
    minLat: 27.5,  // Canary Islands
    maxLat: 43.8,  // Northern Spain
  };

  const isInSpain =
    minLon >= spainBounds.minLon && maxLon <= spainBounds.maxLon &&
    minLat >= spainBounds.minLat && maxLat <= spainBounds.maxLat;

  if (!isInSpain) {
    return {
      valid: false,
      message: `Coordinates outside Spain bounds: [${minLon.toFixed(4)}, ${minLat.toFixed(4)}, ${maxLon.toFixed(4)}, ${maxLat.toFixed(4)}]`,
      bbox: [minLon, minLat, maxLon, maxLat],
    };
  }

  return {
    valid: true,
    message: 'Coordinates valid for Spain',
    bbox: [minLon, minLat, maxLon, maxLat],
  };
}

/**
 * Parse and reproject KML coordinates automatically
 * Returns WGS84 coordinates with metadata
 */
export function parseAndReprojectKML(
  coordinates: number[][]
): {
  coordinates: number[][];
  crsInfo: CoordinateInfo;
  bbox: [number, number, number, number];
  centroid: [number, number];
  validation: ReturnType<typeof validateSpanishCoordinates>;
} {
  // Detect CRS
  const crsInfo = detectCRSFromCoordinates(coordinates);
  console.log(`[CRS] Detected: ${crsInfo.detectedCRS} (${crsInfo.datum || 'unknown'})`);

  // Reproject if needed
  let reprojected = coordinates;
  if (crsInfo.needsReprojection) {
    console.log(`[CRS] Reprojecting from ${crsInfo.detectedCRS} to EPSG:4326...`);
    reprojected = reprojectToWGS84(coordinates, crsInfo.detectedCRS);
  }

  // Validate
  const validation = validateSpanishCoordinates(reprojected);
  if (!validation.valid) {
    console.warn(`[CRS] Validation warning: ${validation.message}`);
  }

  // Calculate bbox
  const lons = reprojected.map(c => c[0]);
  const lats = reprojected.map(c => c[1]);
  const bbox: [number, number, number, number] = [
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ];

  // Calculate centroid
  const centroid: [number, number] = [
    (bbox[0] + bbox[2]) / 2,
    (bbox[1] + bbox[3]) / 2,
  ];

  console.log(`[CRS] Bbox: [${bbox.map(v => v.toFixed(6)).join(', ')}]`);
  console.log(`[CRS] Centroid: [${centroid.map(v => v.toFixed(6)).join(', ')}]`);

  return {
    coordinates: reprojected,
    crsInfo,
    bbox,
    centroid,
    validation,
  };
}
