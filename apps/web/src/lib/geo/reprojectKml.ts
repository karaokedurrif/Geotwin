/**
 * KML/GML reprojection utilities for GeoTwin
 * Handles automatic UTM detection and reprojection for KML/GML files
 */

import proj4 from 'proj4';

// ===== EPSG DEFINITIONS =====

// Define ETRS89 UTM zones for Spain
proj4.defs([
  ['EPSG:25828', '+proj=utm +zone=28 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:25829', '+proj=utm +zone=29 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:25830', '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:25831', '+proj=utm +zone=31 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'],
  ['EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs +type=crs'],
]);

// ===== COORDINATE DETECTION =====

export interface CoordinateAnalysis {
  isUTM: boolean;
  zone?: number;
  sampleCoords: number[][];
}

/**
 * Analyze coordinates to detect if they are in UTM format
 * Returns detected zone (29, 30, 31) or undefined if WGS84
 */
export function analyzeCoordinates(coords: number[][]): CoordinateAnalysis {
  if (coords.length === 0) {
    return { isUTM: false, sampleCoords: [] };
  }

  const samples = coords.slice(0, Math.min(10, coords.length));
  const xs = samples.map(c => c[0]);
  const ys = samples.map(c => c[1]);

  // Check if values look like WGS84 (geographic)
  const allLonsInRange = xs.every(x => x >= -180 && x <= 180);
  const allLatsInRange = ys.every(y => y >= -90 && y <= 90);
  const isGeographic =
    allLonsInRange && allLatsInRange &&
    Math.max(...xs) - Math.min(...xs) < 15 &&
    Math.max(...ys) - Math.min(...ys) < 15;

  if (isGeographic) {
    return { isUTM: false, sampleCoords: samples };
  }

  // Check if values look like UTM (meters)
  const allEastingsValid = xs.every(x => x >= 100000 && x <= 900000);
  const allNorthingsValid = ys.every(y => y >= 0 && y <= 10000000);
  const isUTM = allEastingsValid && allNorthingsValid;

  if (isUTM) {
    // Auto-detect zone from easting and northing
    const avgEasting = (Math.min(...xs) + Math.max(...xs)) / 2;
    const avgNorthing = (Math.min(...ys) + Math.max(...ys)) / 2;
    const zone = autoSelectZone(avgEasting, avgNorthing);
    return { isUTM: true, zone, sampleCoords: samples };
  }

  return { isUTM: false, sampleCoords: samples };
}

/**
 * Auto-select UTM zone for Spain based on coordinates
 * Returns zone 29, 30, or 31
 */
export function autoSelectZone(easting: number, northing: number): number {
  // Spain mainland latitude: ~36-44°N
  // Canary Islands: ~27-29°N
  // Zone boundaries (approximate easting):
  // Zone 29: 29°W (central meridian) → easting 200k-600k
  // Zone 30: 3°W (central meridian) → easting 150k-850k  
  // Zone 31: 3°E (central meridian) → easting 150k-850k

  // Canary Islands detection
  if (northing < 3300000) {
    return 28;
  }

  // Mainland Spain
  if (easting < 400000) {
    return 29;
  } else if (easting < 600000) {
    return 30;
  } else {
    return 31;
  }
}

// ===== KML PARSING AND REPROJECTION =====

/**
 * Extract all coordinate pairs from KML coordinate strings
 * KML format: "lon,lat lon,lat ..." or "lon,lat,alt lon,lat,alt ..."
 */
function parseKmlCoordinates(coordString: string): number[][] {
  return coordString
    .trim()
    .split(/\s+/)
    .filter(coord => coord.length > 0)
    .map(coord => {
      const parts = coord.split(',').map(p => parseFloat(p.trim()));
      // Return [lon, lat] (ignore altitude if present)
      return [parts[0], parts[1]];
    })
    .filter(pair => !isNaN(pair[0]) && !isNaN(pair[1]));
}

/**
 * Format coordinate pairs back to KML coordinate string
 * KML format: "lon,lat lon,lat ..."
 */
function formatKmlCoordinates(coords: number[][]): string {
  return coords.map(([lon, lat]) => `${lon},${lat}`).join(' ');
}

/**
 * Reproject a single coordinate pair from UTM to WGS84
 */
function reprojectPoint(
  point: number[],
  fromZone: number
): number[] {
  const fromEpsg = `EPSG:258${fromZone}` as const;
  const toEpsg = 'EPSG:4326';
  const converter = proj4(fromEpsg, toEpsg);
  const [lon, lat] = converter.forward(point);
  return [lon, lat];
}

/**
 * Reproject all coordinates in KML from UTM to WGS84
 */
function reprojectKmlCoordinates(
  coords: number[][],
  fromZone: number
): number[][] {
  return coords.map(point => reprojectPoint(point, fromZone));
}

/**
 * Main function: Reproject full KML text from UTM to WGS84
 * Detects or accepts zone number, parses KML, reprojects all coords, returns modified KML
 */
