/**
 * Utilities for exporting parcel geometry and metadata
 */

export interface ParcelGeoJSON {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: {
      type: 'Polygon' | 'MultiPolygon';
      coordinates: number[][][] | number[][][][];
    };
    properties: {
      sourceFileName?: string;
      timestamp: string;
      area_m2?: number;
      perimeter_m?: number;
    };
  }>;
}

export interface ParcelMetadata {
  centroid: {
    lon: number;
    lat: number;
  };
  bbox: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  };
  boundingSphere: {
    lon: number;
    lat: number;
    radius_m: number;
  };
  cameraPreset: {
    headingDeg: number;
    pitchDeg: number;
    range_m: number;
  };
  localFrameENU: {
    origin: {
      lon: number;
      lat: number;
      height: number;
    };
    matrix4: number[]; // 16 elements, column-major ECEF->ENU transform
  };
}

/**
 * Extract polygon positions from Cesium entity
 */
export function extractEntityPositions(entity: any, Cesium: any): number[][] {
  const time = Cesium.JulianDate.now();
  const positions: number[][] = [];

  if (entity?.polygon?.hierarchy) {
    const hierarchy = entity.polygon.hierarchy.getValue(time);
    if (hierarchy?.positions) {
      hierarchy.positions.forEach((cartesian: any) => {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        const lon = Cesium.Math.toDegrees(cartographic.longitude);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);
        positions.push([lon, lat]);
      });
    }
  }

  return positions;
}

/**
 * Calculate area in square meters using spherical geometry
 */
export function calculateArea(positions: number[][], Cesium: any): number {
  if (positions.length < 3) return 0;

  try {
    // Convert to Cartesian3 positions
    const cartesians = positions.map(([lon, lat]) =>
      Cesium.Cartesian3.fromDegrees(lon, lat)
    );
    
    // Use Turf.js-style planar approximation for area
    // Simple shoelace formula for polygon area on sphere
    let area = 0;
    const earthRadius = 6371000; // meters
    
    for (let i = 0; i < positions.length - 1; i++) {
      const [lon1, lat1] = positions[i];
      const [lon2, lat2] = positions[i + 1];
      
      const lat1Rad = Cesium.Math.toRadians(lat1);
      const lat2Rad = Cesium.Math.toRadians(lat2);
      const lonDiff = Cesium.Math.toRadians(lon2 - lon1);
      
      area += lonDiff * (2 + Math.sin(lat1Rad) + Math.sin(lat2Rad));
    }
    
    area = Math.abs(area * earthRadius * earthRadius / 2.0);
    return area;
  } catch (error) {
    console.warn('[Export] Area calculation failed:', error);
    return 0;
  }
}

/**
 * Calculate perimeter in meters
 */
export function calculatePerimeter(positions: number[][], Cesium: any): number {
  if (positions.length < 2) return 0;

  let perimeter = 0;
  for (let i = 0; i < positions.length - 1; i++) {
    const p1 = Cesium.Cartographic.fromDegrees(positions[i][0], positions[i][1]);
    const p2 = Cesium.Cartographic.fromDegrees(positions[i + 1][0], positions[i + 1][1]);
    
    const distance = Cesium.Cartesian3.distance(
      Cesium.Cartographic.toCartesian(p1),
      Cesium.Cartographic.toCartesian(p2)
    );
    perimeter += distance;
  }

  // Close the ring
  const first = Cesium.Cartographic.fromDegrees(positions[0][0], positions[0][1]);
  const last = Cesium.Cartographic.fromDegrees(
    positions[positions.length - 1][0],
    positions[positions.length - 1][1]
  );
  perimeter += Cesium.Cartesian3.distance(
    Cesium.Cartographic.toCartesian(first),
    Cesium.Cartographic.toCartesian(last)
  );

  return perimeter;
}

/**
 * Calculate bounding box from positions
 */
export function calculateBBox(positions: number[][]): {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} {
  if (positions.length === 0) {
    return { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 };
  }

  let minLon = positions[0][0];
  let maxLon = positions[0][0];
  let minLat = positions[0][1];
  let maxLat = positions[0][1];

  positions.forEach(([lon, lat]) => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  });

  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Create ENU (East-North-Up) local frame transformation matrix
 * Returns ECEF->ENU transform (16 elements, column-major)
 */
export function createLocalFrameENU(lon: number, lat: number, Cesium: any): number[] {
  const origin = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  
  // Create ENU transform matrix at this point
  const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  
  // Convert Matrix4 to array (column-major order)
  const matrix = [
    enuTransform[0], enuTransform[1], enuTransform[2], enuTransform[3],
    enuTransform[4], enuTransform[5], enuTransform[6], enuTransform[7],
    enuTransform[8], enuTransform[9], enuTransform[10], enuTransform[11],
    enuTransform[12], enuTransform[13], enuTransform[14], enuTransform[15],
  ];

  return matrix;
}

/**
 * Export parcel as GeoJSON
 */
export function exportParcelGeoJSON(
  entity: any,
  Cesium: any,
  sourceFileName?: string
): ParcelGeoJSON {
  const positions = extractEntityPositions(entity, Cesium);
  
  // Ensure ring is closed
  const first = positions[0];
  const last = positions[positions.length - 1];
  const closedPositions = 
    first && last && (first[0] !== last[0] || first[1] !== last[1])
      ? [...positions, first]
      : positions;

  const area_m2 = calculateArea(positions, Cesium);
  const perimeter_m = calculatePerimeter(positions, Cesium);

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [closedPositions],
        },
        properties: {
          sourceFileName,
          timestamp: new Date().toISOString(),
          area_m2: Math.round(area_m2 * 100) / 100,
          perimeter_m: Math.round(perimeter_m * 100) / 100,
        },
      },
    ],
  };
}

/**
 * Export parcel metadata
 */
export function exportParcelMetadata(
  entity: any,
  boundingSphere: any,
  Cesium: any,
  framingMargin: number = 1.45
): ParcelMetadata {
  const positions = extractEntityPositions(entity, Cesium);
  const bbox = calculateBBox(positions);

  // Centroid from bounding sphere
  const cartographic = Cesium.Cartographic.fromCartesian(boundingSphere.center);
  const centroidLon = Cesium.Math.toDegrees(cartographic.longitude);
  const centroidLat = Cesium.Math.toDegrees(cartographic.latitude);

  // Camera preset (matching flyToIsometric)
  const range_m = Math.max(boundingSphere.radius * 2.2 * framingMargin, 150);

  // Local ENU frame
  const matrix4 = createLocalFrameENU(centroidLon, centroidLat, Cesium);

  return {
    centroid: {
      lon: centroidLon,
      lat: centroidLat,
    },
    bbox,
    boundingSphere: {
      lon: centroidLon,
      lat: centroidLat,
      radius_m: boundingSphere.radius,
    },
    cameraPreset: {
      headingDeg: 315,
      pitchDeg: -45,
      range_m: Math.round(range_m * 100) / 100,
    },
    localFrameENU: {
      origin: {
        lon: centroidLon,
        lat: centroidLat,
        height: 0,
      },
      matrix4, // ECEF->ENU transform (column-major)
    },
  };
}

/**
 * Download text file (JSON, GeoJSON, etc.)
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string = 'application/json'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
