/**
 * Twin Store - localStorage persistence for Digital Twin snapshots
 * Saves generated twins for later editing in Twin Studio
 */

import type { TwinRecipe } from '@geotwin/types';

const STORAGE_KEY = 'geotwin_snapshots';
const VERSION = '1.0';

/**
 * Visual style settings that can be changed in Studio
 */
export interface VisualStyle {
  preset: 'default' | 'natural' | 'ndvi' | 'topo' | 'night' | 'minimal' | 'pendientes';
  fillColor: string;        // hex color for parcel fill
  fillOpacity: number;      // 0-1
  boundaryColor: string;    // hex color for boundary line
  boundaryWidth: number;    // pixels
  terrainExaggeration: number;
  enableLighting: boolean;
  timeOfDay: string;        // ISO time string for sun position
  atmosphereDensity: number;
}

/**
 * Sensor data for IoT monitoring
 */
export interface SensorData {
  id: string;
  type: 'TEMPERATURE' | 'NH3' | 'CO2' | 'MOISTURE' | 'WEIGHT';
  lat: number;
  lon: number;
  value: number;
  unit: string;
  status: 'ok' | 'warning' | 'error';
  lastUpdate: string;
}

/**
 * Cattle tracking data
 */
export interface CattleData {
  id: string;
  lat: number;
  lon: number;
  weight: number;
  collarId: string;
  health: 'good' | 'attention' | 'alert';
}

/**
 * Infrastructure elements (BIM)
 */
export interface InfrastructureData {
  id: string;
  type: 'BARN' | 'SILO' | 'WATER_POINT' | 'FENCE';
  geometry: any; // GeoJSON Feature
  height?: number;
}

/**
 * ESG/Environmental metrics
 */
export interface ESGData {
  co2eq_ton_year: number;
  ndvi_mean: number;
  carbon_credits_potential: number;
}

/**
 * Complete snapshot of a Digital Twin state
 * Saved to localStorage after generation, loaded in Studio
 */
export interface TwinSnapshot {
  version: string;          // Snapshot format version
  twinId: string;           // Unique identifier (10-char alphanumeric)
  timestamp: string;        // ISO timestamp of creation
  
  // Parcel geometry and metadata
  parcel: {
    sourceFile: string;
    name?: string;
    geojson: any;           // GeoJSON FeatureCollection
    area_ha: number;
    centroid: [number, number];
    perimeter_m?: number;
    vertexCount?: number;
    sourceSrs?: string;
    reprojected?: boolean;
    preset?: string;
  };
  
  // Layer data (optional, populated in studio)
  sensors?: SensorData[];
  cattle?: CattleData[];
  infrastructure?: InfrastructureData[];
  
  // Layer visibility state
  layers: Record<string, boolean>;
  
  // Camera position
  camera: {
    headingDeg: number;
    pitchDeg: number;
    range_m: number;
    centerLon: number;
    centerLat: number;
  };
  
  // Visual appearance settings
  visualStyle?: VisualStyle;
  
  // Mesh generation state
  meshStatus?: 'none' | 'processing' | 'completed' | 'failed';
  meshJobId?: string;
  
  // ESG metrics
  esg?: ESGData;
}

/**
 * Default visual style for new snapshots
 */
export const DEFAULT_VISUAL_STYLE: VisualStyle = {
  preset: 'default',
  fillColor: '#00d4ff',
  fillOpacity: 0.09,
  boundaryColor: '#f0c040',
  boundaryWidth: 2.0,
  terrainExaggeration: 2.0,
  enableLighting: true,
  timeOfDay: '2026-06-15T09:30:00Z',
  atmosphereDensity: 0.0002,
};

/**
 * Twin Store API
 * All methods work with localStorage
 */
