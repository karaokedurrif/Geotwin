/**
 * Utilities for computing KML geometry bounds in Cesium
 */

export interface KmlBounds {
  sphere: any; // Cesium.BoundingSphere
  centroidLonLat: [number, number];
  radiusMeters: number;
  pointCount: number;
}

/**
 * Compute robust bounding sphere from KML data source
 * Extracts all geometry positions and creates bounding sphere
 */
export function computeKmlBounds(
  dataSource: any,
  Cesium: any
): KmlBounds | null {
  if (!dataSource || !dataSource.entities) {
    return null;
  }

  const positions: any[] = [];
  const time = Cesium.JulianDate.now();

  // Traverse all entities and extract positions
  dataSource.entities.values.forEach((entity: any) => {
    try {
      // Polygon hierarchy
      if (entity.polygon && entity.polygon.hierarchy) {
        const hierarchy = entity.polygon.hierarchy.getValue(time);
        if (hierarchy && hierarchy.positions) {
          positions.push(...hierarchy.positions);
        }
      }
      
      // Polyline positions
      if (entity.polyline && entity.polyline.positions) {
        const polylinePositions = entity.polyline.positions.getValue(time);
        if (polylinePositions) {
          positions.push(...polylinePositions);
        }
      }
      
      // Point position
      if (entity.position) {
        const pos = entity.position.getValue(time);
        if (pos) {
          positions.push(pos);
        }
      }
      
      // Rectangle (convert corners to positions)
      if (entity.rectangle && entity.rectangle.coordinates) {
        const rect = entity.rectangle.coordinates.getValue(time);
        if (rect) {
          // Add rectangle corners
          positions.push(
            Cesium.Cartesian3.fromRadians(rect.west, rect.south),
            Cesium.Cartesian3.fromRadians(rect.east, rect.south),
            Cesium.Cartesian3.fromRadians(rect.east, rect.north),
            Cesium.Cartesian3.fromRadians(rect.west, rect.north)
          );
        }
      }
    } catch (err) {
      console.warn('[KML Bounds] Error extracting positions from entity:', err);
    }
  });

  if (positions.length === 0) {
    console.warn('[KML Bounds] No positions found in data source');
    return null;
  }

  // Create bounding sphere from all positions
  const sphere = Cesium.BoundingSphere.fromPoints(positions);
  
  // Convert sphere center to lon/lat for UI display
  const cartographic = Cesium.Cartographic.fromCartesian(sphere.center);
  const centroidLonLat: [number, number] = [
    Cesium.Math.toDegrees(cartographic.longitude),
    Cesium.Math.toDegrees(cartographic.latitude),
  ];

  return {
    sphere,
    centroidLonLat,
    radiusMeters: sphere.radius,
    pointCount: positions.length,
  };
}
