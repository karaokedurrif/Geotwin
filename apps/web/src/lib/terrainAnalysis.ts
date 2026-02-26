/**
 * Terrain Analysis utilities for slope, aspect, and terrain-based metrics
 * Samples terrain elevation and computes analytical overlays
 */

export interface TerrainSample {
  lon: number;
  lat: number;
  elevation: number;
}

export interface SlopeGridResult {
  width: number;
  height: number;
  bbox: [number, number, number, number]; // [west, south, east, north]
  slopes: number[][]; // 2D array of slope values in degrees
  aspects: number[][]; // 2D array of aspect values in degrees (0=N, 90=E, 180=S, 270=W)
  cellSizeDegrees: number;
}

/**
 * Sample terrain elevation in a grid within bbox
 * @param viewer - Cesium Viewer instance
 * @param bbox - [west, south, east, north] in degrees
 * @param resolution - Number of samples per side (e.g., 50x50 grid)
 * @returns Promise with elevation samples
 */
export async function sampleTerrainGrid(
  viewer: any,
  bbox: [number, number, number, number],
  resolution: number = 50
): Promise<TerrainSample[]> {
  const Cesium = (window as any).Cesium;
  if (!Cesium || !viewer) {
    throw new Error('Cesium not loaded or viewer not ready');
  }

  const [west, south, east, north] = bbox;
  const cellWidth = (east - west) / (resolution - 1);
  const cellHeight = (north - south) / (resolution - 1);

  // Generate grid positions
  const positions: any[] = [];
  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      const lon = west + col * cellWidth;
      const lat = south + row * cellHeight;
      positions.push(Cesium.Cartographic.fromDegrees(lon, lat));
    }
  }

  // Sample terrain
  const terrainProvider = viewer.terrainProvider;
  const sampledPositions = await Cesium.sampleTerrainMostDetailed(terrainProvider, positions);

  // Convert to simple array
  return sampledPositions.map((pos: any) => ({
    lon: Cesium.Math.toDegrees(pos.longitude),
    lat: Cesium.Math.toDegrees(pos.latitude),
    elevation: pos.height,
  }));
}

/**
 * Compute slope and aspect from elevation grid
 * Uses finite difference method
 */
export function computeSlopeAspect(
  samples: TerrainSample[],
  gridWidth: number,
  gridHeight: number,
  cellSizeDegrees: number
): SlopeGridResult {
  const slopes: number[][] = [];
  const aspects: number[][] = [];

  // Convert to 2D grid
  const elevations: number[][] = [];
  for (let row = 0; row < gridHeight; row++) {
    elevations[row] = [];
    slopes[row] = [];
    aspects[row] = [];
    for (let col = 0; col < gridWidth; col++) {
      const idx = row * gridWidth + col;
      elevations[row][col] = samples[idx]?.elevation || 0;
    }
  }

  // Compute slope and aspect using finite differences
  // Cell size in meters (approximate at mid-latitude)
  const avgLat = samples[Math.floor(samples.length / 2)]?.lat || 40;
  const metersPerDegree = 111000 * Math.cos((avgLat * Math.PI) / 180);
  const cellSizeMeters = cellSizeDegrees * metersPerDegree;

  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      // Get elevation of neighbors (with boundary handling)
      const z = elevations[row][col];
      const z_left = col > 0 ? elevations[row][col - 1] : z;
      const z_right = col < gridWidth - 1 ? elevations[row][col + 1] : z;
      const z_bottom = row > 0 ? elevations[row - 1][col] : z;
      const z_top = row < gridHeight - 1 ? elevations[row + 1][col] : z;

      // Gradient in x and y directions
      const dz_dx = (z_right - z_left) / (2 * cellSizeMeters);
      const dz_dy = (z_top - z_bottom) / (2 * cellSizeMeters);

      // Slope in degrees
      const slope = Math.atan(Math.sqrt(dz_dx * dz_dx + dz_dy * dz_dy)) * (180 / Math.PI);
      slopes[row][col] = slope;

      // Aspect in degrees (0=N, 90=E, 180=S, 270=W)
      let aspect = Math.atan2(dz_dy, dz_dx) * (180 / Math.PI);
      aspect = (90 - aspect + 360) % 360; // Convert to compass bearing
      aspects[row][col] = aspect;
    }
  }

  const bbox: [number, number, number, number] = [
    samples[0].lon,
    samples[0].lat,
    samples[samples.length - 1].lon,
    samples[samples.length - 1].lat,
  ];

  return {
    width: gridWidth,
    height: gridHeight,
    bbox,
    slopes,
    aspects,
    cellSizeDegrees,
  };
}

