'use client';

import { useEffect, useRef, useState } from 'react';
import type { TwinSnapshot, VisualStyle } from '@/lib/twinStore';

import type { StudioMode } from './StudioBottomBar';

interface StudioViewerProps {
  snapshot: TwinSnapshot;
  visualStyle: VisualStyle;
  layerState: Record<string, boolean>;
  activeMode: StudioMode;
  onViewerReady: (viewer: any) => void;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Loads parcel from snapshot and creates 3 entities:
 * - parcel-fill: Cyan polygon clamped to terrain
 * - parcel-boundary-line: Gold outline clamped to terrain
 * - parcel-plinth: 3D geological cut (hidden by default)
 */
async function loadParcelFromSnapshot(
  viewer: any,
  snapshot: TwinSnapshot,
  style: VisualStyle
): Promise<void> {
  const Cesium = window.Cesium;
  if (!Cesium || !snapshot.parcel?.geojson || !viewer || viewer.isDestroyed?.()) {
    console.warn('[loadParcel] No Cesium or GeoJSON available');
    return;
  }

  console.log('[loadParcel] Starting parcel load...', { twinId: snapshot.twinId });

  // Parse GeoJSON to extract coordinates
  const geojson = snapshot.parcel.geojson;
  let coordinates: number[][] = [];

  if (geojson.type === 'FeatureCollection' && geojson.features?.[0]) {
    const geom = geojson.features[0].geometry;
    if (geom.type === 'Polygon' && geom.coordinates?.[0]) {
      coordinates = geom.coordinates[0];
    }
  } else if (geojson.type === 'Feature') {
    const geom = geojson.geometry;
    if (geom.type === 'Polygon' && geom.coordinates?.[0]) {
      coordinates = geom.coordinates[0];
    }
  }

  if (coordinates.length === 0) {
    console.error('[loadParcel] No polygon coordinates found in GeoJSON');
    return;
  }

  console.log('[loadParcel] Extracted coordinates:', coordinates.length, 'vertices');

  // Convert to Cartographic for terrain sampling
  const positions = coordinates.map(([lon, lat]) =>
    Cesium.Cartographic.fromDegrees(lon, lat)
  );

  // Sample terrain heights at each vertex
  try {
    const terrainProvider = viewer.terrainProvider;
    const sampledPositions = await Cesium.sampleTerrainMostDetailed(terrainProvider, positions);
    if (viewer.isDestroyed?.()) return;
    console.log('[loadParcel] ✓ Terrain sampled at', sampledPositions.length, 'points');

    // Convert hex color to Cesium.Color
    const hexToColor = (hex: string, alpha: number = 1.0) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (!result) return Cesium.Color.CYAN.withAlpha(alpha);
      return Cesium.Color.fromBytes(
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
        Math.round(alpha * 255)
      );
    };

    const fillColor = hexToColor(style.fillColor, style.fillOpacity);
    const boundaryColor = hexToColor(style.boundaryColor, 1.0);

    // Remove existing parcel entities
    const existingFill = viewer.entities.getById('parcel-fill');
    const existingBoundary = viewer.entities.getById('parcel-boundary-line');
    const existingPlinth = viewer.entities.getById('parcel-plinth');
    if (existingFill) viewer.entities.remove(existingFill);
    if (existingBoundary) viewer.entities.remove(existingBoundary);
    if (existingPlinth) viewer.entities.remove(existingPlinth);

    // 1. Create parcel fill — RELATIVE_TO_GROUND with +0.5m offset
    //    Avoids classification-primitive displacement caused by terrain LOD
    //    mismatches and verticalExaggeration.
    viewer.entities.add({
      id: 'parcel-fill',
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(
          coordinates.flatMap(([lon, lat]) => [lon, lat])
        ),
        material: fillColor,
        height: 0.5,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        outline: false,
      },
    });
    console.log('[loadParcel] ✓ Created parcel-fill (RELATIVE_TO_GROUND +0.5m)');

    // 2. Create parcel boundary line (polyline clamped to terrain)
    viewer.entities.add({
      id: 'parcel-boundary-line',
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(
          [...coordinates, coordinates[0]].flatMap(([lon, lat]) => [lon, lat])
        ),
        width: style.boundaryWidth,
        material: boundaryColor,
        clampToGround: true,
      },
    });
    console.log('[loadParcel] ✓ Created parcel-boundary-line');

    // 3. Create parcel plinth (3D geological cut, hidden by default)
    const plinthPositions = sampledPositions.flatMap((pos: any) => [
      Cesium.Cartographic.toCartesian(pos), // Top at terrain height
      Cesium.Cartesian3.fromRadians(pos.longitude, pos.latitude, pos.height - 200), // Bottom 200m below
    ]);

    viewer.entities.add({
      id: 'parcel-plinth',
      wall: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(
          sampledPositions.flatMap((pos: any) => [
            Cesium.Math.toDegrees(pos.longitude),
            Cesium.Math.toDegrees(pos.latitude),
            pos.height,
          ])
        ),
        minimumHeights: sampledPositions.map((pos: any) => pos.height - 200),
        material: Cesium.Color.SANDYBROWN.withAlpha(0.8),
        outline: false,
      },
      show: false, // Hidden by default
    });
    console.log('[loadParcel] ✓ Created parcel-plinth (hidden)');

  } catch (error) {
    console.error('[loadParcel] Terrain sampling failed:', error);
    // Fallback: create entities without terrain heights
    const fillColor = hexToColor(style.fillColor, style.fillOpacity);
    const boundaryColor = hexToColor(style.boundaryColor, 1.0);

    viewer.entities.add({
      id: 'parcel-fill',
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(
          coordinates.flatMap(([lon, lat]) => [lon, lat])
        ),
        material: fillColor,
        height: 0.5,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        outline: false,
      },
    });

    viewer.entities.add({
      id: 'parcel-boundary-line',
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(
          [...coordinates, coordinates[0]].flatMap(([lon, lat]) => [lon, lat])
        ),
        width: style.boundaryWidth,
        material: boundaryColor,
        clampToGround: true,
      },
    });

    console.warn('[loadParcel] ⚠️ Loaded parcel without terrain heights (fallback)');
  }

  // ── Calculate parcel radius for High-DPI PNOA optimization ──
  const cartesianPositions = coordinates.map(([lon, lat]) =>
    Cesium.Cartesian3.fromDegrees(lon, lat)
  );
  const boundingSphere = Cesium.BoundingSphere.fromPoints(cartesianPositions);
  const radius = boundingSphere.radius;

  // ── HIGH-RES ORTHO OVERLAY FROM ENGINE CACHE (HYBRID SSD) ──
  // Load the pre-downloaded ortho PNG instead of WMS. Check status first to avoid 404.
  if (radius < 100 && viewer.imageryLayers) {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    const twinId = snapshot.twinId;
    
    try {
      const statusRes = await fetch(`${apiBase}/api/tiles/${encodeURIComponent(twinId)}/status`);
      const statusData = statusRes.ok ? await statusRes.json() : { available: false };
      
      if (statusData.available) {
        const metaRes = await fetch(`${apiBase}/api/tiles/${encodeURIComponent(twinId)}/pipeline_result.json`);
        if (metaRes.ok) {
          const meta = await metaRes.json();
          if (meta.ortho?.bbox && meta.ortho?.texture) {
            const orthoUrl = `${apiBase}/api/tiles/${encodeURIComponent(twinId)}/${meta.ortho.texture}`;
            const ob = meta.ortho.bbox;
            
            const orthoProvider = await Cesium.SingleTileImageryProvider.fromUrl(orthoUrl, {
              rectangle: Cesium.Rectangle.fromDegrees(ob[0], ob[1], ob[2], ob[3]),
            });
            
            const orthoLayer = viewer.imageryLayers.addImageryProvider(orthoProvider);
            viewer.imageryLayers.raiseToTop(orthoLayer);
            orthoLayer.brightness = 1.0;
            orthoLayer.contrast = 1.0;
            orthoLayer.gamma = 1.0;
            orthoLayer.saturation = 1.0;
            orthoLayer.alpha = 1.0;
            
            console.log(`[StudioViewer] ✓ Ortho overlay loaded (${meta.ortho.width}×${meta.ortho.height}px)`);
          }
        }
      } else {
        console.log('[StudioViewer] Tiles not yet generated — base WMTS active');
      }
    } catch (orthoError) {
      // Silent — base WMTS remains active
    }
    
    // ── DYNAMIC FRUSTUM & SHADOW MAP ADJUSTMENT ──
    // Adjust camera frustum for better depth precision on small parcels
    try {
      const camera = viewer.camera;
      const scene = viewer.scene;
      
      if (radius < 20) {
        // Ultra-small: tight frustum to maximize depth precision
        camera.frustum.near = Math.max(0.5, radius * 0.1);
        camera.frustum.far = Math.max(500, radius * 50);
        console.log(`[StudioViewer] Frustum adjusted: near=${camera.frustum.near.toFixed(1)}m, far=${camera.frustum.far.toFixed(0)}m (prevents z-fighting)`);
      } else if (radius < 100) {
        camera.frustum.near = Math.max(1, radius * 0.05);
        camera.frustum.far = Math.max(1000, radius * 100);
      }
      
      // Shadow map optimization if enabled
      if (scene.shadowMap?.enabled) {
        const shadowMapSize = radius < 20 ? 4096 : (radius < 100 ? 2048 : 1024);
        scene.shadowMap.size = shadowMapSize;
        scene.shadowMap.softShadows = true;
        console.log(`[StudioViewer] Shadow map: ${shadowMapSize}×${shadowMapSize}`);
      }
    } catch (frustumError) {
      console.warn('[StudioViewer] Frustum adjustment failed (non-critical):', frustumError);
    }
  }

  // Helper function
  function hexToColor(hex: string, alpha: number = 1.0) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return Cesium.Color.CYAN.withAlpha(alpha);
    return Cesium.Color.fromBytes(
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16),
      Math.round(alpha * 255)
    );
  }
}

