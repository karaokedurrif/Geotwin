/**
 * IoT API Routes — Sensors, readings, and real-time data.
 * 
 * Endpoints:
 *   GET  /iot/:twinId/sensors          — List sensors for a twin
 *   POST /iot/:twinId/sensors          — Create/upsert sensor
 *   POST /iot/:twinId/readings         — Ingest sensor readings (batch)
 *   GET  /iot/:twinId/readings         — Query time-series readings
 *   GET  /iot/:twinId/readings/latest  — Latest reading per sensor
 *   GET  /iot/:twinId/alerts           — Active alerts
 *   GET  /iot/:twinId/stats            — Aggregate IoT stats
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db.js';

export async function iotRouter(fastify: FastifyInstance) {
  // ── List sensors for a twin ──────────────────────────────────────────
  fastify.get('/iot/:twinId/sensors', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };

    const result = await query(
      `SELECT id, type, name, unit, status,
              ST_X(location::geometry) AS lon,
              ST_Y(location::geometry) AS lat,
              metadata, created_at
       FROM sensors WHERE twin_id = $1
       ORDER BY type, name`,
      [twinId]
    );

    return reply.send({
      twinId,
      count: result.rows.length,
      sensors: result.rows,
    });
  });

  // ── Create / upsert sensor ───────────────────────────────────────────
  fastify.post('/iot/:twinId/sensors', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };
    const body = request.body as {
      id: string;
      type: string;
      name?: string;
      lon: number;
      lat: number;
      unit?: string;
      metadata?: Record<string, unknown>;
    };

    await query(
      `INSERT INTO sensors (id, twin_id, type, name, location, unit, metadata)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         type = EXCLUDED.type,
         name = EXCLUDED.name,
         location = EXCLUDED.location,
         unit = EXCLUDED.unit,
         metadata = EXCLUDED.metadata`,
      [body.id, twinId, body.type, body.name || null, body.lon, body.lat,
       body.unit || '°C', JSON.stringify(body.metadata || {})]
    );

    return reply.code(201).send({ ok: true, sensorId: body.id });
  });

  // ── Ingest readings (batch) ──────────────────────────────────────────
  fastify.post('/iot/:twinId/readings', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      readings: Array<{
        sensor_id: string;
        value: number;
        time?: string;
        quality?: number;
      }>;
    };

    if (!body.readings || !Array.isArray(body.readings)) {
      return reply.code(400).send({ error: 'readings array required' });
    }

    // Batch insert using unnest for efficiency
    const sensorIds: string[] = [];
    const values: number[] = [];
    const times: string[] = [];
    const qualities: number[] = [];

    for (const r of body.readings) {
      sensorIds.push(r.sensor_id);
      values.push(r.value);
      times.push(r.time || new Date().toISOString());
      qualities.push(r.quality ?? 100);
    }

    await query(
      `INSERT INTO sensor_readings (sensor_id, value, time, quality)
       SELECT * FROM unnest($1::text[], $2::float8[], $3::timestamptz[], $4::smallint[])`,
      [sensorIds, values, times, qualities]
    );

    return reply.send({ ok: true, count: body.readings.length });
  });

  // ── Query time-series readings ───────────────────────────────────────
  fastify.get('/iot/:twinId/readings', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };
    const qs = request.query as {
      sensor_id?: string;
      from?: string;
      to?: string;
      interval?: string;  // '1h', '15m', '1d'
      limit?: string;
    };

    const from = qs.from || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const to = qs.to || new Date().toISOString();
    const limit = parseInt(qs.limit || '1000');

    if (qs.interval) {
      // Aggregated data (time_bucket)
      const result = await query(
        `SELECT time_bucket($1::interval, sr.time) AS bucket,
                sr.sensor_id,
                AVG(sr.value) AS avg_value,
                MIN(sr.value) AS min_value,
                MAX(sr.value) AS max_value,
                COUNT(*) AS samples
         FROM sensor_readings sr
         JOIN sensors s ON s.id = sr.sensor_id
         WHERE s.twin_id = $2
           AND sr.time >= $3::timestamptz
           AND sr.time <= $4::timestamptz
           ${qs.sensor_id ? 'AND sr.sensor_id = $5' : ''}
         GROUP BY bucket, sr.sensor_id
         ORDER BY bucket DESC
         LIMIT $${qs.sensor_id ? '6' : '5'}`,
        qs.sensor_id
          ? [qs.interval, twinId, from, to, qs.sensor_id, limit]
          : [qs.interval, twinId, from, to, limit]
      );
      return reply.send({ twinId, aggregated: true, interval: qs.interval, data: result.rows });
    }

    // Raw readings
    const result = await query(
      `SELECT sr.time, sr.sensor_id, sr.value, sr.quality
       FROM sensor_readings sr
       JOIN sensors s ON s.id = sr.sensor_id
       WHERE s.twin_id = $1
         AND sr.time >= $2::timestamptz
         AND sr.time <= $3::timestamptz
         ${qs.sensor_id ? 'AND sr.sensor_id = $4' : ''}
       ORDER BY sr.time DESC
       LIMIT $${qs.sensor_id ? '5' : '4'}`,
      qs.sensor_id
        ? [twinId, from, to, qs.sensor_id, limit]
        : [twinId, from, to, limit]
    );

    return reply.send({ twinId, count: result.rows.length, data: result.rows });
  });

  // ── Latest reading per sensor ────────────────────────────────────────
  fastify.get('/iot/:twinId/readings/latest', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };

    const result = await query(
      `SELECT DISTINCT ON (s.id)
              s.id AS sensor_id, s.type, s.name, s.unit, s.status,
              ST_X(s.location::geometry) AS lon,
              ST_Y(s.location::geometry) AS lat,
              sr.value, sr.time, sr.quality
       FROM sensors s
       LEFT JOIN sensor_readings sr ON sr.sensor_id = s.id
       WHERE s.twin_id = $1
       ORDER BY s.id, sr.time DESC`,
      [twinId]
    );

    return reply.send({
      twinId,
      sensors: result.rows.map(r => ({
        id: r.sensor_id,
        type: r.type,
        name: r.name,
        lon: r.lon,
        lat: r.lat,
        value: r.value,
        unit: r.unit,
        status: r.status,
        lastReading: r.time,
        quality: r.quality,
      })),
    });
  });

  // ── Active alerts ────────────────────────────────────────────────────
  fastify.get('/iot/:twinId/alerts', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };
    const qs = request.query as { acknowledged?: string };
    const showAck = qs.acknowledged === 'true';

    const result = await query(
      `SELECT id, sensor_id, severity, message, value, threshold, acknowledged, created_at
       FROM alerts
       WHERE twin_id = $1 ${showAck ? '' : 'AND acknowledged = FALSE'}
       ORDER BY created_at DESC
       LIMIT 50`,
      [twinId]
    );

    return reply.send({ twinId, count: result.rows.length, alerts: result.rows });
  });

  // ── IoT stats summary ───────────────────────────────────────────────
  fastify.get('/iot/:twinId/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };

    const sensors = await query(
      `SELECT type, COUNT(*) AS count, 
              SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS online,
              SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS issues
       FROM sensors WHERE twin_id = $1 GROUP BY type`,
      [twinId]
    );

    const last24h = await query(
      `SELECT COUNT(*) AS total_readings,
              COUNT(DISTINCT sr.sensor_id) AS active_sensors
       FROM sensor_readings sr
       JOIN sensors s ON s.id = sr.sensor_id
       WHERE s.twin_id = $1
         AND sr.time >= NOW() - INTERVAL '24 hours'`,
      [twinId]
    );

    const alerts = await query(
      `SELECT severity, COUNT(*) AS count
       FROM alerts WHERE twin_id = $1 AND acknowledged = FALSE
       GROUP BY severity`,
      [twinId]
    );

    return reply.send({
      twinId,
      sensorsByType: sensors.rows,
      last24h: last24h.rows[0] || { total_readings: 0, active_sensors: 0 },
      activeAlerts: alerts.rows,
    });
  });
}