/**
 * Generate PNG image from slope grid (heatmap)
 * Returns data URL that can be used with SingleTileImageryProvider
 */
export function generateSlopeHeatmap(slopeGrid: SlopeGridResult): string {
  const { width, height, slopes } = slopeGrid;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get canvas context');

  const imageData = ctx.createImageData(width, height);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const slope = slopes[row][col];
      const idx = (row * width + col) * 4;

      // Colormap: green (0°) → yellow (20°) → red (45°+)
      let r = 0, g = 0, b = 0;
      if (slope < 10) {
        // Green to yellow
        const t = slope / 10;
        r = Math.floor(t * 255);
        g = 255;
        b = 0;
      } else if (slope < 30) {
        // Yellow to orange
        const t = (slope - 10) / 20;
        r = 255;
        g = Math.floor((1 - t * 0.5) * 255);
        b = 0;
      } else {
        // Orange to red
        const t = Math.min((slope - 30) / 20, 1);
        r = 255;
        g = Math.floor((1 - t) * 128);
        b = 0;
      }

      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = slope > 0 ? 180 : 0; // Alpha (semi-transparent)
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Calculate fire risk index based on slope, aspect, and NDVI
 * @param slope - Slope in degrees
 * @param aspect - Aspect in degrees (0=N)
 * @param ndvi - NDVI value (-1 to 1)
 * @returns Risk score (0-100)
 */
export function calculateFireRisk(slope: number, aspect: number, ndvi: number): number {
  // Higher slope → higher risk (steep slopes accelerate fire spread)
  const slopeRisk = Math.min(slope / 45, 1) * 40;

  // South-facing (135-225°) → higher risk (more sun exposure)
  const isSouthFacing = aspect >= 135 && aspect <= 225;
  const aspectRisk = isSouthFacing ? 30 : 10;

  // Lower NDVI → higher risk (drier vegetation)
  // NDVI: -1 to 1, normalize to 0-1
  const ndviNormalized = (ndvi + 1) / 2;
  const ndviRisk = (1 - ndviNormalized) * 30;

  return Math.min(slopeRisk + aspectRisk + ndviRisk, 100);
}

/**
 * Calculate carbon sequestration estimate
 * @param areaSqMeters - Area in square meters
 * @param ndviMean - Mean NDVI value
 * @returns Estimated tonnes of CO2/year
 */
export function calculateCarbonSequestration(areaSqMeters: number, ndviMean: number): number {
  // Rough estimation factors (based on forest/dehesa literature)
  // NDVI > 0.6: dense forest (~5 tCO2/ha/year)
  // NDVI 0.3-0.6: dehesa/grassland (~2 tCO2/ha/year)
  // NDVI < 0.3: sparse vegetation (~0.5 tCO2/ha/year)

  const areaHectares = areaSqMeters / 10000;
  
  let carbonPerHaPerYear = 0;
  if (ndviMean > 0.6) {
    carbonPerHaPerYear = 5;
  } else if (ndviMean > 0.3) {
    carbonPerHaPerYear = 2 + (ndviMean - 0.3) / 0.3 * 3; // Linear interpolation
  } else {
    carbonPerHaPerYear = 0.5 + (ndviMean / 0.3) * 1.5;
  }

  return areaHectares * carbonPerHaPerYear;
}

/**
 * Estimate biomass from NDVI
 * @param ndviMean - Mean NDVI value
 * @param areaSqMeters - Area in square meters
 * @returns Estimated biomass in tonnes
 */
export function estimateBiomass(ndviMean: number, areaSqMeters: number): number {
  // Rough conversion: NDVI to biomass
  // Based on literature (varies by ecosystem)
  const areaHectares = areaSqMeters / 10000;
  
  // Biomass (tonnes/ha) ~ 20 * NDVI^2 (simplified model)
  const biomassPerHa = Math.max(0, 20 * Math.pow(Math.max(ndviMean, 0), 2));
  
  return areaHectares * biomassPerHa;
}