export function reprojectKmlString(
  kmlText: string,
  detectedZone?: number
): { kml: string; zone?: number; message: string } {
  // Parse KML to find all coordinate elements
  let allCoords: number[][] = [];
  const coordRegex = /<coordinates>([\s\S]*?)<\/coordinates>/g;
  let match;

  while ((match = coordRegex.exec(kmlText)) !== null) {
    const coordString = match[1];
    const coords = parseKmlCoordinates(coordString);
    allCoords = allCoords.concat(coords);
  }

  if (allCoords.length === 0) {
    return { kml: kmlText, message: 'No coordinates found in KML' };
  }

  // Analyze coordinates
  const analysis = analyzeCoordinates(allCoords);

  if (!analysis.isUTM) {
    return { kml: kmlText, message: 'Coordinates are already in WGS84' };
  }

  const zone = detectedZone || analysis.zone || 30;

  // Reproject all coordinates
  let modifiedKml = kmlText;

  // Replace coordinate strings with reprojected versions
  modifiedKml = modifiedKml.replace(/<coordinates>([\s\S]*?)<\/coordinates>/g, (match: string) => {
    const coordString = match.slice('<coordinates>'.length, -'</coordinates>'.length);
    const coords = parseKmlCoordinates(coordString);
    const reprojected = reprojectKmlCoordinates(coords, zone);
    const formatted = formatKmlCoordinates(reprojected);
    return `<coordinates>${formatted}</coordinates>`;
  });

  return {
    kml: modifiedKml,
    zone,
    message: `Reproducido automáticamente desde EPSG:258${zone} (UTM Zone ${zone}N) a WGS84`,
  };
}

// ===== GML PARSING =====

export interface BuildingFootprint {
  id: string;
  coordinates: number[][];
  properties?: Record<string, string>;
}

/**
 * Parse GML building footprints from GML text
 * Extracts gml:Polygon elements and their gml:posList coordinates
 */
export function parseGmlBuildings(gmlText: string): {
  buildings: BuildingFootprint[];
  detectedZone?: number;
  message: string;
} {
  const buildings: BuildingFootprint[] = [];
  
  // Parse GML in browser
  const parser = new DOMParser();
  let doc: Document;

  try {
    doc = parser.parseFromString(gmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      return { buildings: [], message: 'Error parsing GML XML' };
    }
  } catch (error) {
    return { buildings: [], message: `GML parse error: ${error}` };
  }

  // Find all building/feature elements containing polygons
  // Also look for direct Polygon/MultiSurface elements
  const polygonElements = doc.querySelectorAll(
    'Polygon, [*|Polygon], gml\\:Polygon, MultiSurface, [*|MultiSurface]'
  );

  // Analyze first set of coordinates to detect zone
  let detectedZone: number | undefined;
  let allCoords: number[][] = [];

  // Process polygon elements
  polygonElements.forEach((poly, idx) => {
    // Find posList elements (gml:posList or just posList)
    const posListElements = poly.querySelectorAll(
      'posList, [*|posList], gml\\:posList'
    );

    if (posListElements.length === 0) {
      // Fallback: look for LinearRing/pos sequences
      const posElements = poly.querySelectorAll('pos, [*|pos], gml\\:pos');
      if (posElements.length > 0) {
        const coords: number[] = [];
        posElements.forEach(pos => {
          const text = pos.textContent?.trim() || '';
          const values = text.split(/\s+/).map(v => parseFloat(v));
          if (values.length >= 2) {
            coords.push(values[1]); // lat
            coords.push(values[0]); // lon
          }
        });
        if (coords.length >= 4) {
          const coordPairs = [];
          for (let i = 0; i < coords.length; i += 2) {
            coordPairs.push([coords[i + 1], coords[i]]);
          }
          allCoords = allCoords.concat(coordPairs);
        }
      }
      return;
    }

    posListElements.forEach(posList => {
      const posListText = posList.textContent?.trim() || '';
      if (posListText.length === 0) return;

      // GML posList format varies:
      // "x y x y ..." (2D, easting northing)
      // "x y z x y z ..." (3D)
      const values = posListText.split(/\s+/).map(v => parseFloat(v));

      // Determine srsDimension (usually 2 or 3)
      const srsDim = posList.getAttribute('srsDimension') || 
                     posList.getAttribute('gml:srsDimension') ||
                     '2'; // default to 2D
      const dim = parseInt(srsDim);

      // Extract coordinate pairs [lon, lat] (x, y in GML)
      const coords: number[][] = [];
      for (let i = 0; i < values.length; i += dim) {
        if (i + 1 < values.length) {
          coords.push([values[i], values[i + 1]]);
        }
      }

      if (coords.length > 0) {
        allCoords = allCoords.concat(coords);

        // Detect zone from first building
        if (!detectedZone && coords.length >= 3) {
          const analysis = analyzeCoordinates(coords);
          if (analysis.isUTM) {
            detectedZone = analysis.zone;
          }
        }

        // Store building
        buildings.push({
          id: `building-${idx}`,
          coordinates: coords,
          properties: {},
        });
      }
    });
  });

  if (buildings.length === 0) {
    return { buildings: [], message: 'No building polygons found in GML' };
  }

  // If coordinates are in UTM, reproject them
  if (detectedZone) {
    const zone = detectedZone;
    buildings.forEach(building => {
      building.coordinates = reprojectKmlCoordinates(building.coordinates, zone);
    });
    return {
      buildings,
      detectedZone: zone,
      message: `GML cargado: ${buildings.length} edificios (reproyectado desde EPSG:258${zone} a WGS84)`,
    };
  }

  return {
    buildings,
    message: `GML cargado: ${buildings.length} edificios`,
  };
}