export const twinStore = {
  
  /**
   * Save a snapshot to localStorage
   * Overwrites if twinId already exists
   */
  save(snapshot: TwinSnapshot): void {
    try {
      const all = this.list();
      all[snapshot.twinId] = {
        ...snapshot,
        version: VERSION,
        timestamp: snapshot.timestamp || new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      console.log(`[twinStore] Saved snapshot: ${snapshot.twinId}`);
    } catch (error) {
      console.error('[twinStore] Failed to save snapshot:', error);
      throw new Error('Failed to save twin snapshot to localStorage');
    }
  },

  /**
   * Get a single snapshot by twinId
   * Returns null if not found
   */
  get(twinId: string): TwinSnapshot | null {
    try {
      const all = this.list();
      const snapshot = all[twinId] || null;
      if (snapshot) {
        console.log(`[twinStore] Loaded snapshot: ${twinId}`);
      } else {
        console.warn(`[twinStore] Snapshot not found: ${twinId}`);
      }
      return snapshot;
    } catch (error) {
      console.error('[twinStore] Failed to get snapshot:', error);
      return null;
    }
  },

  /**
   * List all saved snapshots
   * Returns an object keyed by twinId
   */
  list(): Record<string, TwinSnapshot> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      
      const parsed = JSON.parse(raw);
      console.log(`[twinStore] Listed ${Object.keys(parsed).length} snapshot(s)`);
      return parsed;
    } catch (error) {
      console.error('[twinStore] Failed to list snapshots:', error);
      return {};
    }
  },

  /**
   * Get all snapshots as an array, sorted by timestamp (newest first)
   */
  listArray(): TwinSnapshot[] {
    const all = this.list();
    return Object.values(all).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  },

  /**
   * Delete a snapshot by twinId
   */
  delete(twinId: string): void {
    try {
      const all = this.list();
      if (all[twinId]) {
        delete all[twinId];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        console.log(`[twinStore] Deleted snapshot: ${twinId}`);
      } else {
        console.warn(`[twinStore] Cannot delete, not found: ${twinId}`);
      }
    } catch (error) {
      console.error('[twinStore] Failed to delete snapshot:', error);
      throw new Error('Failed to delete twin snapshot');
    }
  },

  /**
   * Update mesh processing status for a twin
   */
  updateMeshStatus(twinId: string, meshStatus: 'none' | 'processing' | 'completed' | 'failed'): void {
    try {
      const all = this.list();
      if (all[twinId]) {
        all[twinId].meshStatus = meshStatus;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      }
    } catch {
      // Silently fail — this is an optimization, not critical
    }
  },

  /**
   * Import a snapshot from JSON string
   * Validates format before saving
   */
  importFromJSON(jsonString: string): TwinSnapshot {
    try {
      const snapshot = JSON.parse(jsonString) as TwinSnapshot;
      
      // Validate required fields
      if (!snapshot.twinId) {
        throw new Error('Missing twinId in snapshot');
      }
      if (!snapshot.parcel?.geojson) {
        throw new Error('Missing parcel geometry in snapshot');
      }
      if (!snapshot.parcel.centroid || !snapshot.parcel.area_ha) {
        throw new Error('Missing parcel metadata in snapshot');
      }
      
      // Save and return
      this.save(snapshot);
      console.log(`[twinStore] Imported snapshot from JSON: ${snapshot.twinId}`);
      return snapshot;
    } catch (error) {
      console.error('[twinStore] Failed to import JSON:', error);
      throw new Error(
        error instanceof Error 
          ? `Invalid snapshot format: ${error.message}`
          : 'Invalid snapshot JSON'
      );
    }
  },

  /**
   * Export a snapshot as JSON string (for download)
   */
  exportToJSON(twinId: string): string {
    const snapshot = this.get(twinId);
    if (!snapshot) {
      throw new Error(`Cannot export, snapshot not found: ${twinId}`);
    }
    return JSON.stringify(snapshot, null, 2);
  },

  /**
   * Clear all snapshots (for testing/reset)
   */
  clearAll(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      console.log('[twinStore] Cleared all snapshots');
    } catch (error) {
      console.error('[twinStore] Failed to clear snapshots:', error);
    }
  },
};

/**
 * Generate a unique twin ID (10-character alphanumeric)
 * Excludes ambiguous characters: 0, O, I, 1, l
 */
export function generateTwinId(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 10; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Build a snapshot from a TwinRecipe (after generation)
 */
export function createSnapshotFromRecipe(
  recipe: TwinRecipe,
  geojson: any,
  sourceFile: string,
  layers: Record<string, boolean>,
  camera: TwinSnapshot['camera']
): TwinSnapshot {
  const twinId = generateTwinId();
  
  return {
    version: VERSION,
    twinId,
    timestamp: new Date().toISOString(),
    
    parcel: {
      sourceFile,
      name: recipe.presetConfig?.displayName,
      geojson,
      area_ha: recipe.area_ha,
      centroid: recipe.centroid,
      preset: recipe.preset,
      // These will be populated if available
      perimeter_m: undefined,
      vertexCount: undefined,
      sourceSrs: undefined,
      reprojected: undefined,
    },
    
    sensors: (recipe as any).sensors || [],
    cattle: (recipe as any).cattle || [],
    infrastructure: (recipe as any).infrastructure || [],
    
    layers,
    camera,
    
    visualStyle: DEFAULT_VISUAL_STYLE,
    
    esg: (recipe as any).esg,
  };
}
