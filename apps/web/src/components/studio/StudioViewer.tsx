'use client';

import { useEffect, useRef, useState } from 'react';
import type { TwinSnapshot, VisualStyle } from '@/lib/twinStore';

type StudioMode = 'terrain' | 'iot' | 'cattle' | 'bim' | 'simulate';

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
  if (!Cesium || !snapshot.parcel?.geojson) {
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

    // 1. Create parcel fill (polygon clamped to terrain)
    viewer.entities.add({
      id: 'parcel-fill',
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(
          coordinates.flatMap(([lon, lat]) => [lon, lat])
        ),
        material: fillColor,
        classificationType: Cesium.ClassificationType.TERRAIN,
        outline: false,
      },
    });
    console.log('[loadParcel] ✓ Created parcel-fill');

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
        outline: true,
        outlineColor: Cesium.Color.SADDLEBROWN,
        outlineWidth: 1.0,
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
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
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
 * Espera que el globe tenga tiles cargados (evento real de Cesium)
 * SIN timeout artificial - usa el evento real de Cesium
 */
async function waitForTerrainReady(viewer: any): Promise<void> {
  const Cesium = window.Cesium;
  return new Promise<void>((resolve) => {
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
  
  const parcel = snapshot?.parcel ?? snapshot;
  const centroid = parcel?.centroid ?? [0, 0];
  const [lon, lat] = centroid;
  const areaHa = parcel?.area_ha ?? 100;
  
  // Distancia proporcional al área de la parcela
  // 134ha → ~1850m de distancia al punto central
  const distanceM = Math.max(1500, Math.min(5000, Math.sqrt(areaHa) * 160));
  
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
      Cesium.Math.toRadians(-35),  // 35° abajo — vista más aérea para ver la parcela completa
      distanceM * 1.3,  // más amplio para ver bien la parcela en el encuadre inicial
    )
  );
  
  // Liberar el lookAt-lock para que el usuario pueda mover la cámara
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  
  console.log('[StudioViewer] ✅ Cámara centrada en parcela con relieve visible');
  
  // Esperar que los tiles de alta resolución carguen en esta posición
  await new Promise<void>((resolve) => {
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
    
    viewer.scene.requestRender();
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
  const heading = camera.headingDeg !== undefined ? camera.headingDeg : 315; // NW
  const pitch = camera.pitchDeg !== undefined ? camera.pitchDeg : -50; // MÁS INCLINADO (era -38)
  const range = camera.range_m !== undefined ? camera.range_m : 1800; // MÁS CERCA (era 2200)

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
  const [showControlsHint, setShowControlsHint] = useState(false);
  const [helicopterMode, setHelicopterMode] = useState(false);
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
          // ❌❌❌ CRÍTICO para captura PNG de alta resolución ❌❌❌
          contextOptions: {
            webgl: {
              preserveDrawingBuffer: true,  // Permite canvas.toBlob() para captura 4K
              alpha: false,
              depth: true,
              stencil: false,
              antialias: true,
              powerPreference: 'high-performance',
            }
          },
          // Calidad visual máxima
          msaaSamples: 4,
          useBrowserRecommendedResolution: false,
        });

        console.log('[StudioViewer] ✓ Viewer created with OSM base imagery');
        
        // ── UPGRADE TO PNOA FOR SPAIN via PROXY (resuelve CORS) ──────────────────
        // El WMS del IGN bloquea requests directos desde browser (CORS).
        // Usamos /api/pnoa como proxy local que re-envía las peticiones al IGN.
        // El proxy está en: src/pages/api/pnoa.ts
        try {
          const pnoaWMS = new Cesium.WebMapServiceImageryProvider({
            url: '/api/pnoa',  // ← PROXY LOCAL, no el IGN directamente
            layers: 'OI.OrthoimageCoverage',
            parameters: {
              transparent: false,
              format: 'image/jpeg',  // jpeg más rápido que png para ortofoto
              VERSION: '1.3.0',
              CRS: 'CRS:84',
            },
            rectangle: Cesium.Rectangle.fromDegrees(-9.5, 35.5, 4.5, 44.0),
            maximumLevel: 19,
            credit: 'PNOA © IGN España',
          });
          
          viewer.imageryLayers.addImageryProvider(pnoaWMS);
          console.log('[StudioViewer] ✓ PNOA imagery via proxy /api/pnoa');
        } catch (pnoaError) {
          console.warn('[StudioViewer] PNOA proxy failed, using OSM:', pnoaError);
        }

        // ── Enhanced Free Flight Camera Controls (Helicopter Mode) ──────────────
        const ctrl = viewer.scene.screenSpaceCameraController;
        ctrl.enableRotate = true;   // Left drag: rotate/orbit
        ctrl.enableZoom = true;     // Wheel: zoom in/out
        ctrl.enableTilt = true;     // Right drag: tilt camera
        ctrl.enableLook = true;     // Ctrl+drag: look around
        ctrl.enableTranslate = true; // Middle drag: pan
        ctrl.minimumZoomDistance = 50;     // Minimum 50m above ground
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
        viewer.scene.globe.depthTestAgainstTerrain = true;
        
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

        // ── TERRAIN EXAGGERATION (crucial for visibility) ──────────
        // Usar valor del preset o 2.5x por defecto (NO forzar mínimo)
        const initialExaggeration = visualStyle.terrainExaggeration || 2.5;
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

        console.log('[StudioViewer] ✓ Terrain lighting configured');

        viewerRef.current = viewer;
        onViewerReady(viewer);
        console.log('[StudioViewer] ✓ Viewer initialized');

        // Load parcel and fly to camera
        await loadParcelFromSnapshot(viewer, snapshot, visualStyle);
        await flyToParcelWithTerrain(viewer, snapshot);

        // ── FINAL VERIFICATION ────────────────────────────────────────
        console.log('[StudioViewer] ═══════════════════════════════════════');
        console.log('[StudioViewer] FINAL TERRAIN STATUS:');
        console.log('[StudioViewer] Provider type:', viewer.terrainProvider?.constructor?.name || 'Unknown');
        console.log('[StudioViewer] Vertical exaggeration:', viewer.scene.verticalExaggeration + 'x');
        console.log('[StudioViewer] Globe lighting:', viewer.scene.globe.enableLighting);
        console.log('[StudioViewer] Terrain shadows:', viewer.terrainShadows);
        console.log('[StudioViewer] ═══════════════════════════════════════');
        
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
    const exaggeration = visualStyle.terrainExaggeration || 2.5;
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
      const entity = viewer.entities.getById(layerId);
      if (entity) {
        entity.show = visible;
        console.log(`[StudioViewer] ${layerId}: ${visible ? 'visible' : 'hidden'}`);
      }
    });

    console.log('[StudioViewer] ✓ Layer visibility updated');
  }, [layerState]);

  // ============================================================================
  // HELICOPTER MODE & CAMERA VIEW PRESETS
  // ============================================================================

  const startHelicopterMode = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const Cesium = window.Cesium;
    setHelicopterMode(true);

    const centroidLon = snapshot.parcel.centroid[0];
    const centroidLat = snapshot.parcel.centroid[1];
    const areaHa = snapshot.parcel.area_ha ?? 100;

    // Orbit parameters scaled to parcel size
    const RADIUS_DEG = Math.max(0.003, Math.min(0.010, Math.sqrt(areaHa) * 0.0009));
    const HEIGHT     = Math.max(200, Math.min(600, Math.sqrt(areaHa) * 45));
    const SPEED      = 0.06;  // Degrees per frame — slow cinematic orbit

    // Initial flyTo to approach position
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        centroidLon - RADIUS_DEG * 0.7,
        centroidLat - RADIUS_DEG * 0.4,
        HEIGHT + 100
      ),
      orientation: {
        heading: Cesium.Math.toRadians(45),
        pitch:   Cesium.Math.toRadians(-30),
        roll:    0,
      },
      duration: 3,
    });

    // Start orbit AFTER the initial flyTo completes (3s)
    let angle = 45;
    setTimeout(() => {
      if (!helicopterIntervalRef.current) return; // mode was stopped during flyTo
      helicopterIntervalRef.current = setInterval(() => {
        if (!viewer || viewer.isDestroyed()) {
          stopHelicopterMode();
          return;
        }

        angle += SPEED;
        if (angle > 360) angle -= 360;

        const rad = Cesium.Math.toRadians(angle);

        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            centroidLon + Math.cos(rad) * RADIUS_DEG,
            centroidLat + Math.sin(rad) * RADIUS_DEG * 0.6,
            HEIGHT,
          ),
          orientation: {
            heading: Cesium.Math.toRadians(angle + 180),
            pitch:   Cesium.Math.toRadians(-25),
            roll:    0,
          },
        });
      }, 50);
    }, 3200);

    // Use a placeholder ref value during flyTo so the timeout check works
    helicopterIntervalRef.current = -1 as any;

    console.log('[StudioViewer] 🚁 Helicopter mode started — radius:', RADIUS_DEG.toFixed(4), 'height:', HEIGHT.toFixed(0) + 'm');
  };

  const stopHelicopterMode = () => {
    if (helicopterIntervalRef.current) {
      clearInterval(helicopterIntervalRef.current);
      helicopterIntervalRef.current = null;
    }
    setHelicopterMode(false);
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
    const distanceM = Math.max(1500, Math.min(5000, Math.sqrt(areaHa) * 160));

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, distanceM * 1.5),
      orientation: {
        heading: 0,
        pitch:   Cesium.Math.toRadians(-90),
        roll:    0,
      },
      duration: 2,
    });

    console.log('[StudioViewer] 🗺️ Vista cenital completa');
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