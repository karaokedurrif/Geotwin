import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { GeoJSONGeometry } from '@geotwin/types';
import { createROI, getROI, getAllROIs } from '../services/roi-service.js';
import { getTerrainForROI, type TerrainSource } from '../services/terrain-service.js';
import { getImageryForROI } from '../services/imagery-service.js';
import { getLiDARTiles } from '../services/lidar-service.js';

interface CreateROIBody {
  geometry: GeoJSONGeometry;
  bufferMeters?: number;
}

interface TerrainQuery {
  roi: string;
  source?: TerrainSource;
}

interface ImageryQuery {
  roi: string;
  preferWMS?: string;
}

/**
 * Geospatial services router
 * Handles ROI creation, terrain, and imagery endpoints
 */
export async function geospatialRouter(fastify: FastifyInstance) {
  // === ROI ENDPOINTS ===
  
  /**
   * POST /roi
   * Create or retrieve an ROI from geometry
   */
  fastify.post<{ Body: CreateROIBody }>('/roi', async (request, reply) => {
    const { geometry, bufferMeters = 100 } = request.body;

    if (!geometry || !geometry.type || !geometry.coordinates) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid geometry - must be valid GeoJSON geometry',
      });
    }

    try {
      const roi = createROI(geometry, bufferMeters);
      
      fastify.log.info(`ROI created: ${roi.id}`);
      fastify.log.info(`  Centroid: [${roi.centroid[0].toFixed(4)}, ${roi.centroid[1].toFixed(4)}]`);
      fastify.log.info(`  Bbox: [${roi.bbox.map((v) => v.toFixed(4)).join(', ')}]`);
      fastify.log.info(`  Area: ${(roi.area_m2 / 10000).toFixed(2)} ha`);

      return reply.send({
        success: true,
        roi,
      });
    } catch (error) {
      fastify.log.error(`Error creating ROI: ${error instanceof Error ? error.message : 'Unknown'}`);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /roi/:id
   * Get ROI by ID
   */
  fastify.get<{ Params: { id: string } }>('/roi/:id', async (request, reply) => {
    const { id } = request.params;
    const roi = getROI(id);

    if (!roi) {
      return reply.code(404).send({
        success: false,
        error: 'ROI not found',
      });
    }

    return reply.send({
      success: true,
      roi,
    });
  });

  /**
   * GET /roi
   * List all ROIs
   */
  fastify.get('/roi', async (_request, reply) => {
    const rois = getAllROIs();
    return reply.send({
      success: true,
      count: rois.length,
      rois,
    });
  });

  // === TERRAIN ENDPOINTS ===

  /**
   * GET /terrain
   * Get terrain data for ROI
   * Query params:
   *   - roi: ROI ID (required)
   *   - source: 'cnig' | 'cesium' (optional, default: 'cnig')
   */
  fastify.get<{ Querystring: TerrainQuery }>('/terrain', async (request, reply) => {
    const { roi: roiId, source = 'cnig' } = request.query;

    if (!roiId) {
      return reply.code(400).send({
        success: false,
        error: 'Missing required query parameter: roi',
      });
    }

    const roi = getROI(roiId);
    if (!roi) {
      return reply.code(404).send({
        success: false,
        error: 'ROI not found',
      });
    }

    try {
      const terrainData = await getTerrainForROI(roi, source);
      
      fastify.log.info(`Terrain request for ${roiId}: ${terrainData.type} (${terrainData.source})`);
      
      return reply.send({
        success: true,
        terrain: terrainData,
      });
    } catch (error) {
      fastify.log.error(`Error getting terrain: ${error instanceof Error ? error.message : 'Unknown'}`);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // === IMAGERY ENDPOINTS ===

  /**
   * GET /imagery/pnoa
   * Get PNOA imagery configuration for ROI
   * Query params:
   *   - roi: ROI ID (required)
   *   - preferWMS: 'true' | 'false' (optional, default: false)
   */
  fastify.get<{ Querystring: ImageryQuery }>('/imagery/pnoa', async (request, reply) => {
    const { roi: roiId, preferWMS } = request.query;

    if (!roiId) {
      return reply.code(400).send({
        success: false,
        error: 'Missing required query parameter: roi',
      });
    }

    const roi = getROI(roiId);
    if (!roi) {
      return reply.code(404).send({
        success: false,
        error: 'ROI not found',
      });
    }

    try {
      const imageryData = getImageryForROI(roi, preferWMS === 'true');
      
      fastify.log.info(`PNOA imagery request for ${roiId}: ${imageryData.type}`);
      
      return reply.send({
        success: true,
        imagery: imageryData,
      });
    } catch (error) {
      fastify.log.error(`Error getting imagery: ${error instanceof Error ? error.message : 'Unknown'}`);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // === LIDAR ENDPOINTS (PRO - STUB) ===

  /**
   * GET /lidar/tiles
   * Get LiDAR 3D Tiles for ROI (PRO feature - stub)
   * Query params:
   *   - roi: ROI ID (required)
   */
  fastify.get<{ Querystring: { roi: string } }>('/lidar/tiles', async (request, reply) => {
    const { roi: roiId } = request.query;

    if (!roiId) {
      return reply.code(400).send({
        success: false,
        error: 'Missing required query parameter: roi',
      });
    }

    const roi = getROI(roiId);
    if (!roi) {
      return reply.code(404).send({
        success: false,
        error: 'ROI not found',
      });
    }

    try {
      const lidarData = await getLiDARTiles(roi);
      
      fastify.log.info(`LiDAR request for ${roiId}: ${lidarData.type}`);
      
      return reply.send({
        success: true,
        lidar: lidarData,
      });
    } catch (error) {
      fastify.log.error(`Error getting LiDAR: ${error instanceof Error ? error.message : 'Unknown'}`);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
