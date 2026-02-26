/**
 * Coordinate reprojection utilities for GeoTwin
 * Detects CRS from coordinate values and reprojects UTM to WGS84 using proj4
 */

import proj4 from 'proj4';

// ===== TYPE DEFINITIONS =====

export interface CRSInfo {
  epsg: string;
  name: string;
  isProjected: boolean;
  zone?: number;
  hemisphere?: 'N' | 'S';
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface GeoBounds {
  bbox: BBox;
  centroid: [number, number]; // [lon, lat]
  width: number;  // degrees
  height: number; // degrees
}

export interface ReprojectionResult {
  coordinates: number[][];
  crsInfo: CRSInfo;
  bounds: GeoBounds;
  wasReprojected: boolean;
  validationPassed: boolean;
  warnings: string[];
}

// ===== CRS DEFINITIONS =====

// Define common Spanish CRS systems
proj4.defs([
  // ETRS89 UTM zones (modern Spanish cadastre, post-2007)
  ['EPSG:25828', '+proj=utm +zone=28 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:25829', '+proj=utm +zone=29 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:25830', '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:25831', '+proj=utm +zone=31 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'],
  
  // WGS84 UTM zones (GPS, international)
  ['EPSG:32628', '+proj=utm +zone=28 +datum=WGS84 +units=m +no_defs +type=crs'],
  ['EPSG:32629', '+proj=utm +zone=29 +datum=WGS84 +units=m +no_defs +type=crs'],
  ['EPSG:32630', '+proj=utm +zone=30 +datum=WGS84 +units=m +no_defs +type=crs'],
  ['EPSG:32631', '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs +type=crs'],
  
  // ED50 UTM zones (legacy Spanish data, pre-2007)
  ['EPSG:23028', '+proj=utm +zone=28 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:23029', '+proj=utm +zone=29 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:23030', '+proj=utm +zone=30 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:23031', '+proj=utm +zone=31 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs +type=crs'],
  
  // WGS84 geographic (standard GPS)
  ['EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs +type=crs'],
]);

// ===== CRS DETECTION =====

/**
 * Detect CRS from coordinate values
 * Strategy:
 * 1. Check if values are in lon/lat range (-180 to 180, -90 to 90)
 * 2. Check if values are in UTM range (easting 100k-900k, northing 0-10M)
 * 3. Determine UTM zone from easting/location
 */
export function detectCRS(coordinates: number[][]): CRSInfo {
  if (coordinates.length === 0) {
    return {
      epsg: 'EPSG:4326',
      name: 'WGS84 Geographic',
      isProjected: false,
    };
  }

  // Sample first 10 coordinates to determine range
  const samples = coordinates.slice(0, Math.min(10, coordinates.length));
  
  const xs = samples.map(c => c[0]);
  const ys = samples.map(c => c[1]);
  
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Test 1: Are these geographic coordinates (lon/lat)?
  const isGeographic = 
    minX >= -180 && maxX <= 180 &&
    minY >= -90 && maxY <= 90 &&
    Math.abs(maxX - minX) < 10 && // Reasonable parcel size in degrees
    Math.abs(maxY - minY) < 10;

  if (isGeographic) {
    return {
      epsg: 'EPSG:4326',
      name: 'WGS84 Geographic',
      isProjected: false,
    };
  }

  // Test 2: Are these UTM coordinates (meters)?
  const isUTM =
    minX >= 100000 && maxX <= 900000 &&  // Valid UTM easting range
    minY >= 0 && maxY <= 10000000;        // Valid UTM northing range (0°-84°N)

  if (isUTM) {
    // Determine UTM zone from easting and location
    const zone = detectUTMZone(minX, maxX, minY, maxY);
    
    // For Spain, assume ETRS89 (modern cadastre standard)
    // Zone 28: Canary Islands (west)
    // Zone 29: Western Spain (Galicia, Extremadura)
    // Zone 30: Central Spain (Madrid, Castilla)
    // Zone 31: Eastern Spain (Catalunya, Valencia)
    
    const epsg = `EPSG:258${zone}`; // ETRS89 / UTM zone XX N
    
    return {
      epsg,
      name: `ETRS89 / UTM Zone ${zone}N`,
      isProjected: true,
      zone,
      hemisphere: 'N',
    };
  }

  // Fallback: assume geographic
  console.warn('[CRS] Could not confidently detect CRS, assuming WGS84');
  return {
    epsg: 'EPSG:4326',
    name: 'WGS84 Geographic (assumed)',
    isProjected: false,
  };
}

/**
 * Detect UTM zone from coordinate bounds
 * Spain covers UTM zones 28-31
 */
function detectUTMZone(minX: number, maxX: number, minY: number, maxY: number): number {
  // Strategy: Use easting to determine zone
  // Each UTM zone is ~6° wide with central meridian at:
  // Zone 28: -15° (Canary Islands)
  // Zone 29: -9°  (Western mainland)
  // Zone 30: -3°  (Central mainland)
  // Zone 31: +3°  (Eastern mainland)
  
  // Typical easting values:
  // < 300000m: likely western edge of zone (zone-1 or current)
  // 300000-700000m: middle of zone
  // > 700000m: eastern edge (zone+1 or current)
  
  const avgEasting = (minX + maxX) / 2;
  const avgNorthing = (minY + maxY) / 2;
  
  // Spain mainland latitude: ~36-44°N → northing ~4,000,000-4,900,000
  // Canary Islands: ~27-29°N → northing ~3,000,000-3,200,000
  
  if (avgNorthing < 3500000) {
    // Likely Canary Islands → Zone 28
    return 28;
  }
  
  // Mainland Spain: determine from easting
  if (avgEasting < 300000) {
    return 29; // Western edge, likely zone 29
  } else if (avgEasting < 500000) {
    return 30; // Central, likely zone 30
  } else if (avgEasting < 700000) {
    return 30; // Still zone 30
  } else {
    return 31; // Eastern edge, likely zone 31
  }
}

// ===== REPROJECTION =====

/**
 * Reproject coordinates from source CRS to WGS84 (EPSG:4326)
 */
export function reprojectToWGS84(
  coordinates: number[][],
  sourceCRS: CRSInfo
): { coordinates: number[][]; errors: string[] } {
  if (sourceCRS.epsg === 'EPSG:4326') {
    // Already WGS84, no reprojection needed
    return { coordinates, errors: [] };
  }

  const errors: string[] = [];
  const reprojected: number[][] = [];

  try {
    // Create proj4 transformer
    const transform = proj4(sourceCRS.epsg, 'EPSG:4326');

    for (let i = 0; i < coordinates.length; i++) {
      const [x, y, z] = coordinates[i];
      
      try {
        // Transform [easting, northing] → [lon, lat]
        const [lon, lat] = transform.forward([x, y]);
        
        // Preserve elevation if present
        reprojected.push([lon, lat, z || 0]);
      } catch (err) {
        errors.push(`Coordinate ${i} failed: [${x}, ${y}] - ${err}`);
        // Use original as fallback
        reprojected.push(coordinates[i]);
      }
    }

    return { coordinates: reprojected, errors };
  } catch (err) {
    errors.push(`Reprojection failed: ${err}`);
    return { coordinates, errors }; // Return original on failure
  }
}

// ===== VALIDATION =====

/**
 * Validate that coordinates are reasonable for Spain
 * Bounds: lon [-18.5, 4.5], lat [27.5, 43.8]
 */
export function validateSpanishCoordinates(coordinates: number[][]): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (coordinates.length === 0) {
    warnings.push('No coordinates provided');
    return { valid: false, warnings };
  }

