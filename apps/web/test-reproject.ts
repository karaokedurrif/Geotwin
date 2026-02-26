/**
 * Unit tests for CRS detection and reprojection
 * Run with: tsx test-reproject.ts
 */

import { normalizeCoordinates, detectCRS } from './src/lib/geo/reproject.js';

console.log('=== CRS Detection & Reprojection Tests ===\n');

// Test 1: WGS84 coordinates (Spain - should be detected as EPSG:4326)
console.log('Test 1: WGS84 Geographic Coordinates');
const wgs84Coords = [
  [-4.123456, 40.987654, 0],
  [-4.122456, 40.987654, 0],
  [-4.122456, 40.986654, 0],
  [-4.123456, 40.986654, 0],
  [-4.123456, 40.987654, 0],
];

const result1 = normalizeCoordinates(wgs84Coords);
console.log('  CRS:', result1.crsInfo.name);
console.log('  Reprojected:', result1.wasReprojected);
console.log('  Centroid:', result1.bounds.centroid);
console.log('  Bbox:', result1.bounds.bbox);
console.log('  Valid:', result1.validationPassed);
console.log('  Warnings:', result1.warnings.length);
console.log('');

// Test 2: UTM Zone 30N coordinates (ETRS89 - should be detected and reprojected)
console.log('Test 2: UTM Zone 30N (ETRS89) Coordinates');
const utmCoords = [
  [400000, 4500000, 0],  // Central Spain (approx)
  [400100, 4500000, 0],
  [400100, 4500100, 0],
  [400000, 4500100, 0],
  [400000, 4500000, 0],
];

const result2 = normalizeCoordinates(utmCoords);
console.log('  CRS:', result2.crsInfo.name);
console.log('  Reprojected:', result2.wasReprojected);
console.log('  Centroid:', result2.bounds.centroid);
console.log('  Bbox:', result2.bounds.bbox);
console.log('  Valid:', result2.validationPassed);
console.log('  Warnings:', result2.warnings.length);
console.log('');

// Test 3: UTM Zone 31N coordinates (Eastern Spain)
console.log('Test 3: UTM Zone 31N (ETRS89) Coordinates');
const utmCoords31 = [
  [750000, 4600000, 0],  // Eastern Spain (Catalunya area)
  [750100, 4600000, 0],
  [750100, 4600100, 0],
  [750000, 4600100, 0],
  [750000, 4600000, 0],
];

const result3 = normalizeCoordinates(utmCoords31);
console.log('  CRS:', result3.crsInfo.name);
console.log('  Zone:', result3.crsInfo.zone);
console.log('  Reprojected:', result3.wasReprojected);
console.log('  Centroid:', result3.bounds.centroid);
console.log('  Bbox:', result3.bounds.bbox);
console.log('  Valid:', result3.validationPassed);
console.log('');

console.log('=== All tests completed ===');
