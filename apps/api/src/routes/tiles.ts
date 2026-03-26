import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { join } from 'path';
import { readFile, access, readdir, mkdir, writeFile } from 'fs/promises';
import { constants } from 'fs';

const TILES_DIR = join(process.cwd(), 'data', 'tiles');
const ENGINE_URL = process.env.ENGINE_URL || 'http://geotwin-engine:8002';

/**
 * Validates twinId to prevent path traversal.
 */
function isValidTwinId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

/**
 * Tiles API — serves 3D Tiles (tileset.json, B3DM, GLB) for terrain meshes.
 */
export async function tilesRouter(fastify: FastifyInstance) {

  // Check if tiles exist for a twin
  fastify.get('/tiles/:twinId/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };

    if (!isValidTwinId(twinId)) {
      return reply.code(400).send({ error: 'Invalid twinId' });
    }

    const tilesetPath = join(TILES_DIR, twinId, 'tileset.json');

    try {
      await access(tilesetPath, constants.R_OK);
      const files = await readdir(join(TILES_DIR, twinId));
      return reply.send({
        available: true,
        twinId,
        files,
        tilesetUrl: `/api/tiles/${twinId}/tileset.json`,
      });
    } catch {
      return reply.send({ available: false, twinId });
    }
  });

  // Serve tile files (tileset.json, *.b3dm, *.glb)
  fastify.get('/tiles/:twinId/:filename', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId, filename } = request.params as { twinId: string; filename: string };

    if (!isValidTwinId(twinId)) {
      return reply.code(400).send({ error: 'Invalid twinId' });
    }

    // Whitelist allowed extensions
    const allowedExtensions = ['.json', '.b3dm', '.glb', '.geojson', '.tif', '.png', '.pgw'];
    const ext = filename.slice(filename.lastIndexOf('.'));
    if (!allowedExtensions.includes(ext)) {
      return reply.code(403).send({ error: 'File type not allowed' });
    }

    // Prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return reply.code(400).send({ error: 'Invalid filename' });
    }

    const filePath = join(TILES_DIR, twinId, filename);

    try {
      const data = await readFile(filePath);

      const contentTypes: Record<string, string> = {
        '.json': 'application/json',
        '.b3dm': 'application/octet-stream',
        '.glb': 'model/gltf-binary',
        '.geojson': 'application/geo+json',
        '.tif': 'image/tiff',
        '.png': 'image/png',
        '.pgw': 'text/plain',
      };

      return reply
        .header('Content-Type', contentTypes[ext] || 'application/octet-stream')
        .header('Access-Control-Allow-Origin', '*')
        .send(data);
    } catch {
      return reply.code(404).send({ error: 'Tile file not found' });
    }
  });

  // Trigger terrain processing via engine service (async)
  fastify.post('/tiles/:twinId/process', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };

    if (!isValidTwinId(twinId)) {
      return reply.code(400).send({ error: 'Invalid twinId' });
    }

    // Find or create geometry file for this twin
    const dataDir = join(process.cwd(), 'data', twinId);
    const geojsonPath = join(dataDir, 'geometry.geojson');

    try {
      await access(geojsonPath, constants.R_OK);
    } catch {
      // Geometry file doesn't exist — try to create from request body
      const body = request.body as { geojson?: any } | null;
      if (body?.geojson) {
        await mkdir(dataDir, { recursive: true });
        const geojsonStr = JSON.stringify(body.geojson);
        await writeFile(geojsonPath, geojsonStr, 'utf-8');
      } else {
        return reply.code(404).send({ error: 'Twin geometry not found. Send geojson in request body.' });
      }
    }

    // Call engine API to start processing
    try {
      const engineResp = await fetch(`${ENGINE_URL}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          twin_id: twinId,
          input_file: `/app/data/${twinId}/geometry.geojson`,
        }),
      });

      if (!engineResp.ok) {
        const err = await engineResp.text();
        return reply.code(502).send({ error: 'Engine error', detail: err });
      }

      const job = await engineResp.json() as { job_id: string; status: string };
      return reply.send({
        success: true,
        twinId,
        jobId: job.job_id,
        status: job.status,
        statusUrl: `/api/tiles/${twinId}/job/${job.job_id}`,
      });
    } catch (err) {
      return reply.code(502).send({ error: 'Engine unreachable', detail: String(err) });
    }
  });

  // Poll job status from engine
  fastify.get('/tiles/:twinId/job/:jobId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId, jobId } = request.params as { twinId: string; jobId: string };

    if (!isValidTwinId(twinId)) {
      return reply.code(400).send({ error: 'Invalid twinId' });
    }

    try {
      const engineResp = await fetch(`${ENGINE_URL}/jobs/${encodeURIComponent(jobId)}`);

      if (!engineResp.ok) {
        return reply.code(engineResp.status).send({ error: 'Job not found' });
      }

      const job = await engineResp.json() as Record<string, unknown>;
      return reply.send(job);
    } catch (err) {
      return reply.code(502).send({ error: 'Engine unreachable', detail: String(err) });
    }
  });
}
