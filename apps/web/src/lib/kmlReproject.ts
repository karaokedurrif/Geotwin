/**
 * KML coordinate normalization utilities
 * Handles UTM reprojection and swapped coordinates
 */

import proj4 from 'proj4';

// Define common Spanish UTM zones
proj4.defs([
  ['EPSG:25828', '+proj=utm +zone=28 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:25829', '+proj=utm +zone=29 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:25830', '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:25831', '+proj=utm +zone=31 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs +type=crs'],
]);

export interface CoordNormalizationResult {
  lon: number;
  lat: number;
  wasReprojected: boolean;
  wasSwapped: boolean;
  sourceEPSG?: string;
}

/**
 * Detect if coordinates are in UTM format
 * UTM eastings: 100,000 - 900,000
 * UTM northings: 0 - 10,000,000
 */
function isUTM(x: number, y: number): boolean {
  return (
    x >= 100000 && x <= 900000 &&
    y >= 0 && y <= 10000000
  );
}

/**
 * Detect if WGS84 coordinates are swapped (lat, lon instead of lon, lat)
 * Valid lon: -180 to 180
 * Valid lat: -90 to 90
 */
function areCoordinatesSwapped(x: number, y: number): boolean {
  // If first value is in lat range and second in lon range, likely swapped
  const xInLatRange = Math.abs(x) <= 90;
  const yInLonRange = Math.abs(y) <= 180 && Math.abs(y) > 90;
  
  // If x is clearly latitude and y is clearly longitude, they're swapped
  return xInLatRange && yInLonRange;
}

/**
 * Detect UTM zone from easting/northing (Spain-specific heuristic)
 * Zone 28: Canary Islands (west)
 * Zone 29: Western Spain
 * Zone 30: Central Spain (default for mainland)
 * Zone 31: Eastern Spain
 */
function detectUTMZone(easting: number, northing: number): number {
  // Canary Islands are much further south
  if (northing < 3500000) {
    return 28;
  }
  
  // Mainland Spain: use easting to determine zone
  if (easting < 300000) {
    return 29; // Western edge
  } else if (easting < 700000) {
    return 30; // Central (most common)
  } else {
    return 31; // Eastern edge
  }
}

/**
 * Normalize coordinates to WGS84 lon/lat
 * Handles UTM reprojection and swapped coordinates
 */
export function normalizeCoords(
  x: number,
  y: number,
  forcedEPSG?: string
): CoordNormalizationResult {
  let lon = x;
  let lat = y;
  let wasReprojected = false;
  let wasSwapped = false;
  let sourceEPSG: string | undefined = forcedEPSG;

  // Step 1: Check if UTM coordinates
  if (!forcedEPSG && isUTM(x, y)) {
    const zone = detectUTMZone(x, y);
    sourceEPSG = `EPSG:258${zone}`;
    
    console.log(`[KML Normalize] Detected UTM Zone ${zone}N (${sourceEPSG})`);
    
    try {
      const transform = proj4(sourceEPSG, 'EPSG:4326');
      const [projLon, projLat] = transform.forward([x, y]);
      lon = projLon;
      lat = projLat;
      wasReprojected = true;
      
      // Log with 10 decimal places to verify precision
      console.log(`[KML Normalize] Reprojected from ${sourceEPSG}: [${x.toFixed(0)}, ${y.toFixed(0)}] → [${lon.toFixed(10)}, ${lat.toFixed(10)}]`);
    } catch (err) {
      console.error('[KML Normalize] Reprojection failed:', err);
      // Use original values as fallback
      lon = x;
      lat = y;
    }
  }
  // Step 2: Check if WGS84 but swapped
  else if (!forcedEPSG && areCoordinatesSwapped(x, y)) {
    console.log(`[KML Normalize] Detected swapped coordinates: [${x}, ${y}] → swapping to [${y}, ${x}]`);
    lon = y;
    lat = x;
    wasSwapped = true;
  }
  // Step 3: Forced EPSG reprojection
  else if (forcedEPSG && forcedEPSG !== 'EPSG:4326') {
    try {
      const transform = proj4(forcedEPSG, 'EPSG:4326');
      const [projLon, projLat] = transform.forward([x, y]);
      lon = projLon;
      lat = projLat;
      wasReprojected = true;
      
      // Log with 10 decimal places to verify precision
      console.log(`[KML Normalize] Forced reprojection from ${forcedEPSG}: [${x}, ${y}] → [${lon.toFixed(10)}, ${lat.toFixed(10)}]`);
    } catch (err) {
      console.error('[KML Normalize] Forced reprojection failed:', err);
    }
  }

  // Validate final coordinates
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) {
    console.warn(`[KML Normalize] Warning: Invalid WGS84 coordinates after normalization: lon=${lon}, lat=${lat}`);
  }

  return {
    lon,
    lat,
    wasReprojected,
    wasSwapped,
    sourceEPSG,
  };
}

/**
 * Normalize an array of coordinate pairs
 */
export function normalizeCoordArray(
  coords: number[][],
  forcedEPSG?: string
): {
  normalized: Array<[number, number]>;
  stats: {
    reprojectedCount: number;
    swappedCount: number;
    sourceEPSG?: string;
  };
} {
  let reprojectedCount = 0;
  let swappedCount = 0;
  let detectedEPSG: string | undefined;

  const normalized = coords.map(([x, y]) => {
    const result = normalizeCoords(x, y, forcedEPSG);
    if (result.wasReprojected) reprojectedCount++;
    if (result.wasSwapped) swappedCount++;
    if (result.sourceEPSG && !detectedEPSG) {
      detectedEPSG = result.sourceEPSG;
    }
    return [result.lon, result.lat] as [number, number];
  });

  return {
    normalized,
    stats: {
      reprojectedCount,
      swappedCount,
      sourceEPSG: detectedEPSG,
    },
  };
}
