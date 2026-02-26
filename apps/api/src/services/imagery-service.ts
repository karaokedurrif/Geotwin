import type { ROI } from './roi-service.js';

export interface ImageryResponse {
  type: 'wmts' | 'wms' | 'not-available';
  url?: string;
  layer?: string;
  tileMatrixSet?: string;
  format?: string;
  attribution?: string;
  bbox?: [number, number, number, number];
  message?: string;
}

/**
 * PNOA (Plan Nacional de Ortofotografía Aérea) imagery service
 * Provides high-resolution orthoimagery for Spain
 * 
 * Official WMTS: https://www.ign.es/wmts/pnoa-ma
 * WMS fallback: https://www.ign.es/wms-inspire/pnoa-ma
 */
export function getPNOAImagery(roi: ROI): ImageryResponse {
  // Check if ROI is within Spain bounds (approximate)
  const spainBounds = {
    minLon: -18.5, // Canary Islands
    maxLon: 4.5,   // Eastern Spain
    minLat: 27.5,  // Canary Islands
    maxLat: 43.8,  // Northern Spain
  };

  const [minLon, minLat, maxLon, maxLat] = roi.bbox;
  const isInSpain =
    maxLon >= spainBounds.minLon &&
    minLon <= spainBounds.maxLon &&
    maxLat >= spainBounds.minLat &&
    minLat <= spainBounds.maxLat;

  if (!isInSpain) {
    return {
      type: 'not-available',
      message: 'ROI is outside Spain coverage - PNOA only covers Spanish territory',
    };
  }

  // Return WMTS configuration
  // PNOA Maximum Actuality (most recent imagery)
  return {
    type: 'wmts',
    url: 'https://www.ign.es/wmts/pnoa-ma',
    layer: 'OI.OrthoimageCoverage',
    tileMatrixSet: 'GoogleMapsCompatible',
    format: 'image/jpeg',
    attribution: '© Instituto Geográfico Nacional de España (IGN) - PNOA',
    bbox: roi.bbox,
    message: 'PNOA Maximum Actuality WMTS',
  };
}

/**
 * Get PNOA WMS fallback (for older clients or specific GetMap requests)
 */
export function getPNOAWMS(roi: ROI): ImageryResponse {
  const spainBounds = {
    minLon: -18.5,
    maxLon: 4.5,
    minLat: 27.5,
    maxLat: 43.8,
  };

  const [minLon, minLat, maxLon, maxLat] = roi.bbox;
  const isInSpain =
    maxLon >= spainBounds.minLon &&
    minLon <= spainBounds.maxLon &&
    maxLat >= spainBounds.minLat &&
    minLat <= spainBounds.maxLat;

  if (!isInSpain) {
    return {
      type: 'not-available',
      message: 'ROI is outside Spain coverage',
    };
  }

  return {
    type: 'wms',
    url: 'https://www.ign.es/wms-inspire/pnoa-ma',
    layer: 'OI.OrthoimageCoverage',
    format: 'image/jpeg',
    attribution: '© Instituto Geográfico Nacional de España (IGN) - PNOA',
    bbox: roi.bbox,
    message: 'PNOA Maximum Actuality WMS',
  };
}

/**
 * Get best available imagery for ROI
 * Prefers WMTS, falls back to WMS if needed
 */
export function getImageryForROI(roi: ROI, preferWMS: boolean = false): ImageryResponse {
  if (preferWMS) {
    return getPNOAWMS(roi);
  }
  return getPNOAImagery(roi);
}
