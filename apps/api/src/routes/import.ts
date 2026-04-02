import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import type { StylePreset, ImportResponse } from '@geotwin/types';
import { parseFile } from '../parsers/index.js';
import { generateTwinRecipe } from '../services/recipe-generator.js';
import { saveTwinData } from '../services/storage.js';

/**
 * Import route handler
 */
export async function importRouter(fastify: FastifyInstance) {
  fastify.post('/import', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get multipart data
      const data = await request.file();
      
      if (!data) {
        return reply.code(400).send({
          success: false,
          error: 'No file uploaded',
        } as ImportResponse);
      }

      // Get preset from query params
      const queryParams = request.query as { preset?: string };
      const preset = (queryParams.preset || 'mountain') as StylePreset;

      // Validate preset
      const validPresets: StylePreset[] = ['mountain', 'dehesa', 'mediterranean'];
      if (!validPresets.includes(preset)) {
        return reply.code(400).send({
          success: false,
          error: `Invalid preset. Must be one of: ${validPresets.join(', ')}`,
        } as ImportResponse);
      }

      fastify.log.info(`Processing file: ${data.filename}, preset: ${preset}`);

      // Parse the file
      const geometry = await parseFile(data);

      if (!geometry) {
        return reply.code(400).send({
          success: false,
          error: 'Could not parse geometry from file',
        } as ImportResponse);
      }

      fastify.log.info(`Parsed geometry type: ${geometry.type}, coords: ${JSON.stringify(geometry.coordinates).substring(0, 100)}`);

      // Generate twin recipe
      const recipe = await generateTwinRecipe(geometry, preset);

      // Save twin data
      await saveTwinData(recipe, geometry);

      fastify.log.info(`Twin created: ${recipe.twinId}`);

      // Auto-trigger tile processing (fire-and-forget)
      const ENGINE_URL = process.env.ENGINE_URL || 'http://geotwin-engine:8002';
      fetch(`${ENGINE_URL}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          twin_id: recipe.twinId,
          input_file: `/app/data/twins/${recipe.twinId}/geometry.geojson`,
        }),
      }).then(() => {
        fastify.log.info(`Tile processing triggered for ${recipe.twinId}`);
      }).catch((err) => {
        fastify.log.warn(`Tile processing trigger failed for ${recipe.twinId}: ${err}`);
      });

      return reply.send({
        success: true,
        twinId: recipe.twinId,
        recipe,
      } as ImportResponse);
    } catch (error) {
      fastify.log.error(`Import error: ${error}`);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } as ImportResponse);
    }
  });

  // Get existing twin
  fastify.get('/twin/:twinId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };
    
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const recipePath = path.join(process.cwd(), 'data', twinId, 'scene.json');
      const recipeData = await fs.readFile(recipePath, 'utf-8');
      const recipe = JSON.parse(recipeData);
      
      return reply.send({
        success: true,
        recipe,
      });
    } catch (error) {
      return reply.code(404).send({
        success: false,
        error: 'Twin not found',
      });
    }
  });

  // Get twin geometry
  fastify.get('/twin/:twinId/geometry', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };
    
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const geometryPath = path.join(process.cwd(), 'data', twinId, 'geometry.geojson');
      const geometryData = await fs.readFile(geometryPath, 'utf-8');
      const geometry = JSON.parse(geometryData);
      
      return reply.send(geometry);
    } catch (error) {
      return reply.code(404).send({
        success: false,
        error: 'Geometry not found',
      });
    }
  });

  // Sync twin from frontend — persists geometry + minimal scene.json so that
  // engine services (Sentinel-2, illustration, etc.) can find the parcel.
  fastify.put('/twin/:twinId/sync', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };

    // Validate twinId format
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(twinId)) {
      return reply.code(400).send({ success: false, error: 'Invalid twinId' });
    }

    const body = request.body as {
      geojson?: any;
      area_ha?: number;
      centroid?: [number, number];
      name?: string;
    };

    if (!body?.geojson) {
      return reply.code(400).send({ success: false, error: 'Missing geojson in body' });
    }

    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      const dataDir = path.join(process.cwd(), 'data', twinId);
      await fs.mkdir(dataDir, { recursive: true });

      // Extract raw geometry from the provided GeoJSON (could be Feature, FeatureCollection, or raw Geometry)
      let rawGeometry: any;
      if (body.geojson.type === 'FeatureCollection') {
        rawGeometry = body.geojson.features?.[0]?.geometry;
      } else if (body.geojson.type === 'Feature') {
        rawGeometry = body.geojson.geometry;
      } else {
        rawGeometry = body.geojson;
      }

      if (!rawGeometry?.coordinates) {
        return reply.code(400).send({ success: false, error: 'Invalid geometry — no coordinates' });
      }

      // Write geometry.geojson (Feature format expected by engine)
      const geojsonFeature = {
        type: 'Feature',
        properties: { twinId, area_ha: body.area_ha ?? 0 },
        geometry: rawGeometry,
      };
      await fs.writeFile(
        path.join(dataDir, 'geometry.geojson'),
        JSON.stringify(geojsonFeature, null, 2),
        'utf-8',
      );

      // Write minimal scene.json if it doesn't exist yet
      const scenePath = path.join(dataDir, 'scene.json');
      try {
        await fs.access(scenePath);
      } catch {
        const minimalRecipe = {
          twinId,
          area_ha: body.area_ha ?? 0,
          centroid: body.centroid ?? [0, 0],
          parcel: {
            name: body.name ?? twinId,
            centroid: body.centroid ?? [0, 0],
            area_ha: body.area_ha ?? 0,
          },
          createdAt: new Date().toISOString(),
        };
        await fs.writeFile(scenePath, JSON.stringify(minimalRecipe, null, 2), 'utf-8');
      }

      fastify.log.info(`Twin ${twinId} synced from frontend`);
      return reply.send({ success: true, twinId });
    } catch (error) {
      fastify.log.error(`Sync error for ${twinId}: ${error}`);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Load sample data endpoint
  fastify.get('/sample', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Get preset from query params
      const queryParams = request.query as { preset?: string };
      const preset = (queryParams.preset || 'dehesa') as StylePreset;

      // Validate preset
      const validPresets: StylePreset[] = ['mountain', 'dehesa', 'mediterranean'];
      if (!validPresets.includes(preset)) {
        return reply.code(400).send({
          success: false,
          error: `Invalid preset. Must be one of: ${validPresets.join(', ')}`,
        } as ImportResponse);
      }

      fastify.log.info(`Loading sample data with preset: ${preset}`);

      // Look for sample KML file in multiple possible locations
      const possiblePaths = [
        path.join(process.cwd(), 'sample-data', '40212A00200007.kml'),
        path.join(process.cwd(), '..', 'web', 'public', 'sample-data', '40212A00200007.kml'),
        path.join(process.cwd(), '..', '..', 'sample-data', '40212A00200007.kml'),
      ];

      let samplePath: string | null = null;
      for (const testPath of possiblePaths) {
        try {
          await fs.access(testPath);
          samplePath = testPath;
          break;
        } catch {
          continue;
        }
      }

      if (!samplePath) {
        return reply.code(404).send({
          success: false,
          error: 'Sample data file not found. Please ensure sample-data/40212A00200007.kml exists.',
        } as ImportResponse);
      }

      // Read the sample file
      const fileBuffer = await fs.readFile(samplePath);
      const filename = path.basename(samplePath);

      // Create a mock MultipartFile object
      const mockFile: MultipartFile = {
        fieldname: 'file',
        filename,
        encoding: '7bit',
        mimetype: 'application/vnd.google-earth.kml+xml',
        file: {
          bytesRead: fileBuffer.length,
        } as any,
        toBuffer: async () => fileBuffer,
      } as any;

      // Parse the file
      const geometry = await parseFile(mockFile);

      if (!geometry) {
        return reply.code(500).send({
          success: false,
          error: 'Could not parse sample geometry',
        } as ImportResponse);
      }

      fastify.log.info(`Parsed geometry type: ${geometry.type}, coords length: ${geometry.coordinates?.length}`);

      // Generate twin recipe
      try {
        const recipe = await generateTwinRecipe(geometry, preset);

        // Save twin data
        await saveTwinData(recipe, geometry);

        fastify.log.info(`Sample twin created: ${recipe.twinId}`);

        return reply.send({
          success: true,
          twinId: recipe.twinId,
          recipe,
        } as ImportResponse);
      } catch (recipeError) {
        console.error('=== RECIPE GENERATION ERROR ===');
        console.error(recipeError);
        fastify.log.error(`Recipe generation error: ${recipeError}`);
        throw recipeError; // Re-throw to see full stack trace
      }
    } catch (error) {
      console.error('=== SAMPLE LOAD ERROR ===');
      console.error(error);
      fastify.log.error(`Sample load error: ${error}`);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load sample';
      const errorStack = error instanceof Error ? error.stack : '';
      fastify.log.error(`Error stack: ${errorStack ?? ''}`);
      return reply.code(500).send({
        success: false,
        error: errorMessage,
      } as ImportResponse);
    }
  });
}