/**
 * Loads a 3D Tileset (terrain mesh) from the API if available for this twin.
 * Returns the Cesium3DTileset primitive, or null if not available.
 */
async function loadTerrainTileset(
  viewer: any,
  twinId: string,
): Promise<any | null> {
  const Cesium = window.Cesium;
  if (!Cesium || !viewer || viewer.isDestroyed?.()) return null;

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
  const statusUrl = `${apiBase}/api/tiles/${encodeURIComponent(twinId)}/status`;

  try {
    const res = await fetch(statusUrl);
    if (!res.ok) return null;
    const status = await res.json();
    if (!status.available) {
      // Terrain tileset not available, silently skip
      return null;
    }

    const tilesetUrl = `${apiBase}/api/tiles/${encodeURIComponent(twinId)}/tileset.json`;
    console.log('[StudioViewer] Loading terrain tileset:', tilesetUrl);

    const tileset = await Cesium.Cesium3DTileset.fromUrl(tilesetUrl, {
      maximumScreenSpaceError: 2,
      maximumMemoryUsage: 512,
      dynamicScreenSpaceError: true,
      dynamicScreenSpaceErrorDensity: 0.00278,
      dynamicScreenSpaceErrorFactor: 4.0,
      dynamicScreenSpaceErrorHeightFalloff: 0.25,
      skipLevelOfDetail: true,
      baseScreenSpaceError: 1024,
      skipScreenSpaceErrorFactor: 16,
      skipLevels: 1,
      preferLeaves: true,
    });

    if (viewer.isDestroyed?.()) return null;
    viewer.scene.primitives.add(tileset);

    // Handle shader errors gracefully (v_texCoord_0 crash with malformed UVs)
    tileset.tileFailed.addEventListener((ev: any) => {
      console.warn('[StudioViewer] 3D Tile render failed:', ev.message);
    });

    console.log('[StudioViewer] ✅ Terrain 3D Tileset loaded:', status.files?.length, 'files');
    return tileset;
  } catch (err) {
    console.warn('[StudioViewer] Terrain tileset load failed (non-critical):', err);
    return null;
  }
}

/**
 * Loads real NDVI colormap overlay from the tiles API if available.
 * Uses SingleTileImageryProvider to display the PNG over the parcel bbox.
 */
async function loadNDVIOverlay(
  viewer: any,
  twinId: string,
  snapshot: any,
): Promise<any | null> {
  const Cesium = window.Cesium;
  if (!Cesium || !viewer || viewer.isDestroyed?.()) return null;

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

  try {
    // Check if NDVI colormap exists
    const statusUrl = `${apiBase}/api/tiles/${encodeURIComponent(twinId)}/status`;
    const res = await fetch(statusUrl);
    if (!res.ok) return null;
    const status = await res.json();

    if (!status.available || !status.files?.includes('ndvi_colormap.png')) {
      // NDVI not available, silently skip
      return null;
    }

    // Get bbox from snapshot parcel geometry
    const coords = snapshot?.parcel?.geojson?.features?.[0]?.geometry?.coordinates?.[0]
      || snapshot?.parcel?.geojson?.geometry?.coordinates?.[0];
    if (!coords) return null;

    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const c of coords) {
      if (c[0] < minLon) minLon = c[0];
      if (c[0] > maxLon) maxLon = c[0];
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
    }

    const colormapUrl = `${apiBase}/api/tiles/${encodeURIComponent(twinId)}/ndvi_colormap.png`;
    console.log('[StudioViewer] Loading NDVI overlay:', colormapUrl);

    const provider = await Cesium.SingleTileImageryProvider.fromUrl(colormapUrl, {
      rectangle: Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat),
    });

    if (viewer.isDestroyed?.()) return null;
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = 0.55;
    layer.brightness = 1.0;
    layer.contrast = 1.1;
    layer.show = false; // Start hidden, toggled via 'ndvi' layer toggle
    viewer.imageryLayers.raiseToTop(layer);

    // Store reference for layer toggling
    (viewer as any)._ndviOverlayLayer = layer;
    console.log('[StudioViewer] ✅ NDVI real overlay loaded (hidden by default, toggle with ndvi layer)');
    return layer;
  } catch (err) {
    console.warn('[StudioViewer] NDVI overlay load failed (non-critical):', err);
    return null;
  }
}

/**
 * Loads Sentinel-2 RGB (true color) overlay from the tiles API.
 * Fetches metadata first (triggers download on engine if needed),
 * then loads the PNG as a SingleTileImageryProvider.
 */
