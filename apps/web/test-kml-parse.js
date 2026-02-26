/**
 * Test KML coordinate parsing
 */

const fs = require('fs');
const { DOMParser } = require('@xmldom/xmldom');

// Read the KML file
const kmlPath = './public/sample-data/40212A00200007.kml';
const kmlText = fs.readFileSync(kmlPath, 'utf-8');

// Parse XML
const parser = new DOMParser();
const xmlDoc = parser.parseFromString(kmlText, 'text/xml');

// Extract name
const nameElement = xmlDoc.getElementsByTagName('name')[0];
const name = nameElement?.textContent || 'Unknown';

// Find coordinates
const coordsElement = xmlDoc.getElementsByTagName('coordinates')[0];
if (!coordsElement || !coordsElement.textContent) {
  console.error('No coordinates found');
  process.exit(1);
}

// Parse coordinates
const coordText = coordsElement.textContent.trim();
const coordPairs = coordText.split(/\s+/);

const coordinates = coordPairs
  .filter(pair => pair.length > 0)
  .map(pair => {
    const parts = pair.split(',').map(parseFloat);
    return [parts[0], parts[1], parts[2] || 0];
  });

console.log('=== KML Parsing Test ===');
console.log('Name:', name);
console.log('Total coordinates:', coordinates.length);
console.log('First coordinate:', coordinates[0]);
console.log('Last coordinate:', coordinates[coordinates.length - 1]);

// Calculate bbox manually
const lons = coordinates.map(c => c[0]);
const lats = coordinates.map(c => c[1]);
const minLon = Math.min(...lons);
const maxLon = Math.max(...lons);
const minLat = Math.min(...lats);
const maxLat = Math.max(...lats);

console.log('\nBounding Box:');
console.log('  West:', minLon);
console.log('  South:', minLat);
console.log('  East:', maxLon);
console.log('  North:', maxLat);

const centroid = [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
console.log('\nCentroid:', centroid);

// Check if coordinates are in WGS84 or UTM
const isWGS84 = Math.abs(minLon) <= 180 && Math.abs(maxLon) <= 180 && Math.abs(minLat) <= 90 && Math.abs(maxLat) <= 90;
const isUTM = minLon > 100000 && maxLon < 900000 && minLat > 0 && maxLat < 10000000;

console.log('\nCoordinate System:');
console.log('  Looks like WGS84:', isWGS84);
console.log('  Looks like UTM:', isUTM);
