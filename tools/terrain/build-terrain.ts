#!/usr/bin/env ts-node
/**
 * Cesium Terrain Builder
 * 
 * Converts a GeoTIFF DEM (mdt02.tif) into Cesium quantized-mesh terrain tiles.
 * 
 * Requirements:
 *   - Docker installed and running
 *   - Input GeoTIFF in EPSG:25829 or EPSG:4326
 * 
 * Usage:
 *   pnpm terrain:build
 *   pnpm terrain:build --input path/to/custom.tif
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const DEFAULT_INPUT = path.resolve(__dirname, '../../data/raw/mdt02.tif');
const OUTPUT_DIR = path.resolve(__dirname, '../../apps/web/public/terrain/mdt02');
const TEMP_DIR = path.resolve(__dirname, '../../data/temp/terrain-build');

// Parse CLI args
const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');
const INPUT_FILE = inputIndex !== -1 && args[inputIndex + 1] 
  ? path.resolve(args[inputIndex + 1])
  : DEFAULT_INPUT;

console.log('🌍 Cesium Terrain Builder');
console.log('========================\n');

// Step 1: Validate input file
if (!fs.existsSync(INPUT_FILE)) {
  console.error(`❌ Input file not found: ${INPUT_FILE}`);
  console.error(`\nPlace your GeoTIFF DEM at: ${DEFAULT_INPUT}`);
  process.exit(1);
}

const stats = fs.statSync(INPUT_FILE);
console.log(`✓ Input file: ${INPUT_FILE} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

// Step 2: Check Docker availability
try {
  execSync('docker --version', { stdio: 'ignore' });
  console.log('✓ Docker is available');
} catch (err) {
  console.error('❌ Docker is not installed or not running');
  console.error('Install Docker: https://docs.docker.com/get-docker/');
  process.exit(1);
}

// Step 3: Create output directories
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log(`✓ Output directory: ${OUTPUT_DIR}`);
console.log(`✓ Temp directory: ${TEMP_DIR}\n`);

// Step 4: Run cesium-terrain-builder via Docker
console.log('🔧 Building terrain tiles (this may take several minutes)...\n');

try {
  // Use geodata/cesium-terrain-builder Docker image
  // This tool converts GeoTIFF -> quantized-mesh tiles
  const dockerCmd = `docker run --rm \\
    -v "${path.dirname(INPUT_FILE)}:/data" \\
    -v "${TEMP_DIR}:/output" \\
    geodata/cesium-terrain-builder \\
    ctb-tile \\
    -f Mesh \\
    -C \\
    -N \\
    -l \\
    -o /output \\
    /data/${path.basename(INPUT_FILE)}`;

  console.log('Running Docker command:');
  console.log(dockerCmd.replace(/\\/g, '').replace(/\n/g, ' '));
  console.log('');

  execSync(dockerCmd, { stdio: 'inherit' });

  console.log('\n✓ Terrain tiles generated');

  // Step 5: Move tiles to public folder
  console.log('📦 Moving tiles to public folder...');
  
  // Copy all files from temp to output
  const copyRecursive = (src: string, dest: string) => {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats && stats.isDirectory();
    
    if (isDirectory) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      fs.readdirSync(src).forEach((childItemName) => {
        copyRecursive(path.join(src, childItemName), path.join(dest, childItemName));
      });
    } else {
      fs.copyFileSync(src, dest);
    }
  };

  copyRecursive(TEMP_DIR, OUTPUT_DIR);
  console.log(`✓ Tiles copied to ${OUTPUT_DIR}`);

  // Step 6: Create layer.json metadata
  const layerJson = {
    tilejson: '2.1.0',
    name: 'MDT02 CNIG Terrain',
    description: 'CNIG MDT02 Digital Elevation Model - Spain',
    version: '1.0.0',
    format: 'quantized-mesh-1.0',
    attribution: 'Centro Nacional de Información Geográfica (CNIG)',
    scheme: 'tms',
    tiles: ['{z}/{x}/{y}.terrain'],
    projection: 'EPSG:4326',
    bounds: [-180, -90, 180, 90], // Will be updated by Cesium
    minzoom: 0,
    maxzoom: 14,
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'layer.json'),
    JSON.stringify(layerJson, null, 2)
  );

  console.log('✓ Created layer.json metadata');

  // Step 7: Cleanup temp directory
  console.log('🧹 Cleaning up temporary files...');
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  console.log('\n✅ SUCCESS! Terrain tiles are ready');
  console.log(`\n📍 Location: ${OUTPUT_DIR}`);
  console.log('🎯 Enable "Local MDT02 Terrain" in the GeoTwin UI to use these tiles.\n');

} catch (err) {
  console.error('\n❌ Error building terrain tiles:');
  if (err instanceof Error) {
    console.error(err.message);
  }
  console.error('\nTroubleshooting:');
  console.error('1. Ensure Docker is running: docker ps');
  console.error('2. Pull the image manually: docker pull geodata/cesium-terrain-builder');
  console.error('3. Check input file format: gdalinfo data/raw/mdt02.tif');
  process.exit(1);
}