  const lons = coordinates.map(c => c[0]);
  const lats = coordinates.map(c => c[1]);

  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  // Spain bounds (including Canary Islands)
  const SPAIN_BOUNDS = {
    minLon: -18.5,
    maxLon: 4.5,
    minLat: 27.5,
    maxLat: 43.8,
  };

  // Check if ANY coordinate is outside Spain
  const hasOutOfBounds = 
    minLon < SPAIN_BOUNDS.minLon || maxLon > SPAIN_BOUNDS.maxLon ||
    minLat < SPAIN_BOUNDS.minLat || maxLat > SPAIN_BOUNDS.maxLat;

  if (hasOutOfBounds) {
    warnings.push(
      `Coordinates outside Spain bounds: ` +
      `lon [${minLon.toFixed(4)}, ${maxLon.toFixed(4)}], ` +
      `lat [${minLat.toFixed(4)}, ${maxLat.toFixed(4)}]`
    );
  }

  // Check bbox size (reject if too large - likely error)
  const width = maxLon - minLon;
  const height = maxLat - minLat;
  const MAX_SIZE = 2.0; // 2 degrees (too large for a parcel)

  if (width > MAX_SIZE || height > MAX_SIZE) {
    warnings.push(
      `Bbox too large: ${width.toFixed(4)}° × ${height.toFixed(4)}° ` +
      `(max ${MAX_SIZE}°)`
    );
  }

