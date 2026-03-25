import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { importRouter } from './routes/import.js';
import { ndviRouter } from './routes/ndvi.js';
import { geospatialRouter } from './routes/geospatial.js';
import { tilesRouter } from './routes/tiles.js';
import { iotRouter } from './routes/iot.js';
import { iotSeedRouter } from './routes/iot-seed.js';
import { dronesRouter } from './routes/drones.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Main Fastify server for GeoTwin API
 */
async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: 'info',
    },
    bodyLimit: 50 * 1024 * 1024, // 50MB for large files
  });

  // Register plugins
  await fastify.register(cors, {
    origin: true, // Allow all origins in development
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register routes
  await fastify.register(importRouter, { prefix: '/api' });
  await fastify.register(ndviRouter, { prefix: '/api' });
  await fastify.register(geospatialRouter, { prefix: '/api' });
  await fastify.register(tilesRouter, { prefix: '/api' });
  await fastify.register(iotRouter, { prefix: '/api' });
  await fastify.register(iotSeedRouter, { prefix: '/api' });
  await fastify.register(dronesRouter, { prefix: '/api' });

  return fastify;
}

/**
 * Start the server
 */
async function start() {
  try {
    const server = await buildServer();
    await server.listen({ port: PORT, host: HOST });
    console.log(`🚀 GeoTwin API running at http://${HOST}:${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
}

start();