async function loadSentinelRGBOverlay(
  viewer: any,
  twinId: string,
  snapshot: any,
): Promise<any | null> {
  const Cesium = window.Cesium;
  if (!Cesium || !viewer || viewer.isDestroyed?.()) return null;

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

  try {
    // Request metadata (this may trigger a download on the engine)
    const metaUrl = `${apiBase}/api/tiles/${encodeURIComponent(twinId)}/sentinel-latest`;
    const res = await fetch(metaUrl);
    if (!res.ok) return null;
    const meta = await res.json() as {
      available?: boolean;
      bounds?: number[];
      date?: string;
      cloud_cover?: number;
    };

    if (!meta.available || !meta.bounds) {
      console.log('[StudioViewer] No Sentinel-2 RGB available for', twinId);
      return null;
    }

    const [minLon, minLat, maxLon, maxLat] = meta.bounds;
    const rgbUrl = `${apiBase}/api/tiles/${encodeURIComponent(twinId)}/sentinel_rgb.png`;
    console.log('[StudioViewer] Loading Sentinel-2 RGB overlay:', rgbUrl, 'date:', meta.date);

    const provider = await Cesium.SingleTileImageryProvider.fromUrl(rgbUrl, {
      rectangle: Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat),
    });

    if (viewer.isDestroyed?.()) return null;
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = 0.75;
    layer.brightness = 1.0;
    layer.contrast = 1.05;
    layer.show = false; // Hidden by default, toggled via 'sentinel-rgb' layer
    viewer.imageryLayers.raiseToTop(layer);

    (viewer as any)._sentinelRGBLayer = layer;
    (viewer as any)._sentinelRGBMeta = meta;
    console.log(
      '[StudioViewer] ✅ Sentinel-2 RGB overlay loaded (date: %s, clouds: %s%%)',
      meta.date, meta.cloud_cover,
    );
    return layer;
  } catch (err) {
    console.warn('[StudioViewer] Sentinel-2 RGB overlay load failed (non-critical):', err);
    return null;
  }
}

/**
 * Espera que el globe tenga tiles cargados (evento real de Cesium)
 * SIN timeout artificial - usa el evento real de Cesium
 */
async function waitForTerrainReady(viewer: any): Promise<void> {
  const Cesium = window.Cesium;
  return new Promise<void>((resolve) => {
    if (viewer.isDestroyed?.()) { resolve(); return; }
    // Si ya está listo, resolver inmediatamente
    if (viewer.scene.globe.tilesLoaded) {
      console.log('[StudioViewer] ✅ Terrain ya listo');
      resolve();
      return;
    }

    // Escuchar el evento tileLoadProgressEvent
    // Se dispara con el número de tiles pendientes
    // Cuando llega a 0, el terrain está completamente cargado
    const removeListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener(
      (tilesRemaining: number) => {
        console.log(`[StudioViewer] 🔄 Tiles pendientes: ${tilesRemaining}`);
        if (tilesRemaining === 0) {
          removeListener(); // limpiar el listener
          console.log('[StudioViewer] ✅ Terrain cargado completamente');
          resolve();
        }
      }
    );

    // Forzar que el viewer renderice para activar la carga
    viewer.scene.requestRender();
  });
}

/**
 * Vuela a la parcela con vista lateral para ver el relieve
 * Espera que los tiles se carguen (sin timeout fijo)
 */
async function flyToParcelWithTerrain(
  viewer: any,
  snapshot: any
): Promise<void> {
  const Cesium = window.Cesium;
  if (!viewer || viewer.isDestroyed?.()) return;
  
  const parcel = snapshot?.parcel ?? snapshot;
  const centroid = parcel?.centroid ?? [0, 0];
  const [lon, lat] = centroid;
  const areaHa = parcel?.area_ha ?? 100;
  
  // Radius-based camera distance — proportional to actual parcel size
  function computeIdealRange(ha: number): number {
    const radiusM = Math.sqrt(ha * 10000 / Math.PI);
    if (ha < 0.5) return Math.max(radiusM * 5, 80);
    if (ha < 10)  return Math.max(radiusM * 4, 300);
    if (ha < 100) return Math.max(radiusM * 3, 1000);
    return Math.max(radiusM * 2.5, 2000);
  }
  function computeIdealPitch(ha: number): number {
    if (ha < 0.5) return -40;  // More vertical for gardens
    if (ha < 10)  return -35;
    if (ha < 100) return -32;
    return -30;                 // Wider for large estates
  }
  const distanceM = computeIdealRange(areaHa);
  const pitchDeg = computeIdealPitch(areaHa);
  
  console.log(`[StudioViewer] 🎯 lookAt centroid [${lon.toFixed(4)}, ${lat.toFixed(4)}] dist=${distanceM.toFixed(0)}m`);
  
  // Punto exacto del centroide de la parcela
  const center = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  
  // lookAt GARANTIZA que la cámara siempre apunta al centroide exacto
  // heading 225° = mirando desde SW hacia NE (vista diagonal máxima)
  // pitch -45° = ángulo MUY oblicuo, relieve IMPOSIBLE de no ver
  viewer.camera.lookAt(
    center,
    new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(225),  // desde SW mirando NE (diagonal perfecta)
      Cesium.Math.toRadians(pitchDeg),  // adaptive: -40° gardens → -30° estates
      distanceM * 1.3,  // buffer for initial framing
    )
  );
  
  // Liberar el lookAt-lock para que el usuario pueda mover la cámara
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  
  console.log('[StudioViewer] ✅ Cámara centrada en parcela con relieve visible');
  
  // Esperar que los tiles de alta resolución carguen en esta posición
  await new Promise<void>((resolve) => {
    if (viewer.isDestroyed?.()) { resolve(); return; }
    let settled = false;
    
    const removeListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener(
      (tilesRemaining: number) => {
        if (tilesRemaining === 0 && !settled) {
          settled = true;
          removeListener();
          console.log('[StudioViewer] ✅ Tiles cargados en vista inicial');
          resolve();
        }
      }
    );
    
    // Fallback 8s para conexiones lentas
    setTimeout(() => {
      if (!settled) {
        settled = true;
        removeListener();
        console.log('[StudioViewer] ⏱ Timeout tiles — continuando');
        resolve();
      }
    }, 8000);
    
    if (!viewer.isDestroyed?.()) viewer.scene.requestRender();
  });
}

/**
 * Flies camera to saved position from snapshot, or defaults to isometric view
 * (LEGACY - mantener por compatibilidad, pero usar flyToParcelWithTerrain para nuevos casos)
 */
