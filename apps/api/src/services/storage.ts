import { promises as fs } from 'fs';
import path from 'path';
import type { TwinRecipe, GeoJSONGeometry } from '@geotwin/types';

/**
 * Save twin data to local storage
 */
export async function saveTwinData(recipe: TwinRecipe, geometry: GeoJSONGeometry) {
  const dataDir = path.join(process.cwd(), 'data', recipe.twinId);

  // Create directory
  await fs.mkdir(dataDir, { recursive: true });

  // Save scene.json
  const scenePath = path.join(dataDir, 'scene.json');
  await fs.writeFile(scenePath, JSON.stringify(recipe, null, 2), 'utf-8');

  // Save geometry.geojson
  const geometryPath = path.join(dataDir, 'geometry.geojson');
  const geojson = {
    type: 'Feature',
    properties: {
      twinId: recipe.twinId,
      area_ha: recipe.area_ha,
    },
    geometry,
  };
  await fs.writeFile(geometryPath, JSON.stringify(geojson, null, 2), 'utf-8');
}
