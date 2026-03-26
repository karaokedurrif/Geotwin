/**
 * Drone API Routes — Fleet, missions, flight plans, image upload & processing.
 *
 * Endpoints:
 *   GET    /drones/:twinId                    — List drones for a twin
 *   POST   /drones/:twinId                    — Register a drone
 *   GET    /drones/:twinId/missions           — List missions
 *   POST   /drones/:twinId/missions           — Create mission
 *   GET    /drones/:twinId/missions/:missionId — Get mission detail
 *   POST   /drones/:twinId/missions/:missionId/plan  — Generate flight plan
 *   GET    /drones/:twinId/missions/:missionId/plan/kmz — Download DJI KMZ
 *   POST   /drones/:twinId/missions/:missionId/upload — Upload drone images
 *   POST   /drones/:twinId/missions/:missionId/process — Trigger ortho/NDVI processing
 *   GET    /drones/:twinId/products           — List generated products (ortho, NDVI)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { join } from 'path';
import { readFile, writeFile, mkdir, readdir, access } from 'fs/promises';
import { constants, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { randomBytes } from 'crypto';

const DATA_DIR = join(process.cwd(), 'data');
const ENGINE_URL = process.env.ENGINE_URL || 'http://geotwin-engine:8002';

function isValidId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

function genId(): string {
  return randomBytes(6).toString('base64url');
}

async function readJson<T = any>(path: string): Promise<T | null> {
  try {
    const txt = await readFile(path, 'utf-8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}

export async function dronesRouter(fastify: FastifyInstance) {
  // ── Drone registry ──────────────────────────────────────────────
  const dronesPath = (twinId: string) => join(DATA_DIR, twinId, 'drones.json');
  const missionsDir = (twinId: string) => join(DATA_DIR, twinId, 'missions');
  const missionPath = (twinId: string, missionId: string) =>
    join(DATA_DIR, twinId, 'missions', missionId, 'mission.json');
  const planPath = (twinId: string, missionId: string) =>
    join(DATA_DIR, twinId, 'missions', missionId, 'plan.json');
  const uploadsDir = (twinId: string, missionId: string) =>
    join(DATA_DIR, twinId, 'missions', missionId, 'images');
  const productsDir = (twinId: string) => join(DATA_DIR, twinId, 'drone_products');

  // ── List drones ────────────────────────────────────────────────
  fastify.get('/drones/:twinId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };
    if (!isValidId(twinId)) return reply.code(400).send({ error: 'Invalid twinId' });

    const drones = await readJson<any[]>(dronesPath(twinId));
    return reply.send({ twinId, drones: drones || [] });
  });

  // ── Register drone ─────────────────────────────────────────────
  fastify.post('/drones/:twinId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };
    if (!isValidId(twinId)) return reply.code(400).send({ error: 'Invalid twinId' });

    const body = request.body as {
      name: string;
      model?: string;
      type?: string;
      payload?: { camera_model?: string; sensor_type?: string };
    };

    if (!body.name) return reply.code(400).send({ error: 'name is required' });

    const drones = (await readJson<any[]>(dronesPath(twinId))) || [];
    const drone = {
      id: genId(),
      name: body.name,
      model: body.model || 'DJI Mavic 3E',
      type: body.type || 'multirotor',
      payload: body.payload || { camera_model: 'Hasselblad L2D-20c', sensor_type: 'RGB' },
      status: 'ready',
      created_at: new Date().toISOString(),
    };
    drones.push(drone);
    await writeJson(dronesPath(twinId), drones);

    return reply.code(201).send(drone);
  });

  // ── List missions ──────────────────────────────────────────────
  fastify.get('/drones/:twinId/missions', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };
    if (!isValidId(twinId)) return reply.code(400).send({ error: 'Invalid twinId' });

    const dir = missionsDir(twinId);
    let ids: string[] = [];
    try {
      ids = await readdir(dir);
    } catch {
      return reply.send({ twinId, missions: [] });
    }

    const missions: any[] = [];
    for (const id of ids) {
      const m = await readJson(missionPath(twinId, id));
      if (m) missions.push(m);
    }

    return reply.send({ twinId, missions });
  });

  // ── Create mission ─────────────────────────────────────────────
  fastify.post('/drones/:twinId/missions', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };
    if (!isValidId(twinId)) return reply.code(400).send({ error: 'Invalid twinId' });

    const body = request.body as {
      name: string;
      type?: string;
      drone_id?: string;
      aoi_geojson?: any;
    };
    if (!body.name) return reply.code(400).send({ error: 'name is required' });

    const missionId = genId();
    const mission = {
      id: missionId,
      twin_id: twinId,
      name: body.name,
      type: body.type || 'orthophoto',
      drone_id: body.drone_id || null,
      aoi_geojson: body.aoi_geojson || null,
      status: 'planned',
      created_at: new Date().toISOString(),
    };

    await writeJson(missionPath(twinId, missionId), mission);
    return reply.code(201).send(mission);
  });

  // ── Get mission detail ─────────────────────────────────────────
  fastify.get('/drones/:twinId/missions/:missionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId, missionId } = request.params as { twinId: string; missionId: string };
    if (!isValidId(twinId) || !isValidId(missionId)) return reply.code(400).send({ error: 'Invalid id' });

    const mission = await readJson(missionPath(twinId, missionId));
    if (!mission) return reply.code(404).send({ error: 'Mission not found' });

    const plan = await readJson(planPath(twinId, missionId));
    return reply.send({ ...mission, plan: plan || null });
  });

  // ── Generate flight plan ───────────────────────────────────────
  fastify.post('/drones/:twinId/missions/:missionId/plan', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId, missionId } = request.params as { twinId: string; missionId: string };
    if (!isValidId(twinId) || !isValidId(missionId)) return reply.code(400).send({ error: 'Invalid id' });

    const mission = await readJson<any>(missionPath(twinId, missionId));
    if (!mission) return reply.code(404).send({ error: 'Mission not found' });

    const body = request.body as {
      altitude?: number;
      overlap?: number;
      sidelap?: number;
      speed?: number;
      type?: string;
      aoi_geojson?: any;
      drone_model?: string;
    };

    // If AOI not in body, use mission's AOI or twin geometry
    let aoi = body.aoi_geojson || mission.aoi_geojson;
    if (!aoi) {
      const geojsonPath = join(DATA_DIR, twinId, 'geometry.geojson');
      aoi = await readJson(geojsonPath);
    }
    if (!aoi) return reply.code(400).send({ error: 'No AOI available. Provide aoi_geojson.' });

    // Call engine for flight plan computation
    try {
      const engineRes = await fetch(`${ENGINE_URL}/drones/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aoi_geojson: aoi,
          altitude_agl: body.altitude || 80,
          overlap: body.overlap || 75,
          sidelap: body.sidelap || 65,
          speed: body.speed || 8,
          plan_type: body.type || 'grid',
          drone_model: body.drone_model || '',
        }),
      });

      if (!engineRes.ok) {
        const err = await engineRes.text();
        return reply.code(502).send({ error: `Engine error: ${err}` });
      }

      const plan = await engineRes.json();
      await writeJson(planPath(twinId, missionId), plan);
      return reply.send(plan);
    } catch (err) {
      fastify.log.error(`Flight plan generation failed: ${err}`);
      return reply.code(502).send({ error: 'Engine unreachable' });
    }
  });

  // ── Download DJI KMZ ───────────────────────────────────────────
  fastify.get('/drones/:twinId/missions/:missionId/plan/kmz', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId, missionId } = request.params as { twinId: string; missionId: string };
    if (!isValidId(twinId) || !isValidId(missionId)) return reply.code(400).send({ error: 'Invalid id' });

    try {
      const engineRes = await fetch(`${ENGINE_URL}/drones/missions/${missionId}/export/dji`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twin_id: twinId }),
      });

      if (!engineRes.ok) return reply.code(502).send({ error: 'KMZ generation failed' });

      const kmzBuffer = Buffer.from(await engineRes.arrayBuffer());
      return reply
        .header('Content-Type', 'application/vnd.google-earth.kmz')
        .header('Content-Disposition', `attachment; filename="mission_${missionId}.kmz"`)
        .send(kmzBuffer);
    } catch {
      return reply.code(502).send({ error: 'Engine unreachable' });
    }
  });

  // ── Upload drone images ────────────────────────────────────────
  fastify.post('/drones/:twinId/missions/:missionId/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId, missionId } = request.params as { twinId: string; missionId: string };
    if (!isValidId(twinId) || !isValidId(missionId)) return reply.code(400).send({ error: 'Invalid id' });

    const uploadPath = uploadsDir(twinId, missionId);
    await mkdir(uploadPath, { recursive: true });

    const parts = request.parts();
    let count = 0;

    for await (const part of parts) {
      if (part.type === 'file') {
        // Sanitize filename
        const safeName = part.filename?.replace(/[^a-zA-Z0-9._-]/g, '_') || `image_${count}.jpg`;
        const dest = join(uploadPath, safeName);
        await pipeline(part.file, createWriteStream(dest));
        count++;
      }
    }

    // Update mission status
    const mission = await readJson<any>(missionPath(twinId, missionId));
    if (mission) {
      mission.status = 'images_uploaded';
      mission.image_count = count;
      await writeJson(missionPath(twinId, missionId), mission);
    }

    return reply.send({ uploaded: count, missionId });
  });

  // ── Trigger processing (ortho + NDVI) ──────────────────────────
  fastify.post('/drones/:twinId/missions/:missionId/process', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId, missionId } = request.params as { twinId: string; missionId: string };
    if (!isValidId(twinId) || !isValidId(missionId)) return reply.code(400).send({ error: 'Invalid id' });

    const mission = await readJson<any>(missionPath(twinId, missionId));
    if (!mission) return reply.code(404).send({ error: 'Mission not found' });

    try {
      const engineRes = await fetch(`${ENGINE_URL}/drones/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          twin_id: twinId,
          mission_id: missionId,
          images_dir: `/app/data/twins/${twinId}/missions/${missionId}/images`,
        }),
      });

      if (!engineRes.ok) {
        const err = await engineRes.text();
        return reply.code(502).send({ error: `Engine error: ${err}` });
      }

      const result = (await engineRes.json()) as { job_id?: string };

      mission.status = 'processing';
      mission.job_id = result.job_id;
      await writeJson(missionPath(twinId, missionId), mission);

      return reply.send(result);
    } catch (err) {
      fastify.log.error(`Drone processing trigger failed: ${err}`);
      return reply.code(502).send({ error: 'Engine unreachable' });
    }
  });

  // ── List drone products ────────────────────────────────────────
  fastify.get('/drones/:twinId/products', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };
    if (!isValidId(twinId)) return reply.code(400).send({ error: 'Invalid twinId' });

    const dir = productsDir(twinId);
    try {
      const files = await readdir(dir);
      const products = files
        .filter((f) => f.endsWith('.json'))
        .map(async (f) => readJson(join(dir, f)));
      return reply.send({ twinId, products: await Promise.all(products) });
    } catch {
      return reply.send({ twinId, products: [] });
    }
  });

  // ── Mini 4 Pro GSD calculator ──────────────────────────────────
  fastify.get('/drones/mini4pro/gsd', async (request: FastifyRequest, reply: FastifyReply) => {
    const { altitude, megapixels } = request.query as { altitude?: string; megapixels?: string };
    try {
      const engineRes = await fetch(
        `${ENGINE_URL}/drones/mini4pro/gsd?altitude=${altitude || '60'}&megapixels=${megapixels || '48'}`,
      );
      if (!engineRes.ok) return reply.code(502).send({ error: 'Engine error' });
      return reply.send(await engineRes.json());
    } catch {
      return reply.code(502).send({ error: 'Engine unreachable' });
    }
  });

  // ── Mini 4 Pro flight estimate ─────────────────────────────────
  fastify.post('/drones/mini4pro/estimate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const engineRes = await fetch(`${ENGINE_URL}/drones/mini4pro/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      if (!engineRes.ok) return reply.code(502).send({ error: 'Engine error' });
      return reply.send(await engineRes.json());
    } catch {
      return reply.code(502).send({ error: 'Engine unreachable' });
    }
  });
}