  // Check for invalid coordinates (NaN, Infinity)
  const hasInvalid = coordinates.some(c => 
    !isFinite(c[0]) || !isFinite(c[1])
  );

  if (hasInvalid) {
    warnings.push('Contains invalid coordinates (NaN or Infinity)');
    return { valid: false, warnings };
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

/**
 * Calculate geographic bounds from WGS84 coordinates
 */
export function calculateBounds(coordinates: number[][]): GeoBounds {
  const lons = coordinates.map(c => c[0]);
  const lats = coordinates.map(c => c[1]);

  const west = Math.min(...lons);
  const east = Math.max(...lons);
  const south = Math.min(...lats);
  const north = Math.max(...lats);

  const centroid: [number, number] = [
    (west + east) / 2,
    (south + north) / 2,
  ];

  const width = east - west;
  const height = north - south;

  return {
    bbox: { west, south, east, north },
    centroid,
    width,
    height,
  };
}

// ===== MAIN API =====

/**
 * Normalize coordinates: detect CRS, reproject to WGS84, validate
 * This is the main entry point for CesiumViewer
 */
export function normalizeCoordinates(
  rawCoordinates: number[][],
  options: {
    forceCRS?: string;      // Force specific CRS instead of auto-detect
    skipValidation?: boolean; // Skip Spain bounds validation
  } = {}
): ReprojectionResult {
  const warnings: string[] = [];

  // Step 1: Detect CRS
  const crsInfo = options.forceCRS
    ? { epsg: options.forceCRS, name: options.forceCRS, isProjected: true }
    : detectCRS(rawCoordinates);

  console.log(`[CRS] Detected: ${crsInfo.name} (${crsInfo.epsg})`);
  if (crsInfo.zone) {
    console.log(`[CRS]   Zone: ${crsInfo.zone}${crsInfo.hemisphere || ''}`);
  }

  // Step 2: Reproject if needed
  let coordinates = rawCoordinates;
  let wasReprojected = false;

  if (crsInfo.isProjected && crsInfo.epsg !== 'EPSG:4326') {
    console.log(`[CRS] Reprojecting from ${crsInfo.epsg} to EPSG:4326...`);
    
    const result = reprojectToWGS84(rawCoordinates, crsInfo);
    coordinates = result.coordinates;
    wasReprojected = true;

    if (result.errors.length > 0) {
      warnings.push(...result.errors);
      console.warn('[CRS] Reprojection errors:', result.errors);
    }
  }

  // Step 3: Validate
  let validationPassed = true;
  
  if (!options.skipValidation) {
    const validation = validateSpanishCoordinates(coordinates);
    validationPassed = validation.valid;

    if (!validation.valid) {
      warnings.push(...validation.warnings);
      console.warn('[CRS] Validation warnings:', validation.warnings);

      // If validation failed after reprojection, fallback to original
      if (wasReprojected && validation.warnings.some(w => w.includes('outside Spain'))) {
        console.warn('[CRS] Reprojection produced invalid coords, using original');
        coordinates = rawCoordinates;
        wasReprojected = false;
        validationPassed = false;
      }
    }
  }

  // Step 4: Calculate bounds
  const bounds = calculateBounds(coordinates);

  console.log(`[CRS] Bbox: [${bounds.bbox.west.toFixed(6)}, ${bounds.bbox.south.toFixed(6)}, ${bounds.bbox.east.toFixed(6)}, ${bounds.bbox.north.toFixed(6)}]`);
  console.log(`[CRS] Centroid: [${bounds.centroid[0].toFixed(6)}, ${bounds.centroid[1].toFixed(6)}]`);
  console.log(`[CRS] Size: ${(bounds.width * 111).toFixed(0)}m × ${(bounds.height * 111).toFixed(0)}m (approx)`);

  return {
    coordinates,
    crsInfo,
    bounds,
    wasReprojected,
    validationPassed,
    warnings,
  };
}
