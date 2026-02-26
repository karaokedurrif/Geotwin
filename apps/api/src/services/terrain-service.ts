import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ROI } from './roi-service.js';

const execFileAsync = promisify(execFile);

export type TerrainSource = 'cnig' | 'cesium';

export interface TerrainResponse {
  type: 'quantized-mesh' | 'ion' | 'not-ready';
  url?: string;
  assetId?: number;
  message?: string;
  source: TerrainSource;
}

/**
 * Check if GDAL is available
 */
async function isGDALAvailable(): Promise<boolean> {
  try {
    await execFileAsync('gdalinfo', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if CNIG MDT raster exists locally
 * For now, expects user to manually place MDT .tif files in /data/mdt/
 * TODO: Auto-download from CNIG download center with proper auth
 */
async function findCNIGRaster(roi: ROI): Promise<string | null> {
  const mdtDir = path.join(process.cwd(), 'data', 'mdt');
  
  try {
    const files = await fs.readdir(mdtDir);
    const tifFiles = files.filter((f) => f.toLowerCase().endsWith('.tif') || f.toLowerCase().endsWith('.tiff'));
    
    if (tifFiles.length > 0) {
      // For now, return the first available raster
      // TODO: Filter by spatial intersection with ROI bbox
      return path.join(mdtDir, tifFiles[0]);
    }
  } catch (error) {
    // Directory doesn't exist or no permissions
    return null;
  }
  
  return null;
}

/**
 * Clip raster to ROI bbox using GDAL
 */
async function clipRaster(
  inputPath: string,
  outputPath: string,
  bbox: [number, number, number, number]
): Promise<void> {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  
  await execFileAsync('gdalwarp', [
    '-te', minLon.toString(), minLat.toString(), maxLon.toString(), maxLat.toString(),
    '-t_srs', 'EPSG:4326',
    '-r', 'bilinear',
    '-co', 'COMPRESS=LZW',
    '-co', 'TILED=YES',
    inputPath,
    outputPath,
  ]);
}

/**
 * Convert clipped raster to quantized-mesh tiles
 * TODO: Implement using ctb-tile or cesium-terrain-builder
 * For now, this is a placeholder that returns "not-ready"
 */
async function rasterToQuantizedMesh(
  rasterPath: string,
  outputDir: string,
  roi: ROI
): Promise<boolean> {
  // TODO: Implement conversion pipeline
  // Options:
  // 1. Use ctb-tile: https://github.com/ahuarte47/cesium-terrain-builder
  // 2. Use py3dtilers with DEM module
  // 3. Use Cesium Tiler (commercial)
  
  console.log(`[TERRAIN] TODO: Convert ${rasterPath} to quantized-mesh at ${outputDir}`);
  return false; // Not implemented yet
}

/**
 * Get terrain data for ROI
 */
export async function getTerrainForROI(
  roi: ROI,
  source: TerrainSource = 'cnig'
): Promise<TerrainResponse> {
  // Force Cesium fallback if requested
  if (source === 'cesium') {
    return {
      type: 'ion',
      assetId: 1, // Cesium World Terrain
      source: 'cesium',
      message: 'Using Cesium World Terrain via Ion',
    };
  }

  // Try CNIG path
  const gdalAvailable = await isGDALAvailable();
  if (!gdalAvailable) {
    console.log('[TERRAIN] GDAL not available, falling back to Cesium');
    return {
      type: 'ion',
      assetId: 1,
      source: 'cesium',
      message: 'GDAL not installed - using Cesium World Terrain',
    };
  }

  const cnigRaster = await findCNIGRaster(roi);
  if (!cnigRaster) {
    console.log('[TERRAIN] No CNIG MDT raster found in data/mdt/, falling back to Cesium');
    return {
      type: 'ion',
      assetId: 1,
      source: 'cesium',
      message: 'No CNIG MDT raster available - place .tif files in data/mdt/ directory',
    };
  }

  // Clip and convert
  try {
    const terrainDir = path.join(process.cwd(), 'data', 'terrain', roi.id);
    await fs.mkdir(terrainDir, { recursive: true });

    const clippedPath = path.join(terrainDir, 'clipped.tif');
    
    // Check if already clipped
    try {
      await fs.access(clippedPath);
      console.log(`[TERRAIN] Using cached clipped raster for ${roi.id}`);
    } catch {
      console.log(`[TERRAIN] Clipping raster to ROI bbox...`);
      await clipRaster(cnigRaster, clippedPath, roi.bufferedBbox);
      console.log(`[TERRAIN] Clipped raster saved to ${clippedPath}`);
    }

    // Try to convert to quantized-mesh
    const tilesDir = path.join(terrainDir, 'tiles');
    const converted = await rasterToQuantizedMesh(clippedPath, tilesDir, roi);

    if (converted) {
      return {
        type: 'quantized-mesh',
        url: `/terrain/${roi.id}/`,
        source: 'cnig',
        message: 'CNIG MDT terrain tiles ready',
      };
    } else {
      // Conversion not implemented yet, fallback
      return {
        type: 'not-ready',
        source: 'cnig',
        message: 'CNIG MDT clipped but quantized-mesh conversion not implemented - TODO: add ctb-tile or py3dtilers',
      };
    }
  } catch (error) {
    console.error('[TERRAIN] Error processing CNIG terrain:', error);
    return {
      type: 'ion',
      assetId: 1,
      source: 'cesium',
      message: `CNIG processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
