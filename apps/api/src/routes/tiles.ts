import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { join } from 'path';
import { readFile, access, readdir } from 'fs/promises';
import { constants } from 'fs';

const TILES_DIR = join(process.cwd(), '..', '..', 'data', 'tiles');

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
    const allowedExtensions = ['.json', '.b3dm', '.glb', '.geojson'];
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
      };

      return reply
        .header('Content-Type', contentTypes[ext] || 'application/octet-stream')
        .header('Access-Control-Allow-Origin', '*')
        .send(data);
    } catch {
      return reply.code(404).send({ error: 'Tile file not found' });
    }
  });

  // Trigger terrain processing (spawn Python engine)
  fastify.post('/tiles/:twinId/process', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };

    if (!isValidTwinId(twinId)) {
      return reply.code(400).send({ error: 'Invalid twinId' });
    }

    // Find geometry file for this twin
    const dataDir = join(process.cwd(), 'data', twinId);
    const geojsonPath = join(dataDir, 'geometry.geojson');

    try {
      await access(geojsonPath, constants.R_OK);
    } catch {
      return reply.code(404).send({ error: 'Twin geometry not found' });
    }

    // Spawn Python pipeline in background
    const { spawn } = await import('child_process');
    const outputDir = join(TILES_DIR, twinId);

    const pythonProcess = spawn('python', [
      '-m', 'engine',
      '--input', geojsonPath,
      '--twin-id', twinId,
      '--output', outputDir,
    ], {
      cwd: join(process.cwd(), '..', '..'),  // repo root
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    pythonProcess.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    return new Promise((resolve) => {
      pythonProcess.on('close', (code: number) => {
        if (code === 0) {
          resolve(reply.send({
            success: true,
            twinId,
            tilesetUrl: `/api/tiles/${twinId}/tileset.json`,
            output: stdout,
          }));
        } else {
          resolve(reply.code(500).send({
            success: false,
            error: `Pipeline failed with code ${code}`,
            stderr,
          }));
        }
      });
    });
  });
}
