import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';
import { getCopernicusToken, fetchNDVI, getTwinNDVI } from '../services/copernicus.js';

interface NDVIParams {
  id: string;
}

interface NDVIQuery {
  date?: string;
  refresh?: string;
}

interface NDVIPostBody {
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

/**
 * NDVI routes
 */
export async function ndviRouter(fastify: FastifyInstance) {
  /**
   * POST /api/ndvi
   * Fetch NDVI from Copernicus Sentinel-2 with custom bbox and date range
   */
  fastify.post<{ Body: NDVIPostBody }>(
    '/ndvi',
    async (request: FastifyRequest<{ Body: NDVIPostBody }>, reply: FastifyReply) => {
      const { bbox, from, to } = request.body;

      try {
        // Validate input
        if (!bbox || bbox.length !== 4) {
          return reply.code(400).send({ error: 'Invalid bbox: must be [minLon, minLat, maxLon, maxLat]' });
        }

        if (!from || !to) {
          return reply.code(400).send({ error: 'Missing required fields: from, to' });
        }

        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(from) || !dateRegex.test(to)) {
          return reply.code(400).send({ error: 'Invalid date format: use YYYY-MM-DD' });
        }

        console.log('POST /api/ndvi request:');
        console.log(`  bbox: [${bbox.join(', ')}]`);
        console.log(`  from: ${from}`);
        console.log(`  to: ${to}`);

        // Get OAuth token (with caching)
        const token = await getCopernicusToken();

        // Fetch NDVI from Copernicus Process API
        const imageBuffer = await fetchNDVI({ bbox, from, to }, token);

        // Return PNG image
        reply.type('image/png');
        return reply.send(imageBuffer);
      } catch (error) {
        console.error('Error in POST /api/ndvi:', error);
        
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return reply.code(500).send({
          error: 'Failed to fetch NDVI',
          message: errorMessage,
        });
      }
    }
  );

  /**
   * GET /api/twin/:id/ndvi
   * Fetch real NDVI from Copernicus Sentinel-2 (legacy endpoint with caching)
   */
  fastify.get<{ Params: NDVIParams; Querystring: NDVIQuery }>(
    '/twin/:id/ndvi',
    async (request: FastifyRequest<{ Params: NDVIParams; Querystring: NDVIQuery }>, reply: FastifyReply) => {
      const { id: twinId } = request.params;
      const { date, refresh } = request.query;

      try {
        // Check if NDVI already cached
        const dataDir = path.join(process.cwd(), 'data', twinId);
        const ndviPath = path.join(dataDir, 'ndvi.png');
        const scenePath = path.join(dataDir, 'scene.json');

        // Check if cached NDVI exists and refresh not requested
        if (refresh !== 'true') {
          try {
            const exists = await fs.access(ndviPath).then(() => true).catch(() => false);
            if (exists) {
              const image = await fs.readFile(ndviPath);
              reply.type('image/png');
              return reply.send(image);
            }
          } catch {
            // File doesn't exist, continue to fetch
          }
        }

        // Load twin scene to get bbox
        const sceneData = await fs.readFile(scenePath, 'utf-8');
        const scene = JSON.parse(sceneData);
        const bbox = scene.bbox as [number, number, number, number];

        if (!bbox || bbox.length !== 4) {
          return reply.code(400).send({ error: 'Invalid bbox in twin scene' });
        }

        // Fetch NDVI from Copernicus
        console.log(`Fetching NDVI for twin ${twinId} with bbox:`, bbox);
        await getTwinNDVI(twinId, bbox, date);

        // Return the generated image
        const image = await fs.readFile(ndviPath);
        reply.type('image/png');
        return reply.send(image);
      } catch (error) {
        console.error('Error fetching NDVI:', error);
        return reply.code(500).send({
          error: 'Failed to fetch NDVI',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}