async function flyToSavedCamera(viewer: any, snapshot: TwinSnapshot): Promise<void> {
  const Cesium = window.Cesium;
  if (!Cesium || !snapshot.parcel?.geojson) {
    console.warn('[flyToCamera] No Cesium or GeoJSON available');
    return;
  }

  console.log('[flyToCamera] Positioning camera...', {
    hasCamera: !!snapshot.camera,
  });

  // Extract coordinates to compute centroid
  const geojson = snapshot.parcel.geojson;
  let coordinates: number[][] = [];

  if (geojson.type === 'FeatureCollection' && geojson.features?.[0]) {
    const geom = geojson.features[0].geometry;
    if (geom.type === 'Polygon' && geom.coordinates?.[0]) {
      coordinates = geom.coordinates[0];
    }
  } else if (geojson.type === 'Feature') {
    const geom = geojson.geometry;
    if (geom.type === 'Polygon' && geom.coordinates?.[0]) {
      coordinates = geom.coordinates[0];
    }
  }

  if (coordinates.length === 0) {
    console.error('[flyToCamera] No coordinates for centroid calculation');
    return;
  }

  // Compute centroid
  const centroidLon = coordinates.reduce((sum, [lon]) => sum + lon, 0) / coordinates.length;
  const centroidLat = coordinates.reduce((sum, [, lat]) => sum + lat, 0) / coordinates.length;

  console.log('[flyToCamera] Centroid:', { lon: centroidLon, lat: centroidLat });

  // Sample ground height at centroid
  let groundHeight = 0;
  try {
    const terrainProvider = viewer.terrainProvider;
    const positions = [Cesium.Cartographic.fromDegrees(centroidLon, centroidLat)];
    const sampledPositions = await Cesium.sampleTerrainMostDetailed(terrainProvider, positions);
    groundHeight = sampledPositions[0].height;
    console.log('[flyToCamera] ✓ Ground height sampled:', groundHeight, 'm');
  } catch (error) {
    console.warn('[flyToCamera] Failed to sample terrain, using 0m:', error);
  }

  // Use saved camera or default isometric view
  const camera = snapshot.camera || {};
  const areaHa = snapshot.parcel?.area_ha ?? 100;
  const heading = camera.headingDeg !== undefined ? camera.headingDeg : 315; // NW
  const savedPitch = camera.pitchDeg !== undefined ? camera.pitchDeg : -50;
  // Area-adaptive pitch: small parcels need steeper viewing angle
  const idealPitch = areaHa < 0.5 ? -40 : areaHa < 10 ? -35 : areaHa < 100 ? -32 : -30;
  const pitch = (savedPitch > idealPitch + 15) ? idealPitch : savedPitch;

  // Compute ideal range based on parcel area, then sanity-check saved value
  let idealRange: number;
  if (areaHa < 0.5)       idealRange = Math.max(Math.sqrt(areaHa * 10000) * 5, 80);
  else if (areaHa < 5)    idealRange = Math.max(Math.sqrt(areaHa * 10000) * 3, 300);
  else if (areaHa < 50)   idealRange = Math.max(Math.sqrt(areaHa * 10000) * 2, 1000);
  else                    idealRange = Math.max(Math.sqrt(areaHa * 10000) * 1.5, 2000);

  const savedRange = camera.range_m ?? 0;
  // If saved range is absurd (>3x ideal), use ideal instead
  const range = (savedRange > 0 && savedRange < idealRange * 3) ? savedRange : idealRange;

  const targetHeight = groundHeight + range;

  console.log('[flyToCamera] Flying to:', {
    lon: centroidLon,
    lat: centroidLat,
    height: targetHeight,
    heading,
    pitch,
    range,
  });

  // ⏳ Envolver flyTo en Promise para esperar completamente
  await new Promise<void>((resolveFly) => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(centroidLon, centroidLat, targetHeight),
      orientation: {
        heading: Cesium.Math.toRadians(heading),
        pitch: Cesium.Math.toRadians(pitch),
        roll: 0,
      },
      duration: 2.5,
      complete: async () => {
        console.log('[flyToCamera] ✓ Camera positioned');
        
        // ⏳ ESPERAR A QUE SE CARGUEN LOS TILES DE ALTA RESOLUCIÓN DE ESTA ÁREA
        console.log('[flyToCamera] ⏳ Waiting for high-res terrain tiles to load...');
        
        await new Promise<void>((resolve) => {
          let loadCount = 0;
          const tileWatcher = viewer.scene.globe.tileLoadProgressEvent.addEventListener(
            (remaining: number) => {
              if (remaining === 0) {
                loadCount++;
                console.log('[flyToCamera] 🗺️ Tiles loaded (batch ' + loadCount + ')');
                
                // Esperar al menos 2 oleadas de tiles (inicial + refinamiento)
                if (loadCount >= 2) {
                  setTimeout(() => {
                    tileWatcher();  // Cleanup listener
                    console.log('[flyToCamera] ✅ High-res terrain tiles ready');
                    
                    // Forzar re-renderizado final
                    viewer.scene.requestRender();
                    viewer.scene.requestRender();
                    viewer.scene.requestRender();
                    
                    resolve();
                  }, 500);  // 500ms extra de margen
                }
              }
            }
          );
          
          // Timeout de seguridad (15s)
          setTimeout(() => {
            tileWatcher();
            console.warn('[flyToCamera] ⚠️ Tile loading timeout');
            resolve();
          }, 15000);
        });
        
        resolveFly();  // Resolver la Promise externa
      },
    });
  });
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function StudioViewer({
  snapshot,
  visualStyle,
  layerState,
  activeMode,
  onViewerReady,
}: StudioViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [cesiumLoaded, setCesiumLoaded] = useState(false);
  const [viewerReady, setViewerReady] = useState(false);
  const [showControlsHint, setShowControlsHint] = useState(false);
  const [helicopterMode, setHelicopterMode] = useState(false);
  const [shaderCrash, setShaderCrash] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const helicopterIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Wait for Cesium to load
  useEffect(() => {
    const checkCesium = () => {
      if (window.Cesium) {
        console.log('[StudioViewer] Cesium loaded successfully');
        setCesiumLoaded(true);
        return true;
      }
      return false;
    };

    // Check immediately
    if (checkCesium()) return;

    // Poll every 100ms until Cesium is available
    const interval = setInterval(() => {
      if (checkCesium()) {
        clearInterval(interval);
      }
    }, 100);

    // Timeout after 20 seconds
    const timeout = setTimeout(() => {
      clearInterval(interval);
      console.error('[StudioViewer] Cesium failed to load after 20s');
      console.error('[StudioViewer] Check network connection and script tag in _app.tsx');
    }, 20000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);

  // Initialize Cesium viewer once Cesium is loaded
  useEffect(() => {
    if (!cesiumLoaded || !containerRef.current || viewerRef.current) return;

    const Cesium = window.Cesium;
    if (!Cesium) {
      console.error('[StudioViewer] Cesium not available');
      return;
    }

    console.log('[StudioViewer] Initializing viewer...');

    // ✅ Configure Cesium Ion token from .env.local (SAME AS ENGINE)
    const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
    if (!ionToken) {
      console.error('[StudioViewer] ❌ NEXT_PUBLIC_CESIUM_ION_TOKEN not found in .env.local');
    } else {
      Cesium.Ion.defaultAccessToken = ionToken;
      console.log('[StudioViewer] ✅ Cesium Ion token configured from .env');
    }

    let viewer: any;

    async function initViewer() {
      try {
        // Base imagery: Bing Aerial via Cesium Ion (siempre funciona, sin CORS)
        // ❌❌❌ CRÍTICO para captura PNG de alta resolución ❌❌❌
        viewer = new Cesium.Viewer(containerRef.current!, {
          imageryProvider: new Cesium.IonImageryProvider({ assetId: 2 }),
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          shadows: false,
          terrainShadows: Cesium.ShadowMode.DISABLED,
          showRenderLoopErrors: false, // Suppress native Cesium error dialog
          contextOptions: {
            webgl: {
              preserveDrawingBuffer: true,  // Permite canvas.toBlob() para captura 4K
              alpha: false,
              depth: true,
              stencil: false,
              antialias: true,
              powerPreference: 'high-performance',
              failIfMajorPerformanceCaveat: false, // Allow software/degraded GPU renderers
            }
          },
          // Calidad visual máxima
          msaaSamples: 4,
          useBrowserRecommendedResolution: false,
        });

        console.log('[StudioViewer] ✓ Viewer created with OSM base imagery');

        // ── CRITICAL: Catch render errors (shader crashes) to prevent rendering halt ──
        // The v_texCoord_0 shader crash occurs when a B3DM tile has a texture
        // without a valid sampler. Instead of halting all rendering, log the
        // error and remove the offending tileset so the viewer stays usable.
        viewer.scene.renderError.addEventListener((scene: any, error: any) => {
          const msg = String(error?.message ?? error ?? '');
          console.error('[StudioViewer] 🔴 Render error intercepted:', msg);
          if (msg.includes('v_texCoord_0') || msg.includes('Fragment shader failed')) {
            console.warn('[StudioViewer] ⚠️ Shader crash detected — removing 3D Tileset to restore rendering');
            setShaderCrash(true);
            // Remove all 3D Tilesets from primitives (they caused the crash)
            const prims = scene.primitives;
            const toRemove: any[] = [];
            for (let i = 0; i < prims.length; i++) {
              const p = prims.get(i);
              if (p?.constructor?.name === 'Cesium3DTileset' || p?._url) {
                toRemove.push(p);
              }
            }
            toRemove.forEach((p) => {
              try { prims.remove(p); } catch (_) { /* ignore */ }
            });
            console.log('[StudioViewer] Removed', toRemove.length, 'tilesets. Viewer should recover.');
          }
        });

        // ── PNOA Orthophoto via proxy (IGN no tiene CORS) ──
        try {
          const pnoaProv = new Cesium.UrlTemplateImageryProvider({
            url: '/api/pnoa-tile/{z}/{x}/{y}',
            minimumLevel: 5,
            maximumLevel: 20,
            credit: 'PNOA © IGN España',
          });
          
          const pnoaLayer = viewer.imageryLayers.addImageryProvider(pnoaProv);
          viewer.imageryLayers.raiseToTop(pnoaLayer);
          
          // CRITICAL: Neutral settings for maximum sharpness (polygons are transparent decals)
          pnoaLayer.brightness = 1.0;
          pnoaLayer.contrast = 1.0;
          pnoaLayer.gamma = 1.0;
          pnoaLayer.saturation = 1.0;
          pnoaLayer.alpha = 1.0;

          // Suppress tile errors completely (proxy returns transparent 256x256 on fail)
          pnoaProv.errorEvent.addEventListener(() => {});
          
          console.log('[StudioViewer] ✓ PNOA imagery loaded (proxy, neutral settings)');
        } catch (pnoaError) {
          console.warn('[StudioViewer] PNOA imagery failed:', pnoaError);
        }

        // ── Enhanced Free Flight Camera Controls (Helicopter Mode) ──────────────
        const ctrl = viewer.scene.screenSpaceCameraController;
        ctrl.enableRotate = true;   // Left drag: rotate/orbit
        ctrl.enableZoom = true;     // Wheel: zoom in/out
        ctrl.enableTilt = true;     // Right drag: tilt camera
        ctrl.enableLook = true;     // Ctrl+drag: look around
        ctrl.enableTranslate = true; // Middle drag: pan
        ctrl.minimumZoomDistance = 20;     // Minimum 20m above ground (small parcels)
        ctrl.maximumZoomDistance = 80000;  // Maximum 80km (overview)
        ctrl.zoomFactor = 3.0;             // Smoother zoom speed
        
        ctrl.rotateEventTypes = [
          Cesium.CameraEventType.LEFT_DRAG,  // Left click = rotate/orbit
        ];
        ctrl.tiltEventTypes = [
          Cesium.CameraEventType.RIGHT_DRAG, // Right click = tilt
          Cesium.CameraEventType.PINCH,      // Touch pinch = tilt
        ];
        ctrl.lookEventTypes = [
          Cesium.CameraEventType.MIDDLE_DRAG, // Middle button = look around
        ];
        ctrl.zoomEventTypes = [
          Cesium.CameraEventType.WHEEL,
          Cesium.CameraEventType.PINCH,
        ];
        
        // Allow near-horizontal tilt (helicopter perspective)
        ctrl.minimumCollisionTerrainHeight = 100; // Don't clip through terrain
        
        console.log('[StudioViewer] ✓ Free flight controls enabled (helicopter mode)');

        // ── Load Terrain with World Terrain base + MDT02 upgrade ──────────────────────
        
        // PASO 1: Iniciar viewer inmediatamente con World Terrain (nunca queda en blanco)
        const worldTerrain = await Cesium.createWorldTerrainAsync({
          requestVertexNormals: true,
          requestWaterMask: false,
        });
        if (!viewer || viewer.isDestroyed()) return;
        viewer.terrainProvider = worldTerrain;
        console.log('[StudioViewer] ✅ World Terrain cargado (base)');

        // PASO 2: MDT02 España - intentar cargar en background
        // Si falla, ya tenemos World Terrain como fallback
        const mdt02Id = parseInt(process.env.NEXT_PUBLIC_MDT02_ASSET_ID ?? '0');
        if (mdt02Id > 0) {
          // NO hacer await aquí — cargar en background sin bloquear
          Cesium.CesiumTerrainProvider.fromIonAssetId(mdt02Id, {
            requestVertexNormals: true,
          }).then((mdt02Provider: any) => {
            if (!viewer || viewer.isDestroyed()) return;
            viewer.terrainProvider = mdt02Provider;
            // CRÍTICO: NO sobreescribir verticalExaggeration — respetar el valor actual del viewer
            // (puede haber sido ajustado por el slider o por el init a 4.0x)
            // viewer.scene.verticalExaggeration ya tiene el valor correcto — no tocarlo
            console.log(`[StudioViewer] ✅ MDT02 España (${mdt02Id}) activado. Exaggeration preserved: ${viewer.scene.verticalExaggeration}x`);
          }).catch((err: any) => {
            console.warn(`[StudioViewer] ⚠️ MDT02 no disponible (${err.message}), usando World Terrain`);
            // World Terrain ya está activo — no hacer nada
          });
        }

        // ── TERRAIN VISUALIZATION ENHANCEMENTS ──────────────────
        // Enable lighting for terrain shadows
        viewer.scene.globe.enableLighting = true;
        // IMPORTANT: depthTestAgainstTerrain=false required when using verticalExaggeration > 1.0
        // With exaggeration, clampToGround polylines render at non-exaggerated height and get
        // depth-tested against the exaggerated terrain, making them invisible underground.
        viewer.scene.globe.depthTestAgainstTerrain = false;
        
        // Terrain detail (LOWEST = max detail)  
        viewer.scene.globe.maximumScreenSpaceError = 0.8;  // ⬇️ REDUCED from 1.5 for better detail
        viewer.scene.globe.tileCacheSize = 300; // More tiles cached (was 200)
        viewer.scene.globe.preloadAncestors = true;  // Load parent tiles first
        viewer.scene.globe.preloadSiblings = true;   // Load adjacent tiles
        
        // Shadows disabled for GPU compatibility (complex shaders crash on many drivers)
        viewer.shadows = false;
        viewer.terrainShadows = Cesium.ShadowMode.DISABLED;

        // Set sun time (7:30am = VERY long shadows for maximum relief visibility)
        viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(
          visualStyle.timeOfDay || '2026-06-15T07:30:00Z'
        );
        viewer.clock.shouldAnimate = false;

        // ── TERRAIN EXAGGERATION ─────────────────────────
        // Default 1.0x para representación realista del terreno
        const initialExaggeration = visualStyle.terrainExaggeration || 1.0;
        viewer.scene.verticalExaggeration = initialExaggeration;
        console.log('[StudioViewer] 🏔️ Terrain exaggeration:', initialExaggeration + 'x');
        console.log('[StudioViewer] 📊 visualStyle.terrainExaggeration:', visualStyle.terrainExaggeration);
        console.log('[StudioViewer] 🌍 Globe settings:', {
          enableLighting: viewer.scene.globe.enableLighting,
          depthTest: viewer.scene.globe.depthTestAgainstTerrain,
          maxScreenSpaceError: viewer.scene.globe.maximumScreenSpaceError,
          shadows: viewer.shadows,
          terrainShadows: viewer.terrainShadows,
        });

        // Atmosphere and fog
        viewer.scene.skyAtmosphere.show = true;
        viewer.scene.fog.enabled = true;
        viewer.scene.fog.density = 0.0002;
        viewer.scene.fog.minimumBrightness = 0.0;

        // ── AUTO-DISABLE atmosphere & fog at close range ──────────────
        // When the camera drops below 500 m above ground, the sky tint
        // causes a blue cast over the 3D terrain model. Disable it, and
        // also make the globe baseColor transparent so the orthophoto
        // shows through without the default blue sphere color.
        let _atmoWasDisabled = false;
        viewer.scene.preRender.addEventListener(() => {
          if (viewer.isDestroyed?.()) return;
          const carto = viewer.camera.positionCartographic;
          if (!carto) return;
          const h = carto.height;
          if (h < 500 && !_atmoWasDisabled) {
            viewer.scene.skyAtmosphere.show = false;
            viewer.scene.skyBox.show = false;
            viewer.scene.fog.enabled = false;
            viewer.scene.backgroundColor = Cesium.Color.BLACK;
            _atmoWasDisabled = true;
          } else if (h >= 500 && _atmoWasDisabled) {
            viewer.scene.skyAtmosphere.show = true;
            viewer.scene.skyBox.show = true;
            viewer.scene.fog.enabled = true;
            viewer.scene.backgroundColor = Cesium.Color.BLACK;
            _atmoWasDisabled = false;
          }
        });

        console.log('[StudioViewer] ✓ Terrain lighting configured (atmosphere auto-toggle at 500m)');

        // Native DPI: render at full device pixel ratio for HiDPI screens
        viewer.resolutionScale = window.devicePixelRatio || 1.0;

        viewerRef.current = viewer;
        (window as any).viewer = viewer;
        onViewerReady(viewer);
        console.log('[StudioViewer] ✓ Viewer initialized');

        // Load parcel and fly to camera
        await loadParcelFromSnapshot(viewer, snapshot, visualStyle);
        if (viewer.isDestroyed()) return;
        await flyToParcelWithTerrain(viewer, snapshot);
        if (viewer.isDestroyed()) return;

        setViewerReady(true);

        // Load terrain 3D Tileset if available (non-blocking)
        loadTerrainTileset(viewer, snapshot.twinId).catch(() => {});

        // Load NDVI real overlay if available (non-blocking)
        loadNDVIOverlay(viewer, snapshot.twinId, snapshot).catch(() => {});

        // Load Sentinel-2 RGB overlay if available (non-blocking)
        loadSentinelRGBOverlay(viewer, snapshot.twinId, snapshot).catch(() => {});

        // ── FINAL VERIFICATION ────────────────────────────────────────
        if (!viewer.isDestroyed()) {
          console.log('[StudioViewer] ═══════════════════════════════════════');
          console.log('[StudioViewer] FINAL TERRAIN STATUS:');
          console.log('[StudioViewer] Provider type:', viewer.terrainProvider?.constructor?.name || 'Unknown');
          console.log('[StudioViewer] Vertical exaggeration:', viewer.scene?.verticalExaggeration + 'x');
          console.log('[StudioViewer] Globe lighting:', viewer.scene?.globe?.enableLighting);
          console.log('[StudioViewer] Terrain shadows:', viewer.terrainShadows);
          console.log('[StudioViewer] ═══════════════════════════════════════');
        }
        
        // Show controls hint for 5 seconds
        setShowControlsHint(true);
        setTimeout(() => setShowControlsHint(false), 5000);

      } catch (error) {
        console.error('[StudioViewer] Failed to initialize viewer:', error);
      }
    }

    initViewer();

    return () => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
      }
    };
  }, [cesiumLoaded, snapshot.twinId]);

  // Reactive visual style updates (terrain, lighting, colors, time)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const Cesium = window.Cesium;

    console.log('[StudioViewer] Updating visual style...', {
      preset: visualStyle.preset,
      terrainEx: visualStyle.terrainExaggeration,
      lighting: visualStyle.enableLighting,
    });

    // Update terrain exaggeration — usar el valor del slider directamente
    const exaggeration = visualStyle.terrainExaggeration || 1.0;
    viewer.scene.verticalExaggeration = exaggeration;
    console.log('[StudioViewer] Exaggeration updated to:', exaggeration + 'x');

    // Update lighting
    viewer.scene.globe.enableLighting = visualStyle.enableLighting;
    if (visualStyle.enableLighting) {
      viewer.scene.globe.enableLighting = true;
    } else {
      viewer.scene.globe.enableLighting = false;
    }

    // Update atmosphere density
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = visualStyle.atmosphereDensity || 0.0002;

    // Update sun time
    try {
      const timeDate = new Date(visualStyle.timeOfDay);
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(timeDate);
    } catch (error) {
      console.warn('[StudioViewer] Invalid timeOfDay:', visualStyle.timeOfDay);
    }

    // Update parcel fill and boundary colors
    const fillEntity = viewer.entities.getById('parcel-fill');
    const boundaryEntity = viewer.entities.getById('parcel-boundary-line');

    if (fillEntity && fillEntity.polygon) {
      const hexToColor = (hex: string, alpha: number = 1.0) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!result) return Cesium.Color.CYAN.withAlpha(alpha);
        return Cesium.Color.fromBytes(
          parseInt(result[1], 16),
          parseInt(result[2], 16),
          parseInt(result[3], 16),
          Math.round(alpha * 255)
        );
      };

      fillEntity.polygon.material = hexToColor(visualStyle.fillColor, visualStyle.fillOpacity);
    }

    if (boundaryEntity && boundaryEntity.polyline) {
      const hexToColor = (hex: string, alpha: number = 1.0) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!result) return Cesium.Color.GOLD;
        return Cesium.Color.fromBytes(
          parseInt(result[1], 16),
          parseInt(result[2], 16),
          parseInt(result[3], 16),
          Math.round(alpha * 255)
        );
      };

      boundaryEntity.polyline.material = hexToColor(visualStyle.boundaryColor, 1.0);
      boundaryEntity.polyline.width = visualStyle.boundaryWidth;
    }

    console.log('[StudioViewer] ✓ Visual style updated');
  }, [visualStyle]);

  // Reactive layer state updates (show/hide entities)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    console.log('[StudioViewer] Updating layer visibility...', layerState);

    // Update entity visibility based on layerState
    Object.entries(layerState).forEach(([layerId, visible]) => {
      // Special case: NDVI is an imagery layer, not an entity
      if (layerId === 'ndvi') {
        const ndviLayer = (viewer as any)._ndviOverlayLayer;
        if (ndviLayer) {
          ndviLayer.show = visible;
          if (visible) {
            viewer.imageryLayers.raiseToTop(ndviLayer);
            ndviLayer.alpha = 0.75;
          }
          console.log(`[StudioViewer] ndvi overlay: ${visible ? 'visible' : 'hidden'}`);
        } else if (visible) {
          // Try to load NDVI on-demand when toggled on but not yet loaded
          console.log('[StudioViewer] NDVI layer not loaded yet, attempting on-demand load...');
          loadNDVIOverlay(viewer, snapshot.twinId, snapshot).then(layer => {
            if (layer) {
              layer.show = true;
              viewer.imageryLayers.raiseToTop(layer);
              layer.alpha = 0.75;
            }
          }).catch(() => {});
        }
        return;
      }

      // Special case: Sentinel-2 RGB is an imagery layer
      if (layerId === 'sentinel-rgb') {
        const rgbLayer = (viewer as any)._sentinelRGBLayer;
        if (rgbLayer) {
          rgbLayer.show = visible;
          if (visible) {
            // Raise to top so it's fully above PNOA/Bing
            viewer.imageryLayers.raiseToTop(rgbLayer);
            rgbLayer.alpha = 1.0;
          }
          console.log(`[StudioViewer] sentinel-rgb overlay: ${visible ? 'visible' : 'hidden'}`);
        }
        // When Sentinel-2 is active, hide cadastral fill AND reduce PNOA opacity
        const fillEntity = viewer.entities.getById('parcel-fill');
        if (fillEntity) {
          fillEntity.show = !visible;
        }
        return;
      }

      const entity = viewer.entities.getById(layerId);
      if (entity) {
        entity.show = visible;
        console.log(`[StudioViewer] ${layerId}: ${visible ? 'visible' : 'hidden'}`);
      }
    });

    console.log('[StudioViewer] ✓ Layer visibility updated');
  }, [layerState]);

  // ============================================================================
  // DRONE WAYPOINT VISUALIZATION
  // ============================================================================
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const Cesium = window.Cesium;
    if (!Cesium) return;

    const DRONE_ENTITY_PREFIX = 'drone-waypoint-';
    const DRONE_ROUTE_ID = 'drone-flight-route';

    const clearWaypoints = () => {
      // Remove all drone entities
      const toRemove: string[] = [];
      viewer.entities.values.forEach((e: { id: string }) => {
        if (e.id?.startsWith(DRONE_ENTITY_PREFIX) || e.id === DRONE_ROUTE_ID) {
          toRemove.push(e.id);
        }
      });
      toRemove.forEach((id) => viewer.entities.removeById(id));
    };

    const drawWaypoints = (waypoints: number[][]) => {
      clearWaypoints();
      if (!waypoints || waypoints.length === 0) return;

      // Flight route polyline (clamped to ground + altitude)
      const positions = waypoints.map((wp: number[]) =>
        Cesium.Cartesian3.fromDegrees(wp[0], wp[1], wp[2] || 60),
      );

      viewer.entities.add({
        id: DRONE_ROUTE_ID,
        polyline: {
          positions,
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#3B82F6').withAlpha(0.8),
            dashLength: 12,
          }),
        },
      });

      // Waypoint markers
      waypoints.forEach((wp: number[], i: number) => {
        const isFirst = i === 0;
        const isLast = i === waypoints.length - 1;
        viewer.entities.add({
          id: `${DRONE_ENTITY_PREFIX}${i}`,
          position: Cesium.Cartesian3.fromDegrees(wp[0], wp[1], wp[2] || 60),
          point: {
            pixelSize: isFirst || isLast ? 8 : 4,
            color: isFirst
              ? Cesium.Color.LIME
              : isLast
              ? Cesium.Color.RED
              : Cesium.Color.fromCssColorString('#3B82F6'),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: isFirst || isLast ? 2 : 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label:
            isFirst || isLast
              ? {
                  text: isFirst ? 'INICIO' : 'FIN',
                  font: '10px JetBrains Mono, monospace',
                  fillColor: Cesium.Color.WHITE,
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 2,
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  pixelOffset: new Cesium.Cartesian2(0, -14),
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                }
              : undefined,
        });
      });

      console.log(`[StudioViewer] Drew ${waypoints.length} drone waypoints`);
    };

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.waypoints) {
        drawWaypoints(detail.waypoints);
      } else {
        clearWaypoints();
      }
    };

    window.addEventListener('geotwin:drone-waypoints', handler);

    // Clean up waypoints when leaving drone mode
    if (activeMode !== 'dron') {
      clearWaypoints();
    }

    return () => {
      window.removeEventListener('geotwin:drone-waypoints', handler);
    };
  }, [activeMode]);

  // ============================================================================
  // HELICOPTER MODE & CAMERA VIEW PRESETS
  // ============================================================================

  const startHelicopterMode = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const Cesium = window.Cesium;
    setHelicopterMode(true);

    const [centroidLon, centroidLat] = snapshot.parcel.centroid;
    const areaHa = snapshot.parcel.area_ha ?? 100;

    // Distance from center — scales with parcel area, same formula as other views
    const distanceM = Math.max(700, Math.min(3000, Math.sqrt(areaHa) * 100));
    const SPEED = 0.4; // Degrees per tick (20fps → ~8°/s → ~45s per full orbit)

    // lookAt pivot: the parcel centroid on the ground
    // We'll orbit around it using HeadingPitchRange so the camera is always
    // at the correct elevation regardless of terrain height (no absolute altitude needed).
    const center = Cesium.Cartesian3.fromDegrees(centroidLon, centroidLat, 0);

    let angle = 225; // Start viewing from SW (same as initial view)

    // Placeholder: truthy non-null value signals "mode started, not stopped"
    helicopterIntervalRef.current = -1 as any;

    // Approach flight — use flyTo with complete callback (not setTimeout)
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(centroidLon, centroidLat, distanceM),
      orientation: {
        heading: Cesium.Math.toRadians(225),
        pitch:   Cesium.Math.toRadians(-30),
        roll:    0,
      },
      duration: 2.5,
      complete: () => {
        if (!helicopterIntervalRef.current) return; // stopped during approach

        // Orbit loop: lookAt + HeadingPitchRange = always correct elevation
        helicopterIntervalRef.current = setInterval(() => {
          if (!viewer || viewer.isDestroyed()) { stopHelicopterMode(); return; }

          angle += SPEED;
          if (angle >= 360) angle -= 360;

          viewer.camera.lookAt(
            center,
            new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(angle),
              Cesium.Math.toRadians(-30),  // 30° down — good terrain visibility
              distanceM,
            )
          );
        }, 50); // 20fps
      },
    });

    console.log('[StudioViewer] 🚁 Helicopter started — range:', distanceM.toFixed(0) + 'm');
  };

  const stopHelicopterMode = () => {
    if (helicopterIntervalRef.current) {
      clearInterval(helicopterIntervalRef.current);
      helicopterIntervalRef.current = null;
    }
    setHelicopterMode(false);
    // Release the lookAt constraint so the user can control the camera again
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) {
      const Cesium = window.Cesium;
      if (Cesium) viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
    console.log('[StudioViewer] 🚁 Helicopter mode stopped');
  };

  const flyToLateralView = () => {
    stopHelicopterMode();
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !snapshot) return;
    
    const Cesium = window.Cesium;
    const [lon, lat] = snapshot.parcel.centroid;
    const areaHa = snapshot.parcel.area_ha ?? 100;
    const distanceM = Math.max(1500, Math.min(5000, Math.sqrt(areaHa) * 160));
    
    // lookAt garantiza centrado exacto en la parcela
    const center = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    viewer.camera.lookAt(
      center,
      new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(225),  // desde SW mirando NE (diagonal)
        Cesium.Math.toRadians(-45),  // 45° oblicuo — relieve EXTREMO
        distanceM * 0.8,  // más cerca
      )
    );
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    
    console.log('[StudioViewer] 🏔️ Vista lateral con relieve — centrada en parcela');
  };

  const flyToIsometricView = () => {
    stopHelicopterMode();
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !snapshot) return;

    const Cesium = window.Cesium;
    if (!Cesium) return;

    const centroid = snapshot.parcel?.centroid;
    if (!centroid) return;
    const [lon, lat] = centroid;

    const areaHa = snapshot.parcel?.area_ha ?? 100;
    // Area-adaptive distance — small parcels need the camera close
    let distanceM: number;
    if (areaHa < 0.5)       distanceM = Math.max(Math.sqrt(areaHa * 10000) * 5, 80); // ~150m for 0.13ha
    else if (areaHa < 5)    distanceM = Math.max(Math.sqrt(areaHa * 10000) * 3, 300);
    else if (areaHa < 50)   distanceM = Math.max(Math.sqrt(areaHa * 10000) * 2, 1000);
    else                    distanceM = Math.max(Math.sqrt(areaHa * 10000) * 1.5, 2000);

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, distanceM * 1.2),
      orientation: {
        heading: 0,
        pitch:   Cesium.Math.toRadians(-90),
        roll:    0,
      },
      duration: 2,
    });

    console.log(`[StudioViewer] 🗺️ Vista cenital completa (${areaHa.toFixed(2)} ha → ${distanceM.toFixed(0)}m)`);
  };

  // Cleanup helicopter mode on unmount
  useEffect(() => {
    return () => {
      if (helicopterIntervalRef.current) {
        clearInterval(helicopterIntervalRef.current);
      }
    };
  }, []);

  // Show loading state while Cesium is loading
  if (!cesiumLoaded) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1a1a1a',
          color: '#fff',
          fontSize: '14px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '12px', fontSize: '18px' }}>⏳</div>
          <div>Cargando visor 3D...</div>
          <div style={{ marginTop: '8px', fontSize: '12px', opacity: 0.6 }}>
            Esperando Cesium
          </div>
        </div>
      </div>
    );
  }

  const handleRegenerate = async () => {
    const tid = snapshot?.twinId;
    if (!tid || regenerating) return;
    setRegenerating(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '';
      const res = await fetch(`${apiBase}/api/twin/regenerate/${tid}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Regenerate failed: ${res.status}`);
      const data = await res.json();
      const jobId = data.job_id;
      // Poll for completion
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const jr = await fetch(`${apiBase}/api/twin/job/${jobId}`);
        const j = await jr.json();
        if (j.status === 'completed') {
          setShaderCrash(false);
          setRegenerating(false);
          // Reload the page to pick up the new tiles
          window.location.reload();
          return;
        }
        if (j.status === 'failed') throw new Error(j.error || 'Regeneration failed');
      }
    } catch (err) {
      console.error('[StudioViewer] Regeneration error:', err);
    }
    setRegenerating(false);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      />

      {/* Loading overlay — shown until parcel + terrain are fully loaded */}
      {!viewerReady && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0a0a14',
            zIndex: 80,
            flexDirection: 'column',
            gap: 16,
            fontFamily: 'system-ui, sans-serif',
            color: '#9ca3af',
          }}
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#10B981"
            strokeWidth="2"
            strokeLinecap="round"
            style={{ animation: 'spin 1s linear infinite' }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span style={{ fontSize: 14 }}>Cargando gemelo digital...</span>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Shader crash banner */}
      {shaderCrash && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(220,50,50,0.95)', color: '#fff', padding: '10px 20px',
          borderRadius: 8, zIndex: 100, fontSize: 13, display: 'flex',
          alignItems: 'center', gap: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}>
          <span>⚠️ Mallado 3D con textura dañada (tiles obsoletos)</span>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            style={{
              background: '#fff', color: '#c00', border: 'none', borderRadius: 6,
              padding: '6px 14px', cursor: regenerating ? 'wait' : 'pointer',
              fontWeight: 600, fontSize: 12,
            }}
          >
            {regenerating ? 'Regenerando...' : 'Regenerar Mallado'}
          </button>
        </div>
      )}

      {/* Floating control buttons */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          right: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          zIndex: 50,
        }}
      >
        {/* ── Camera View Presets ────────────────────────────── */}
        
        {/* Isometric (top-down) view */}
        <button
          onClick={flyToIsometricView}
          title="Vista cenital (top-down)"
          style={{
            width: 40,
            height: 40,
            background: 'rgba(10,20,30,0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,215,50,0.3)',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,215,50,0.2)';
            e.currentTarget.style.borderColor = 'rgba(255,215,50,0.8)';
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(10,20,30,0.85)';
            e.currentTarget.style.borderColor = 'rgba(255,215,50,0.3)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          🗺️
        </button>

        {/* Lateral (45° oblique) view */}
        <button
          onClick={flyToLateralView}
          title="Vista lateral 45°"
          style={{
            width: 40,
            height: 40,
            background: 'rgba(10,20,30,0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,215,50,0.3)',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,215,50,0.2)';
            e.currentTarget.style.borderColor = 'rgba(255,215,50,0.8)';
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(10,20,30,0.85)';
            e.currentTarget.style.borderColor = 'rgba(255,215,50,0.3)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          🏔️
        </button>

        {/* Helicopter mode (orbit animation) */}
        <button
          onClick={helicopterMode ? stopHelicopterMode : startHelicopterMode}
          title={helicopterMode ? 'Detener vuelo helicóptero' : 'Vuelo helicóptero'}
          style={{
            width: 40,
            height: 40,
            background: helicopterMode ? 'rgba(255,215,50,0.3)' : 'rgba(10,20,30,0.85)',
            backdropFilter: 'blur(8px)',
            border: helicopterMode ? '1px solid rgba(255,215,50,0.9)' : '1px solid rgba(255,215,50,0.3)',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            if (!helicopterMode) {
              e.currentTarget.style.background = 'rgba(255,215,50,0.2)';
              e.currentTarget.style.borderColor = 'rgba(255,215,50,0.8)';
            }
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            if (!helicopterMode) {
              e.currentTarget.style.background = 'rgba(10,20,30,0.85)';
              e.currentTarget.style.borderColor = 'rgba(255,215,50,0.3)';
            }
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          🚁
        </button>

        {/* ── Divider ─────────────────────────────────────────── */}
        <div style={{ height: '1px', background: 'rgba(255,215,50,0.2)', margin: '4px 0' }} />

        {/* Zoom in */}
        <button
          onClick={() => viewerRef.current?.camera.zoomIn(500)}
          title="Acercar (+)"
          style={{
            width: 40,
            height: 40,
            background: 'rgba(247,246,243,0.95)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #ddd',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#2d2d2a',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            transition: 'all 0.14s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,1)';
            e.currentTarget.style.borderColor = '#1a5e35';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(247,246,243,0.95)';
            e.currentTarget.style.borderColor = '#ddd';
          }}
        >
          +
        </button>

        {/* Zoom out */}
        <button
          onClick={() => viewerRef.current?.camera.zoomOut(500)}
          title="Alejar (-)"
          style={{
            width: 40,
            height: 40,
            background: 'rgba(247,246,243,0.95)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #ddd',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#2d2d2a',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            transition: 'all 0.14s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,1)';
            e.currentTarget.style.borderColor = '#1a5e35';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(247,246,243,0.95)';
            e.currentTarget.style.borderColor = '#ddd';
          }}
        >
          −
        </button>
      </div>

      {/* ── Controls Hint Tooltip ───────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: 16,
          background: 'rgba(10,20,30,0.7)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 11,
          color: 'rgba(255,255,255,0.6)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          fontFamily: 'monospace',
        }}
      >
        <span>🖱 Izq: orbitar</span>
        <span>🖱 Der: inclinar</span>
        <span>⚙ Rueda: zoom</span>
      </div>
    </div>
  );
}