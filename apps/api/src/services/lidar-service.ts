import type { ROI } from './roi-service.js';

export interface LiDARResponse {
  type: '3d-tiles' | 'not-ready';
  url?: string;
  message?: string;
}

/**
 * LiDAR service for CNIG point cloud data
 * 
 * TODO: Implement full LiDAR pipeline:
 * 1. Download CNIG LiDAR LAZ files for ROI from:
 *    https://centrodedescargas.cnig.es/CentroDescargas/index.jsp
 * 2. Convert LAZ to LAS using laszip
 * 3. Classify buildings and vegetation using classification codes
 * 4. Generate 3D Tiles:
 *    - Buildings: Use pdal + py3dtilers or cesium-native
 *    - Trees: Instance 3D models based on height and position
 * 5. Serve tileset.json and content files
 * 
 * For now, this returns "not-ready" placeholder
 */
export async function getLiDARTiles(roi: ROI): Promise<LiDARResponse> {
  // TODO: Check if LiDAR data is cached
  // const tilesDir = path.join(process.cwd(), 'data', 'lidar', roi.id, 'tiles');
  
  // TODO: Check if tileset.json exists
  // try {
  //   await fs.access(path.join(tilesDir, 'tileset.json'));
  //   return {
  //     type: '3d-tiles',
  //     url: `/lidar/${roi.id}/tileset.json`,
  //     message: 'LiDAR 3D Tiles ready',
  //   };
  // } catch {
  //   // Not ready, start processing...
  // }

  console.log('[LiDAR] Service not implemented yet');
  
  return {
    type: 'not-ready',
    message: 'LiDAR 3D Tiles generation not implemented - TODO: add PDAL + py3dtilers pipeline',
  };
}

/**
 * Download CNIG LiDAR for ROI
 * TODO: Implement download from CNIG with proper authentication
 */
async function downloadCNIGLiDAR(roi: ROI): Promise<string[]> {
  // TODO: Query CNIG catalog for LiDAR coverage
  // TODO: Download LAZ files intersecting ROI bbox
  // TODO: Return list of downloaded file paths
  throw new Error('Not implemented');
}

/**
 * Process LAZ files to 3D Tiles
 * TODO: Implement conversion pipeline
 */
async function processLiDAR(
  lazFiles: string[],
  outputDir: string,
  roi: ROI
): Promise<void> {
  // TODO: Use PDAL pipeline:
  // 1. readers.las
  // 2. filters.crop (to ROI bbox)
  // 3. filters.range (classification == 6 for buildings, 4/5 for vegetation)
  // 4. writers.ply or direct to Cesium tiles
  
  // TODO: For trees:
  // - Extract points with classification 4/5
  // - Cluster into individual trees
  // - Calculate height and position for each
  // - Generate instanced 3D models (batch table with positions + heights)
  
  throw new Error('Not implemented');
}
