/**
 * IoT Seed — Generates realistic sensor data for a twin.
 * 
 * Usage:
 *   POST /api/iot/:twinId/seed   — Generates sensors + 7 days of readings
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db.js';

// Sensor templates for extensive cattle farming
const SENSOR_TEMPLATES = [
  { suffix: 'temp-amb-1', type: 'TEMPERATURE', name: 'Temperatura Ambiente Norte', unit: '°C', base: 18, amplitude: 8, noise: 1.5 },
  { suffix: 'temp-amb-2', type: 'TEMPERATURE', name: 'Temperatura Ambiente Sur', unit: '°C', base: 19, amplitude: 7, noise: 1.2 },
  { suffix: 'temp-suelo', type: 'TEMPERATURE', name: 'Temperatura Suelo', unit: '°C', base: 14, amplitude: 4, noise: 0.8 },
  { suffix: 'hum-1', type: 'HUMIDITY', name: 'Humedad Relativa', unit: '%', base: 55, amplitude: 20, noise: 3 },
  { suffix: 'nh3-1', type: 'NH3', name: 'Amoníaco Zona Ganado', unit: 'ppm', base: 8, amplitude: 6, noise: 2 },
  { suffix: 'co2-1', type: 'CO2', name: 'CO₂ Ambiente', unit: 'ppm', base: 420, amplitude: 80, noise: 15 },
  { suffix: 'moist-1', type: 'MOISTURE', name: 'Humedad Suelo Parcela A', unit: '%', base: 35, amplitude: 10, noise: 2 },
  { suffix: 'moist-2', type: 'MOISTURE', name: 'Humedad Suelo Parcela B', unit: '%', base: 30, amplitude: 12, noise: 3 },
  { suffix: 'rain-1', type: 'RAIN', name: 'Pluviómetro', unit: 'mm/h', base: 0, amplitude: 0, noise: 0 },
  { suffix: 'wind-1', type: 'WIND', name: 'Anemómetro', unit: 'km/h', base: 12, amplitude: 8, noise: 4 },
  { suffix: 'weight-1', type: 'WEIGHT', name: 'Báscula Corrales', unit: 'kg', base: 450, amplitude: 0, noise: 15 },
];

export async function iotSeedRouter(fastify: FastifyInstance) {
  /**
   * POST /iot/:twinId/seed
   * Generates demo sensors + 7 days of time-series data
   */
  fastify.post('/iot/:twinId/seed', async (request: FastifyRequest, reply: FastifyReply) => {
    const { twinId } = request.params as { twinId: string };
    const body = (request.body || {}) as { days?: number; interval_minutes?: number };
    const days = Math.min(body.days || 7, 30);
    const intervalMin = body.interval_minutes || 15;

    // Check if twin data exists
    const DATA_DIR = process.env.DATA_DIR || './data';
    const fs = await import('fs');
    const path = await import('path');
    const twinDir = path.join(DATA_DIR, twinId);

    if (!fs.existsSync(twinDir)) {
      return reply.code(404).send({ error: `Twin ${twinId} not found` });
    }

    // Read scene.json to get centroid
    let centroid = { lon: -5.8, lat: 37.4 }; // Default: Córdoba
    try {
      const scenePath = path.join(twinDir, 'scene.json');
      if (fs.existsSync(scenePath)) {
        const scene = JSON.parse(fs.readFileSync(scenePath, 'utf-8'));
        if (scene.centroid) {
          centroid = { lon: scene.centroid[0], lat: scene.centroid[1] };
        } else if (scene.camera) {
          centroid = { lon: scene.camera.longitude, lat: scene.camera.latitude };
        }
      }
    } catch { /* use default */ }

    // Ensure twin exists in DB
    await query(
      `INSERT INTO twins (twin_id, name, centroid)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326))
       ON CONFLICT (twin_id) DO NOTHING`,
      [twinId, `Twin ${twinId}`, centroid.lon, centroid.lat]
    );

    // Generate sensor positions spread around centroid
    const sensorCount = SENSOR_TEMPLATES.length;
    let sensorsCreated = 0;

    for (let i = 0; i < sensorCount; i++) {
      const tmpl = SENSOR_TEMPLATES[i];
      const angle = (2 * Math.PI * i) / sensorCount;
      const radiusKm = 0.15 + Math.random() * 0.3; // 150-450m
      const sLon = centroid.lon + (radiusKm / 111.32) * Math.cos(angle);
      const sLat = centroid.lat + (radiusKm / 110.57) * Math.sin(angle);
      const sensorId = `${twinId}-${tmpl.suffix}`;

      await query(
        `INSERT INTO sensors (id, twin_id, type, name, location, unit, metadata)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, location = EXCLUDED.location`,
        [sensorId, twinId, tmpl.type, tmpl.name, sLon, sLat, tmpl.unit, '{}']
      );
      sensorsCreated++;
    }

    // Generate time-series readings
    const now = new Date();
    const startTime = new Date(now.getTime() - days * 24 * 3600 * 1000);
    const totalPoints = Math.floor((days * 24 * 60) / intervalMin);
    let totalReadings = 0;

    // Batch insert: 500 readings per INSERT for speed
    const BATCH_SIZE = 500;
    let batchSensorIds: string[] = [];
    let batchValues: number[] = [];
    let batchTimes: string[] = [];
    let batchQualities: number[] = [];

    const flushBatch = async () => {
      if (batchSensorIds.length === 0) return;
      await query(
        `INSERT INTO sensor_readings (sensor_id, value, time, quality)
         SELECT * FROM unnest($1::text[], $2::float8[], $3::timestamptz[], $4::smallint[])`,
        [batchSensorIds, batchValues, batchTimes, batchQualities]
      );
      totalReadings += batchSensorIds.length;
      batchSensorIds = [];
      batchValues = [];
      batchTimes = [];
      batchQualities = [];
    };

    // Simulate rain events (random 2-6 hour windows)
    const rainEvents: Array<{ start: number; end: number; intensity: number }> = [];
    const numRainEvents = Math.floor(days / 2);
    for (let r = 0; r < numRainEvents; r++) {
      const start = startTime.getTime() + Math.random() * days * 24 * 3600 * 1000;
      const duration = (2 + Math.random() * 4) * 3600 * 1000;
      rainEvents.push({ start, end: start + duration, intensity: 1 + Math.random() * 12 });
    }

    for (let p = 0; p < totalPoints; p++) {
      const t = new Date(startTime.getTime() + p * intervalMin * 60 * 1000);
      const hourOfDay = t.getHours() + t.getMinutes() / 60;
      // Diurnal cycle: peak at 14:00, minimum at 5:00
      const diurnalFactor = Math.sin(((hourOfDay - 5) / 24) * 2 * Math.PI);

      for (let s = 0; s < sensorCount; s++) {
        const tmpl = SENSOR_TEMPLATES[s];
        const sensorId = `${twinId}-${tmpl.suffix}`;
        let value: number;

        if (tmpl.type === 'RAIN') {
          // Rain: check if in a rain event
          const inRain = rainEvents.find(re => t.getTime() >= re.start && t.getTime() <= re.end);
          value = inRain ? inRain.intensity * (0.5 + Math.random()) : 0;
        } else if (tmpl.type === 'WEIGHT') {
          // Weight: only simulate once per day (morning weighing)
          if (hourOfDay >= 7 && hourOfDay < 8) {
            value = tmpl.base + (Math.random() - 0.5) * tmpl.noise * 2;
          } else {
            continue; // Skip non-weighing times
          }
        } else {
          // Normal sensor: base + diurnal cycle + noise
          value = tmpl.base + tmpl.amplitude * diurnalFactor + (Math.random() - 0.5) * tmpl.noise * 2;
          // Humidity inversely correlates with temperature
          if (tmpl.type === 'HUMIDITY') {
            value = tmpl.base - tmpl.amplitude * diurnalFactor + (Math.random() - 0.5) * tmpl.noise * 2;
          }
          // NH3 peaks in warm hours
          if (tmpl.type === 'NH3') {
            value = Math.max(0, value);
          }
          // Soil moisture drops during rain
          if (tmpl.type === 'MOISTURE') {
            const inRain = rainEvents.find(re => t.getTime() >= re.start && t.getTime() <= re.end);
            if (inRain) value += 10;
          }
        }

        batchSensorIds.push(sensorId);
        batchValues.push(Math.round(value * 100) / 100);
        batchTimes.push(t.toISOString());
        batchQualities.push(Math.random() > 0.02 ? 100 : Math.floor(50 + Math.random() * 40));

        if (batchSensorIds.length >= BATCH_SIZE) {
          await flushBatch();
        }
      }
    }

    await flushBatch();

    // Generate a few alerts
    const alertMessages = [
      { sensor: `${twinId}-nh3-1`, severity: 'warning', message: 'NH₃ elevado: supera 15 ppm', value: 16.2, threshold: 15 },
      { sensor: `${twinId}-temp-amb-1`, severity: 'info', message: 'Temperatura máxima: 32°C', value: 32.1, threshold: 30 },
    ];

    for (const alert of alertMessages) {
      await query(
        `INSERT INTO alerts (twin_id, sensor_id, severity, message, value, threshold)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [twinId, alert.sensor, alert.severity, alert.message, alert.value, alert.threshold]
      );
    }

    return reply.send({
      ok: true,
      twinId,
      sensorsCreated,
      readingsGenerated: totalReadings,
      days,
      intervalMinutes: intervalMin,
      alerts: alertMessages.length,
    });
  });
}
