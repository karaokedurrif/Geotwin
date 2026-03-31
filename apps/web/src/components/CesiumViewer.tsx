'use client';

import { useEffect, useRef, useState } from 'react';
import type { TwinRecipe, LayerType } from '@geotwin/types';
import { withTimeout, TimeoutError, checkAPIHealth } from '@/utils/withTimeout';
import { waitForViewerReady, waitForSceneReady, ViewerNotReadyError } from '@/utils/cesiumUtils';
import { reprojectKmlString, parseGmlBuildings } from '@/lib/geo/reprojectKml';
import { exportParcelGeoJSON, exportParcelMetadata, downloadTextFile } from '@/lib/exportUtils';
import { twinStore, generateTwinId, createSnapshotFromRecipe } from '@/lib/twinStore';
import type { TwinSnapshot } from '@/lib/twinStore';

interface CesiumViewerProps {
  recipe: TwinRecipe;
  enabledLayers: Set<LayerType>;
  tileMode?: boolean;
  terrainEnabled?: boolean;
  terrainSource?: 'world' | 'mdt02'; // 'world' = Cesium World Terrain, 'mdt02' = Local MDT02
  realNDVIEnabled?: boolean;
  framingMargin?: number; // Margin factor for isometric view (1.1-2.0), default 1.35
  terrainExaggeration?: number; // Vertical exaggeration (1.0-3.0), default 1.0
  onViewerReady?: (viewer: any) => void;
  onLogMessage?: (message: string) => void;
  onStatusUpdate?: (status: ViewerStatus) => void;
  onParcelInfo?: (info: {
    centroidLonLat: [number, number];
    radius: number;
    boundingSphere: any;
  }) => void;
  onRecenterReady?: (ready: boolean) => void;
  onExportReady?: (ready: boolean) => void;
}

type LoadingState = 'idle' | 'loading' | 'success' | 'fallback' | 'error';

interface ViewerStatus {
  terrainType: LoadingState;
  terrainSource?: 'world' | 'mdt02' | 'ellipsoid';
  terrainMessage?: string;
  imageryType: LoadingState;
  imageryMessage?: string;
  ndviStatus: { status: LoadingState; message?: string; size?: number };
  apiStatus: { healthy: boolean; latency?: number; error?: string };
  apiBaseUrl: string;
  isOffline: boolean; // True when navigator.onLine=false or excessive tile errors
  parcelStatus?: {
    loaded: boolean;
    centroid?: [number, number]; // [lon, lat]
    radiusMeters?: number;
    wasReprojected?: boolean;
    sourceEPSG?: string;
    error?: string;
  };
}

type Cartesian3 = {
  x: number;
  y: number;
  z: number;
};

type BoundingSphere = {
  center: Cartesian3;
  radius: number;
};

/**
 * Compute ideal camera range based on parcel radius.
 * Dynamic calculation ensures optimal framing for all parcel sizes.
 * Formula optimized for ultra-small parcels (< 20m):
 * - Base multiplier: 1.5x radius (closer than previous 2.2x)
 * - With marginFactor adjustment, provides tight framing for maximum resolution
 */
function computeIdealRange(radius: number): number {
  // For ultra-small parcels, use aggressive close-up
  if (radius < 20) {
    return radius * 1.5;
  }
  // For small-medium parcels, slightly more distance
  if (radius < 100) {
    return radius * 1.8;
  }
  // For large parcels, standard framing
  return radius * 2.2;
}

/**
 * Alternative: compute range from area (for backward compatibility)
 */
function computeIdealRangeFromArea(areaHa: number): number {
  // Convert area to approximate radius: radius = sqrt(area / π)
  const radiusMeters = Math.sqrt((areaHa * 10000) / Math.PI);
  return computeIdealRange(radiusMeters);
}

// Timeout configuration (ms)
const TIMEOUTS = {
  TERRAIN: 12000,
  IMAGERY: 12000,
  NDVI: 15000,
  API_HEALTH: 5000,
};

declare global {
  interface Window {
    Cesium: any;
  }
}

export default function CesiumViewer({ 
  recipe, 
  enabledLayers, 
  tileMode = false, 
  terrainEnabled = true, 
  terrainSource = 'world',
  realNDVIEnabled = false,
  framingMargin = 1.15,
  terrainExaggeration = 1.0,
  onViewerReady,
  onLogMessage,
  onStatusUpdate,
  onParcelInfo,
  onRecenterReady,
  onExportReady
}: CesiumViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const cesiumViewerRef = useRef<any>(null);
  const dataSourcesRef = useRef<Map<LayerType, any>>(new Map());
  const ndviLayerRef = useRef<any>(null);
  const ndviBboxEntityRef = useRef<any>(null);
  
  // Session tracking to prevent operations on destroyed viewer
  const sessionRef = useRef<number>(0);
  const currentSessionRef = useRef<number>(0);
  
  // Store parcel data for robust recenter functionality
  const parcelDataSourceRef = useRef<any>(null);
  const parcelBoundingSphereRef = useRef<any>(null);
  const parcelPositionsRef = useRef<any[]>([]); // Store parcel polygon positions for plinth
  const logThrottleRef = useRef<Record<string, number>>({});
  const mapParcelContainerRef = useRef<any>(null);
  const tileErrorCountRef = useRef(0); // Track consecutive tile load errors
  const lastErrorResetRef = useRef(Date.now()); // Reset error count after 30s without errors
  const plinthEntityRef = useRef<any>(null); // Ground plinth rectangle entity
  
  // Store current framingMargin and terrainExaggeration to use in methods
  const framingMarginRef = useRef<number>(framingMargin);
  const terrainExaggerationRef = useRef<number>(terrainExaggeration);
  
  // Update refs whenever props change
  useEffect(() => {
    framingMarginRef.current = framingMargin;
  }, [framingMargin]);
  
  useEffect(() => {
    terrainExaggerationRef.current = terrainExaggeration;
  }, [terrainExaggeration]);
  
  // Apply terrain exaggeration to viewer when it changes
  useEffect(() => {
    if (!cesiumViewerRef.current || typeof window === 'undefined') return;
    const viewer = cesiumViewerRef.current;
    if (viewer && !viewer.isDestroyed() && viewer.scene) {
      // Use the correct non-deprecated API
      viewer.scene.verticalExaggeration = terrainExaggeration;
      // verticalExaggerationRelativeHeight determines the "sea level" reference
      viewer.scene.verticalExaggerationRelativeHeight = 0;
      logMessage(`Terrain exaggeration: ${terrainExaggeration.toFixed(2)}×`, 'info');
    }
  }, [terrainExaggeration]);
  
  const [viewerStatus, setViewerStatus] = useState<ViewerStatus>({
    terrainType: 'idle',
    imageryType: 'idle',
    imageryMessage: undefined,
    ndviStatus: { status: 'idle' },
    apiStatus: { healthy: false },
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001',
    isOffline: false,
  });

  // Log helper
  const logMessage = (message: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const prefix = level === 'success' ? '✓' : level === 'warn' ? '⚠' : level === 'error' ? '❌' : 'ℹ';
    const fullMessage = `${prefix} ${message}`;
    console.log(fullMessage);
    if (onLogMessage) {
      onLogMessage(fullMessage);
    }
  };

  const shouldLog = (key: string, intervalMs = 5000): boolean => {
    const now = Date.now();
    const last = logThrottleRef.current[key] || 0;
    if (now - last < intervalMs) return false;
    logThrottleRef.current[key] = now;
    return true;
  };

  const getErrorMessage = (err: unknown): string => {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && 'message' in err) {
      const msg = (err as { message?: unknown }).message;
      return typeof msg === 'string' ? msg : 'Unknown error';
    }
    return 'Unknown error';
  };

  const isOfflineError = (message: string): boolean => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
    return message.includes('ERR_INTERNET_DISCONNECTED') || message.includes('Failed to fetch') || message.includes('NetworkError');
  };

  const handleConnectivityIssue = (source: 'imagery' | 'terrain', errMsg: string) => {
    const offline = isOfflineError(errMsg);
    const key = `${source}-offline`;
    
    // Increment error count for effective offline detection
    const now = Date.now();
    if (now - lastErrorResetRef.current > 30000) {
      tileErrorCountRef.current = 0; // Reset after 30s without errors
    }
    tileErrorCountRef.current += 1;
    lastErrorResetRef.current = now;

    // Consider "effectively offline" if 5+ errors in 30s window
    const effectivelyOffline = offline || tileErrorCountRef.current >= 5;

    if (effectivelyOffline && shouldLog(key)) {
      logMessage(`🔴 Offline detected (${source}): ${tileErrorCountRef.current} tile errors. Check DevTools Network throttling.`, 'warn');
    }

    // Set globe to dark gray (not black) when offline
    if (effectivelyOffline && cesiumViewerRef.current && !cesiumViewerRef.current.isDestroyed()) {
      const Cesium = window.Cesium;
      if (Cesium && cesiumViewerRef.current.scene?.globe) {
        cesiumViewerRef.current.scene.globe.baseColor = Cesium.Color.DARKGRAY;
        if (shouldLog('globe-color-offline')) {
          logMessage('Globe color set to gray (offline fallback)', 'info');
        }
      }
    }

    if (source === 'imagery') {
      setViewerStatus(prev => ({
        ...prev,
        imageryType: 'fallback',
        imageryMessage: effectivelyOffline ? 'Offline: imagery tiles cannot load' : errMsg,
        isOffline: effectivelyOffline,
      }));
    } else {
      setViewerStatus(prev => ({
        ...prev,
        terrainType: 'fallback',
        terrainSource: 'ellipsoid',
        terrainMessage: effectivelyOffline ? 'Offline: terrain tiles cannot load' : errMsg,
        isOffline: effectivelyOffline,
      }));
    }
  };

  const attachImageryErrorHandler = (provider: unknown, label: string) => {
    const errorEvent = (provider as { errorEvent?: { addEventListener?: (cb: (err: unknown) => void) => void } })?.errorEvent;
    if (!errorEvent?.addEventListener) return;
    errorEvent.addEventListener((err: unknown) => {
      const msg = getErrorMessage(err);
      if (isOfflineError(msg)) {
        if (shouldLog(`imagery-${label}`)) {
          logMessage(`Imagery offline (${label}): ${msg}`, 'warn');
        }
        handleConnectivityIssue('imagery', msg);
      }
    });
  };

  const attachTerrainErrorHandler = (provider: unknown, label: string) => {
    const errorEvent = (provider as { errorEvent?: { addEventListener?: (cb: (err: unknown) => void) => void } })?.errorEvent;
    if (!errorEvent?.addEventListener) return;
    errorEvent.addEventListener((err: unknown) => {
      const msg = getErrorMessage(err);
      if (isOfflineError(msg)) {
        if (shouldLog(`terrain-${label}`)) {
          logMessage(`Terrain offline (${label}): ${msg}`, 'warn');
        }
        handleConnectivityIssue('terrain', msg);
      }
    });
  };

  // Detect online/offline state via navigator.onLine
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      logMessage('🟢 Network online detected', 'success');
      setViewerStatus(prev => ({ ...prev, isOffline: false }));
      tileErrorCountRef.current = 0; // Reset error count
      
      // Restore default globe color
      if (cesiumViewerRef.current && !cesiumViewerRef.current.isDestroyed()) {
        const Cesium = window.Cesium;
        if (Cesium && cesiumViewerRef.current.scene?.globe) {
          // Use a visible gray color, not too dark
          cesiumViewerRef.current.scene.globe.baseColor = Cesium.Color.DARKGRAY;
        }
      }
    };

    const handleOffline = () => {
      logMessage('🔴 Network offline detected', 'warn');
      setViewerStatus(prev => ({
        ...prev,
        isOffline: true,
        imageryType: 'fallback',
        terrainType: 'fallback',
        imageryMessage: 'Offline: no network connection',
        terrainMessage: 'Offline: no network connection',
      }));
      
      // Set globe to dark gray immediately
      if (cesiumViewerRef.current && !cesiumViewerRef.current.isDestroyed()) {
        const Cesium = window.Cesium;
        if (Cesium && cesiumViewerRef.current.scene?.globe) {
          cesiumViewerRef.current.scene.globe.baseColor = Cesium.Color.DARKGRAY;
        }
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check initial state
    if (!navigator.onLine) {
      handleOffline();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Update status and notify parent
  useEffect(() => {
    if (onStatusUpdate) {
      onStatusUpdate(viewerStatus);
    }
  }, [viewerStatus, onStatusUpdate]);

  // Check API health on mount
  useEffect(() => {
    async function checkHealth() {
      logMessage('Checking API health...', 'info');
      const health = await checkAPIHealth(viewerStatus.apiBaseUrl, TIMEOUTS.API_HEALTH);
      
      setViewerStatus(prev => ({ ...prev, apiStatus: health }));
      
      if (health.healthy) {
        logMessage(`API online (${health.latencyMs}ms)`, 'success');
      } else {
        logMessage(`API offline: ${health.error}`, 'warn');
      }
    }
    
    checkHealth();
  }, [viewerStatus.apiBaseUrl]);

  // Initialize Cesium viewer (NON-BLOCKING, ONCE)
  useEffect(() => {
    if (!viewerRef.current || typeof window === 'undefined' || !window.Cesium) {
      return;
    }

    // Increment session ID (invalidates previous sessions)
    sessionRef.current += 1;
    const thisSession = sessionRef.current;
    currentSessionRef.current = thisSession;

    const Cesium = window.Cesium;
    let viewer: any = null;

    async function initializeViewer() {
      if (!viewerRef.current || currentSessionRef.current !== thisSession) return;

      // Debug: Check container dimensions
      console.log('[DEBUG] Container dimensions:', {
        offsetWidth: viewerRef.current.offsetWidth,
        offsetHeight: viewerRef.current.offsetHeight,
        clientWidth: viewerRef.current.clientWidth,
        clientHeight: viewerRef.current.clientHeight,
        computed: window.getComputedStyle(viewerRef.current).getPropertyValue('display')
      });

      try {
        const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
        
        if (ionToken) {
          Cesium.Ion.defaultAccessToken = ionToken;
          logMessage(`Cesium Ion token configured (${ionToken.substring(0, 10)}...)`, 'success');
        } else {
          logMessage('No Cesium Ion token found - using free providers', 'warn');
        }

        // === STEP 1: CREATE VIEWER IMMEDIATELY (NO WAITING) ===
        logMessage('Initializing Cesium viewer...', 'info');
        
        // Start with basic OSM imagery (always works, no waiting)
        viewer = new Cesium.Viewer(viewerRef.current, {
          imageryProvider: new Cesium.OpenStreetMapImageryProvider({
            url: 'https://tile.openstreetmap.org/',
          }),
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          vrButton: false,
          infoBox: false,
          selectionIndicator: false,
        });

        // Attach offline-aware error handler for base imagery
        const baseLayer = viewer.imageryLayers?.get?.(0);
        if (baseLayer?.imageryProvider) {
          attachImageryErrorHandler(baseLayer.imageryProvider, 'osm');
          // Ensure base layer is visible
          baseLayer.show = true;
          baseLayer.alpha = 1.0;
          console.log('[DEBUG] Base imagery layer configured:', {
            show: baseLayer.show,
            alpha: baseLayer.alpha,
            ready: baseLayer.imageryProvider.ready
          });
        }

        // Check session before continuing
        if (currentSessionRef.current !== thisSession) {
          viewer.destroy();
          return;
        }

        // Initial camera position (generic fallback - will be corrected by loadGeometry)
        // Start with a neutral view; loadGeometry will flyTo the actual parcel extent
        const cameraHeight = computeIdealRangeFromArea(recipe.area_ha);
        
        // Use centroid from recipe (calculated from actual geometry bbox)
        const bbox = recipe.bbox || [-4, 40, -3, 41]; // Fallback to Spain region
        const centerLon = (bbox[0] + bbox[2]) / 2;
        const centerLat = (bbox[1] + bbox[3]) / 2;
        
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            centerLon,
            centerLat,
            cameraHeight
          ),
          orientation: {
            heading: Cesium.Math.toRadians(0),  // North-facing initially
            pitch: Cesium.Math.toRadians(-45), // Looking down
            roll: 0.0,
          },
        });
        
        logMessage(`Initial view: [${centerLon.toFixed(4)}, ${centerLat.toFixed(4)}]`, 'info');

        // === VISUAL ENHANCEMENTS ===
        // Set globe base color to prevent black screen during tile loading
        viewer.scene.globe.baseColor = Cesium.Color.DARKGRAY;
        // Set background color to prevent black void
        viewer.scene.backgroundColor = Cesium.Color.DARKGRAY;
        // Ensure globe is visible
        viewer.scene.globe.show = true;
        
        // PHASE 1 FIX: Enhanced terrain visualization
        // Set time to morning for optimal sun angle and shadows in Spain
        viewer.clock.currentTime = Cesium.JulianDate.fromIso8601('2026-06-15T09:30:00Z');
        viewer.clock.shouldAnimate = false; // freeze time — no day/night cycle
        
        // Terrain detail — more triangles visible (lower = more detail)
        viewer.scene.globe.maximumScreenSpaceError = 0.5; // default is 2.0, lower = sharper tiles
        
        // Depth test: disabled when using verticalExaggeration > 1.0
        // With exaggeration, clampToGround entities render at non-exaggerated height
        // and get depth-tested against exaggerated terrain, making them invisible.
        viewer.scene.globe.depthTestAgainstTerrain = false;
        
        // Enable sun lighting on terrain surface
        viewer.scene.globe.enableLighting = true;
        
        // Subtle atmospheric scattering
        viewer.scene.skyAtmosphere.show = true;
        viewer.scene.skyAtmosphere.atmosphereLightIntensity = 10.0;
        viewer.scene.fog.enabled = true;
        viewer.scene.fog.density = 0.0003;
        viewer.scene.fog.minimumBrightness = 0.0;
        
        // Enable FXAA antialiasing for smoother edges
        if (viewer.scene.postProcessStages?.fxaa) {
          viewer.scene.postProcessStages.fxaa.enabled = true;
        }
        
        logMessage('Visual enhancements enabled (morning light, terrain detail, atmosphere)', 'info');

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
        
        logMessage('Free flight controls enabled (helicopter mode)', 'info');

        // Hide Cesium attribution/upgrade container (optional, only in dev)
        if (viewer.bottomContainer && process.env.NODE_ENV === 'development') {
          viewer.bottomContainer.style.display = 'none';
        }

        cesiumViewerRef.current = viewer;
        (window as any).viewer = viewer;
        logMessage('Viewer initialized (OSM + Ellipsoid)', 'success');
        
        // Debug: Log viewer state
        console.log('[DEBUG] Viewer created:', {
          isDestroyed: viewer.isDestroyed(),
          canvas: viewer.canvas,
          canvasWidth: viewer.canvas?.width,
          canvasHeight: viewer.canvas?.height,
          sceneMode: viewer.scene?.mode,
          globeShow: viewer.scene?.globe?.show,
          baseColor: viewer.scene?.globe?.baseColor,
          backgroundColor: viewer.scene?.backgroundColor,
          imageryLayersLength: viewer.imageryLayers?.length
        });

        // Attach refs to viewer for access in helper functions
        viewer.parcelDataSourceRef = parcelDataSourceRef;
        viewer.parcelBoundingSphereRef = parcelBoundingSphereRef;

        // Expose recenterCamera method on viewer instance
        viewer.recenterCamera = async () => {
          if (!viewer || viewer.isDestroyed()) {
            console.warn('[Recenter] Viewer destroyed');
            return;
          }

          const Cesium = window.Cesium;
          let sphere = parcelBoundingSphereRef.current;

          if (!sphere && parcelDataSourceRef.current?.entities?.values) {
            sphere = computeEntityBoundingSphere(parcelDataSourceRef.current.entities.values, Cesium);
            if (sphere) {
              parcelBoundingSphereRef.current = sphere;
            }
          }

          if (!sphere) {
            logMessage('⚠️ No parcel loaded to recenter to', 'warn');
            onRecenterReady?.(false);
            return;
          }

          // Use current framingMargin from ref (not closure)
          await flyToIsometric(viewer, sphere, framingMarginRef.current);
          logMessage('✓ Camera recentered (isometric)', 'success');
        };

        viewer.isometricView = async () => {
          if (!viewer || viewer.isDestroyed()) return;

          const sphere = parcelBoundingSphereRef.current;
          if (!sphere) {
            logMessage('⚠️ No parcel loaded for isometric view', 'warn');
            return;
          }

          // Use current framingMargin from ref (not closure)
          await flyToIsometric(viewer, sphere, framingMarginRef.current);
          logMessage('✓ Isometric view applied', 'success');
        };

        // Expose "Save Twin" method - consolidates full twin state into single JSON snapshot
        viewer.saveTwinSnapshot = (sourceFileName?: string, store?: typeof twinStore, recipe?: TwinRecipe) => {
          if (!viewer || viewer.isDestroyed()) {
            logMessage('⚠️ Viewer destroyed', 'warn');
            return null;
          }

          const Cesium = window.Cesium;
          const parcelEntity = parcelDataSourceRef.current?.entities?.values.find(
            (e: any) => e?.polygon && e.name !== 'NDVI_BBOX_DEBUG'
          );
          const sphere = parcelBoundingSphereRef.current;

          if (!parcelEntity || !sphere) {
            logMessage('⚠️ No parcel loaded to save', 'warn');
            return null;
          }

          try {
            // Extract parcel data (reuse existing export function)
            const geojson = exportParcelGeoJSON(parcelEntity, Cesium, sourceFileName);
            const parcelData = typeof geojson === 'string' ? JSON.parse(geojson) : geojson;
            const properties = parcelData.features[0].properties;

            // Get camera state
            const camera = viewer.camera;
            const heading = Cesium.Math.toDegrees(camera.heading);
            const pitch = Cesium.Math.toDegrees(camera.pitch);
            const cartographic = Cesium.Cartographic.fromCartesian(sphere.center);
            const centerPos = camera.position;
            const distance = Cesium.Cartesian3.distance(centerPos, sphere.center);

            // Extract sensors and cattle from viewer entities
            const sensors: any[] = [];
            const cattle: any[] = [];
            viewer.entities.values.forEach((entity: any) => {
              if (entity.name?.startsWith('IoT Node')) {
                const pos = entity.position?.getValue?.(Cesium.JulianDate.now());
                if (pos) {
                  const cart = Cesium.Cartographic.fromCartesian(pos);
                  const labelText = entity.label?.text?.getValue?.(Cesium.JulianDate.now()) || '';
                  sensors.push({
                    id: entity.name,
                    lat: Cesium.Math.toDegrees(cart.latitude),
                    lon: Cesium.Math.toDegrees(cart.longitude),
                    type: labelText.split('\\n')[0] || 'UNKNOWN',
                  });
                }
              } else if (entity.name?.startsWith('Cow')) {
                const pos = entity.position?.getValue?.(Cesium.JulianDate.now());
                if (pos) {
                  const cart = Cesium.Cartographic.fromCartesian(pos);
                  const labelText = entity.label?.text?.getValue?.(Cesium.JulianDate.now()) || '';
                  const [id, weightStr] = labelText.split('\\n');
                  cattle.push({
                    id: id || entity.name,
                    lat: Cesium.Math.toDegrees(cart.latitude),
                    lon: Cesium.Math.toDegrees(cart.longitude),
                    weight: parseInt(weightStr?.replace('kg', '') || '0'),
                  });
                }
              }
            });

            // Get layer state
            const layers: Record<string, boolean> = {};
            enabledLayers.forEach(layer => {
              layers[layer] = true;
            });

            // Generate unique twin ID
            const twinId = generateTwinId();

            // Build snapshot with camera centerLon/centerLat
            const snapshot: TwinSnapshot = {
              version: '1.0',
              twinId,
              timestamp: new Date().toISOString(),
              parcel: {
                sourceFile: sourceFileName || 'unknown.kml',
                name: properties.name || sourceFileName?.replace(/\\.(kml|gml|geojson)$/, '') || 'Unnamed Parcel',
                geojson: parcelData,
                area_ha: (properties.area_m2 || 0) / 10000,
                centroid: [
                  Cesium.Math.toDegrees(cartographic.longitude),
                  Cesium.Math.toDegrees(cartographic.latitude),
                ],
              },
              sensors: sensors.map(s => ({
                id: s.id,
                type: s.type as any,
                lat: s.lat,
                lon: s.lon,
                status: 'ok' as const,
                value: 0,
                unit: '',
                lastUpdate: new Date().toISOString(),
              })),
              cattle: cattle.map(c => ({
                id: c.id,
                lat: c.lat,
                lon: c.lon,
                weight: c.weight,
                collarId: c.collarId,
                health: c.health,
              })),
              layers,
              camera: {
                headingDeg: heading,
                pitchDeg: pitch,
                range_m: distance,
                centerLon: Cesium.Math.toDegrees(cartographic.longitude),
                centerLat: Cesium.Math.toDegrees(cartographic.latitude),
              },
            };

            // Save using twinStore if provided (NEW APPROACH)
            if (store) {
              store.save(snapshot);
              logMessage(`💾 Twin saved to twinStore (ID: ${twinId})`, 'success');
            } else {
              // Fallback: old localStorage pattern (for compatibility)
              const parcelId = sourceFileName?.replace(/\\.(kml|gml|geojson)$/, '') || 'twin';
              localStorage.setItem(`geotwin_${parcelId}`, JSON.stringify(snapshot));
              logMessage(`💾 Twin saved to localStorage (key: geotwin_${parcelId})`, 'success');
            }

            // Single download
            const parcelId = sourceFileName?.replace(/\\.(kml|gml|geojson)$/, '') || twinId;
            downloadTextFile(`geotwin_${parcelId}_snapshot.json`, JSON.stringify(snapshot, null, 2), 'application/json');
            logMessage(`📦 Twin snapshot downloaded (${sensors.length} sensors, ${cattle.length} cattle)`, 'success');

            return twinId; // Return twinId for UI use
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            logMessage(`❌ Save failed: ${errorMsg}`, 'error');
            console.error('[SaveTwin] Error:', error);
            return null;
          }
        };

        // === SETUP ENTITY SELECTION HANDLER ===
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        
        handler.setInputAction((movement: any) => {
          const pickedObject = viewer.scene.pick(movement.position);
          if (Cesium.defined(pickedObject) && Cesium.defined(pickedObject.id)) {
            const entity = pickedObject.id;
            
            // Only handle our parcel entities (including the invisible clickable point)
            // Check if the clicked entity belongs to the current parcel dataSource
            const parcelDS = parcelDataSourceRef.current;
            const isParcelEntity = parcelDS && parcelDS.entities.values.some((e: any) => e === entity);

            if (isParcelEntity) {
              // Visual feedback: highlight polygon
              if (parcelDS) {
                // Find the first polygon entity in the dataSource
                const polygonEntity = parcelDS.entities.values.find(
                  (e: any) => e?.polygon
                );

                if (polygonEntity && polygonEntity.polygon) {
                  // Toggle highlight - handle both raw Cesium.Color and ColorMaterialProperty
                  const currentMaterial = polygonEntity.polygon.material;
                  let currentColor: any;
                  if (currentMaterial && typeof currentMaterial.getValue === 'function') {
                    currentColor = currentMaterial.getValue(Cesium.JulianDate.now());
                  } else {
                    currentColor = currentMaterial;
                  }

                  // Check if already highlighted (YELLOW)
                  if (currentColor && Cesium.Color.equals(currentColor, Cesium.Color.YELLOW.withAlpha(0.5))) {
                    // Un-highlight: restore CYAN
                    polygonEntity.polygon.material = Cesium.Color.CYAN.withAlpha(0.35);
                    logMessage('Parcel deselected', 'info');
                  } else {
                    // Highlight: change to YELLOW
                    polygonEntity.polygon.material = Cesium.Color.YELLOW.withAlpha(0.5);
                    logMessage('✓ Parcel selected (click again to deselect)', 'success');
                  }
                }
              }
            }
          } else {
            // Clicked on empty space - deselect any selected parcel
            const parcelDS = parcelDataSourceRef.current;
            if (parcelDS) {
              const polygonEntity = parcelDS.entities.values.find(
                (e: any) => e?.polygon
              );

              if (polygonEntity && polygonEntity.polygon) {
                const currentMaterial = polygonEntity.polygon.material;
                let currentColor: any;
                if (currentMaterial && typeof currentMaterial.getValue === 'function') {
                  currentColor = currentMaterial.getValue(Cesium.JulianDate.now());
                } else {
                  currentColor = currentMaterial;
                }

                // If highlighted, restore original color
                if (currentColor && Cesium.Color.equals(currentColor, Cesium.Color.YELLOW.withAlpha(0.5))) {
                  polygonEntity.polygon.material = Cesium.Color.CYAN.withAlpha(0.35);
                  logMessage('Parcel deselected (clicked background)', 'info');
                }
              }
            }
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // Store handler for cleanup
        viewer.clickHandler = handler;
        logMessage('✓ Entity selection enabled (click parcel to highlight)', 'info');

        // Notify parent immediately
        if (onViewerReady) {
          onViewerReady(viewer);
        }

        // === WAIT FOR CESIUM TO BE FULLY READY ===
        // Use robust utility with timeout protection
        try {
          await waitForViewerReady(viewer, { timeout: 10000 });
          logMessage('Viewer scene ready', 'success');
        } catch (error) {
          if (error instanceof ViewerNotReadyError) {
            logMessage(`Viewer initialization timeout: ${error.message}`, 'error');
            throw error;
          }
          throw error;
        }
        
        // Check session again after async operation
        if (currentSessionRef.current !== thisSession || viewer.isDestroyed()) {
          return;
        }

        // Apply preset config
        applyPresetConfig(viewer, recipe, tileMode, terrainEnabled);

        // Native DPI: render at full device pixel ratio for HiDPI screens
        viewer.resolutionScale = window.devicePixelRatio || 1.0;
        
        // Debug: Log viewer state after preset config
        console.log('[DEBUG] After applyPresetConfig:', {
          globeShow: viewer.scene?.globe?.show,
          baseColor: viewer.scene?.globe?.baseColor?.toString(),
          backgroundColor: viewer.scene?.backgroundColor?.toString(),
          skyAtmosphereShow: viewer.scene?.skyAtmosphere?.show
        });

        // === STEP 3: UPGRADE TO ION IMAGERY (ASYNC, non-blocking) ===
        if (ionToken) {
          upgradeImagery(viewer, Cesium, ionToken, thisSession);
        } else {
          setViewerStatus(prev => ({ ...prev, imageryType: 'success' }));
          logMessage('Using OSM imagery (no Ion token)', 'info');
        }

        // === STEP 4: LOAD TERRAIN (AWAIT — needed for accurate camera positioning) ===
        if (terrainEnabled && ionToken) {
          await upgradeTerrain(viewer, Cesium, terrainSource, thisSession);
        } else if (terrainEnabled && terrainSource === 'mdt02') {
          await upgradeTerrain(viewer, Cesium, terrainSource, thisSession);
        } else {
          setViewerStatus(prev => ({ ...prev, terrainType: 'success', terrainSource: 'ellipsoid' }));
          logMessage('Using ellipsoid terrain (disabled or no token)', 'info');
        }

        // Check session/viewer after terrain load
        if (currentSessionRef.current !== thisSession || viewer.isDestroyed()) return;

        // === STEP 5: LOAD GEOMETRY + FLY TO PARCEL (terrain already available) ===
        loadGeometry(
          viewer,
          recipe,
          tileMode,
          logMessage,
          thisSession,
          currentSessionRef,
          setViewerStatus,
          terrainEnabled,
          parcelBoundingSphereRef,
          parcelDataSourceRef,
          parcelPositionsRef,
          framingMargin,
          onParcelInfo,
          onRecenterReady,
          onExportReady
        );
      } catch (error) {
        const errorMsg = `Failed to initialize viewer: ${error instanceof Error ? error.message : 'Unknown'}`;
        logMessage(errorMsg, 'error');
        console.error(error);
      }
    }

    // === IMAGERY UPGRADE FUNCTION (WITH SESSION CHECK) ===
    async function upgradeImagery(viewer: any, Cesium: any, ionToken: string, session: number) {
      setViewerStatus(prev => ({ ...prev, imageryType: 'loading' }));
      logMessage('Loading imagery layers...', 'info');
      
      let ionSuccess = false;
      
      // Try Ion Bing Maps imagery (optional - many accounts don't have asset 2)
      try {
        const imageryProvider = await withTimeout(
          Cesium.IonImageryProvider.fromAssetId(2),
          TIMEOUTS.IMAGERY,
          'Ion Imagery'
        );

        // Check session and viewer state
        if (currentSessionRef.current !== session) {
          logMessage('Session invalidated during imagery load', 'warn');
          return;
        }
        
        if (!viewer || viewer.isDestroyed()) {
          logMessage('Viewer destroyed during imagery load', 'warn');
          return;
        }
        
        if (!viewer.imageryLayers) {
          logMessage('Viewer not ready - imagery layers unavailable', 'warn');
          setViewerStatus(prev => ({ ...prev, imageryType: 'fallback' }));
          return;
        }

        // Replace base layer with Ion imagery
        const layers = viewer.imageryLayers;
        const baseLayer = layers.get(0);
        layers.remove(baseLayer);
        layers.addImageryProvider(imageryProvider, 0);
        attachImageryErrorHandler(imageryProvider, 'ion');
        ionSuccess = true;
        logMessage('✓ Ion Bing Maps imagery loaded', 'success');
      } catch (error) {
        // Check if session is still valid
        if (currentSessionRef.current !== session) return;

        const errorMsg = error instanceof Error ? error.message : 'Unknown';
        logMessage(`Ion imagery unavailable (${errorMsg}) - keeping OSM base`, 'warn');
        // OSM base layer (set during viewer init) remains active - that's fine
      }
      
      // Check session/viewer before adding PNOA
      if (currentSessionRef.current !== session) return;
      if (!viewer || viewer.isDestroyed() || !viewer.imageryLayers) return;
      
      // ── PNOA Orthophoto via proxy (IGN no tiene CORS) ──
      try {
        const layers = viewer.imageryLayers;
        const pnoaProv = new Cesium.UrlTemplateImageryProvider({
          url: '/api/pnoa-tile/{z}/{x}/{y}',
          minimumLevel: 5,
          maximumLevel: 20,
          credit: 'PNOA © IGN España',
        });
        
        const pnoaLayer = layers.addImageryProvider(pnoaProv);
        
        // CRITICAL: Ensure PNOA layer has neutral settings for maximum sharpness
        pnoaLayer.brightness = 1.0;  // No brightness adjustment
        pnoaLayer.contrast = 1.0;    // No contrast boost (avoids blur)
        pnoaLayer.gamma = 1.0;       // No gamma correction
        pnoaLayer.saturation = 1.0;  // Natural colors
        pnoaLayer.alpha = 1.0;       // Full opacity (polygons are transparent decals on top)
        
        pnoaProv.errorEvent.addEventListener(() => {});
        logMessage('✓ PNOA imagery added (proxy, neutral settings)', 'success');
      } catch (pnoaError) {
        logMessage('PNOA imagery failed (optional)', 'warn');
      }
      
      // Set final status - OSM + PNOA is perfectly good even without Ion
      setViewerStatus(prev => ({ 
        ...prev, 
        imageryType: 'success',
        imageryMessage: ionSuccess ? 'Bing Maps + PNOA' : 'OSM + PNOA España',
      }));
    }

    // === TERRAIN UPGRADE FUNCTION (WITH SESSION CHECK) ===
    async function upgradeTerrain(viewer: any, Cesium: any, source: 'world' | 'mdt02', session: number) {
      setViewerStatus(prev => ({ ...prev, terrainType: 'loading' }));
      
      if (source === 'mdt02') {
        // ── MDT02 España from Cesium Ion ────────────────────────
        logMessage('Loading MDT02 España Terrain (Ion Asset 4475569)...', 'info');
        
        try {
          const mdt02AssetId = parseInt(process.env.NEXT_PUBLIC_MDT02_ASSET_ID || '4475569');
          
          const terrainProvider = await withTimeout(
            Cesium.CesiumTerrainProvider.fromIonAssetId(mdt02AssetId, {
              requestVertexNormals: true,
              requestWaterMask: false,
            }),
            TIMEOUTS.TERRAIN,
            'MDT02 Terrain'
          );

          // Check session and viewer state
          if (currentSessionRef.current !== session) {
            logMessage('Session invalidated during MDT02 terrain load', 'warn');
            return;
          }
          
          if (!viewer || viewer.isDestroyed()) {
            logMessage('Viewer destroyed during MDT02 terrain load', 'warn');
            return;
          }
          
          if (!viewer.scene || !viewer.scene.globe) {
            logMessage('Viewer not ready - scene/globe unavailable', 'warn');
            setViewerStatus(prev => ({ ...prev, terrainType: 'fallback', terrainSource: 'ellipsoid' }));
            return;
          }

          viewer.terrainProvider = terrainProvider;
          attachTerrainErrorHandler(terrainProvider, 'mdt02');
          
          // Enable enhanced terrain visualization
          viewer.scene.globe.enableLighting = true;
          viewer.scene.globe.depthTestAgainstTerrain = false;
          viewer.terrainShadows = Cesium.ShadowMode.ENABLED;

          setViewerStatus(prev => ({ 
            ...prev, 
            terrainType: 'success', 
            terrainSource: 'mdt02',
            terrainMessage: 'MDT02 España (2m resolution)'
          }));
          logMessage('✓ MDT02 España Terrain loaded (2m resolution)', 'success');
          
        } catch (error) {
          // Check if session is still valid
          if (currentSessionRef.current !== session) return;

          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          
          if (error instanceof TimeoutError) {
            logMessage(`MDT02 terrain timeout (${TIMEOUTS.TERRAIN}ms) - falling back to World Terrain`, 'warn');
          } else if (isOfflineError(errorMsg)) {
            if (shouldLog('terrain-mdt02-offline')) {
              logMessage('MDT02 terrain offline - falling back to World Terrain', 'warn');
            }
            handleConnectivityIssue('terrain', errorMsg);
          } else {
            logMessage(`MDT02 terrain failed: ${errorMsg} - falling back to World Terrain`, 'warn');
          }
          
          // Fallback to World Terrain instead of ellipsoid
          try {
            const worldTerrain = await Cesium.createWorldTerrainAsync({
              requestWaterMask: false,
              requestVertexNormals: true,
            });
            
            if (viewer && !viewer.isDestroyed()) {
              viewer.terrainProvider = worldTerrain;
              setViewerStatus(prev => ({ 
                ...prev, 
                terrainType: 'fallback', 
                terrainSource: 'world',
                terrainMessage: 'Fallback to World Terrain'
              }));
              logMessage('✓ World Terrain loaded (fallback)', 'success');
            }
          } catch (fallbackError) {
            // Ultimate fallback to ellipsoid
            if (viewer && !viewer.isDestroyed()) {
              viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
              setViewerStatus(prev => ({ 
                ...prev, 
                terrainType: 'fallback', 
                terrainSource: 'ellipsoid',
                terrainMessage: 'Using ellipsoid (fallback)'
              }));
            }
          }
        }
        
      } else {
        // Load Cesium World Terrain (existing logic)
        logMessage('Loading World Terrain...', 'info');
        
        try {
          const terrainProvider = await withTimeout(
            Cesium.createWorldTerrainAsync({
              requestWaterMask: true,
              requestVertexNormals: true,
            }),
            TIMEOUTS.TERRAIN,
            'World Terrain'
          );

          // Check session and viewer state
          if (currentSessionRef.current !== session) {
            logMessage('Session invalidated during terrain load', 'warn');
            return;
          }
          
          if (!viewer || viewer.isDestroyed()) {
            logMessage('Viewer destroyed during terrain load', 'warn');
            return;
          }
          
          if (!viewer.scene || !viewer.scene.globe) {
            logMessage('Viewer not ready - scene/globe unavailable', 'warn');
            setViewerStatus(prev => ({ ...prev, terrainType: 'fallback', terrainSource: 'ellipsoid' }));
            return;
          }

          viewer.terrainProvider = terrainProvider;
          attachTerrainErrorHandler(terrainProvider, 'world');
          viewer.scene.globe.enableLighting = true;
          viewer.scene.globe.depthTestAgainstTerrain = false;
          viewer.terrainShadows = Cesium.ShadowMode.ENABLED;

          setViewerStatus(prev => ({ 
            ...prev, 
            terrainType: 'success',
            terrainSource: 'world',
            terrainMessage: 'Cesium World Terrain'
          }));
          logMessage('✓ World Terrain loaded', 'success');
          
        } catch (error) {
          // Check if session is still valid
          if (currentSessionRef.current !== session) return;

          if (error instanceof TimeoutError) {
            logMessage(`Terrain timeout (${TIMEOUTS.TERRAIN}ms) - using ellipsoid`, 'warn');
            setViewerStatus(prev => ({ ...prev, terrainType: 'fallback', terrainSource: 'ellipsoid' }));
          } else {
            const errorMsg = error instanceof Error ? error.message : 'Unknown';
            if (isOfflineError(errorMsg)) {
              if (shouldLog('terrain-world-offline')) {
                logMessage('World terrain offline - using ellipsoid', 'warn');
              }
              handleConnectivityIssue('terrain', errorMsg);
            } else {
              logMessage(`Terrain failed: ${errorMsg} - using ellipsoid`, 'warn');
              setViewerStatus(prev => ({ ...prev, terrainType: 'fallback', terrainSource: 'ellipsoid' }));
            }
          }
          
          // Ensure ellipsoid is set (check viewer still exists)
          if (viewer && !viewer.isDestroyed()) {
            viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
          }
        }
      }
    }

    initializeViewer();

    // Cleanup: invalidate session and destroy viewer
    return () => {
      // Invalidate this session to cancel pending async operations
      currentSessionRef.current = -1;
      
      if (cesiumViewerRef.current && !cesiumViewerRef.current.isDestroyed()) {
        try {
          cesiumViewerRef.current.destroy();
        } catch (error) {
          console.warn('Error destroying viewer:', error);
        }
        cesiumViewerRef.current = null;
      }
      
      // Clear data sources ref
      dataSourcesRef.current.clear();
    };
  }, []); // Empty deps - initialize ONCE only

  // Update layers based on enabled state
  useEffect(() => {
    if (!cesiumViewerRef.current) return;

    dataSourcesRef.current.forEach((dataSource, layerId) => {
      dataSource.show = enabledLayers.has(layerId);
    });
  }, [enabledLayers]);

  // Render Tile Plinth (ground polygon matching parcel shape) when enabled
  useEffect(() => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof window === 'undefined') return;

    const Cesium = window.Cesium;
    const isPlinthEnabled = enabledLayers.has('plinth' as LayerType);
    const parcelPositions = parcelPositionsRef.current;

    // Remove existing plinth if disabled or no parcel
    if (!isPlinthEnabled || !parcelPositions || parcelPositions.length === 0) {
      if (plinthEntityRef.current) {
        try {
          viewer.entities.remove(plinthEntityRef.current);
        } catch (e) {
          console.warn('[Plinth] Failed to remove entity:', e);
        }
        plinthEntityRef.current = null;
      }
      return;
    }

    // Create or update plinth using real polygon shape with terrain-aware depth
    if (!plinthEntityRef.current && parcelPositions.length > 0) {
      try {
        // Sample terrain to get minimum height (async operation)
        const cartographics = parcelPositions.map((pos: any) => 
          Cesium.Cartographic.fromCartesian(pos)
        );
        
        // Get terrain provider
        const terrainProvider = viewer.terrainProvider;
        
        // Sample terrain heights at all vertices
        Cesium.sampleTerrainMostDetailed(terrainProvider, cartographics)
          .then((sampledCarts: any[]) => {
            const minHeight = Math.min(...sampledCarts.map((c: any) => c.height ?? 600));
            const cutDepth = minHeight - 15; // 15m below lowest terrain point
            
            // Create plinth using real polygon positions at fixed heights
            const hierarchy = new Cesium.PolygonHierarchy(parcelPositions);
            
            plinthEntityRef.current = viewer.entities.add({
              name: 'Tile Plinth',
              show: false, // OFF by default in Phase 1
              polygon: {
                hierarchy: hierarchy,
                material: new Cesium.ColorMaterialProperty(
                  Cesium.Color.fromCssColorString('#0d0c0a').withAlpha(0.97)
                ),
                extrudedHeight: cutDepth,
                height: minHeight,
                closeTop: false,
                closeBottom: true,
                outline: false,
              },
            });

            viewer.scene.requestRender();
            console.debug(`[Plinth] Created geological cut: minHeight=${minHeight.toFixed(1)}m, cutDepth=${cutDepth.toFixed(1)}m`);
          })
          .catch((error: Error) => {
            console.warn('[Plinth] Failed to sample terrain:', error);
            // Fallback: create plinth without terrain sampling
            const hierarchy = new Cesium.PolygonHierarchy(parcelPositions);
            plinthEntityRef.current = viewer.entities.add({
              name: 'Tile Plinth',
              show: false,
              polygon: {
                hierarchy: hierarchy,
                material: Cesium.Color.fromCssColorString('#0d0c0a').withAlpha(0.97),
                extrudedHeight: -15,
                height: 0,
                closeTop: false,
                closeBottom: true,
                outline: false,
              },
            });
          });
      } catch (error) {
        console.warn('[Plinth] Failed to create entity:', error);
      }
    }
  }, [enabledLayers, parcelPositionsRef.current]);

  // Update terrain based on toggle and source selection (WITH TIMEOUT)
  useEffect(() => {
    if (!cesiumViewerRef.current || typeof window === 'undefined') return;

    const viewer = cesiumViewerRef.current;
    const Cesium = window.Cesium;
    const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;

    async function updateTerrain() {
      // Guard: check viewer is still valid
      if (!viewer || viewer.isDestroyed()) {
        logMessage('Cannot update terrain: viewer destroyed', 'warn');
        return;
      }

      if (terrainEnabled) {
        if (terrainSource === 'mdt02') {
          // Load MDT02 terrain from Cesium Ion
          setViewerStatus(prev => ({ ...prev, terrainType: 'loading' }));
          logMessage('Enabling MDT02 terrain (Ion Asset 4475569)...', 'info');
          
          try {
            const mdt02AssetId = parseInt(process.env.NEXT_PUBLIC_MDT02_ASSET_ID || '4475569');
            
            const terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(mdt02AssetId, {
              requestVertexNormals: true,
              requestWaterMask: false,
            });
            
            // Check viewer still exists after async operation
            if (!viewer || viewer.isDestroyed()) {
              logMessage('Viewer destroyed during MDT02 terrain toggle', 'warn');
              return;
            }
            
            viewer.terrainProvider = terrainProvider;
            attachTerrainErrorHandler(terrainProvider, 'mdt02');
            viewer.scene.globe.enableLighting = true;
            viewer.scene.globe.depthTestAgainstTerrain = false;
            viewer.terrainShadows = Cesium.ShadowMode.ENABLED;
            
            setViewerStatus(prev => ({
              ...prev,
              terrainType: 'success',
              terrainSource: 'mdt02',
              terrainMessage: 'CNIG MDT02 Ion Terrain'
            }));
            logMessage('✓ MDT02 Ion Terrain enabled', 'success');
            
          } catch (error) {
            // Check viewer still exists
            if (!viewer || viewer.isDestroyed()) return;

            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            if (isOfflineError(errorMsg)) {
              if (shouldLog('terrain-mdt02-toggle-offline')) {
                logMessage('MDT02 terrain offline - using fallback', 'warn');
              }
              handleConnectivityIssue('terrain', errorMsg);
            } else {
              console.warn(`⚠️ MDT02 Ion terrain failed. Falling back to Cesium World Terrain. ${errorMsg}`);
              logMessage(`MDT02 Ion terrain failed, falling back to World Terrain`, 'warn');
            }
            
            // Fall back to World Terrain if available
            if (ionToken) {
              try {
                const terrainProvider = await withTimeout(
                  Cesium.createWorldTerrainAsync({
                    requestWaterMask: true,
                    requestVertexNormals: true,
                  }),
                  TIMEOUTS.TERRAIN,
                  'Terrain Fallback'
                );
                
                if (!viewer || viewer.isDestroyed()) return;
                
                viewer.terrainProvider = terrainProvider;
                attachTerrainErrorHandler(terrainProvider, 'world');
                viewer.scene.globe.enableLighting = true;
                viewer.scene.globe.depthTestAgainstTerrain = false;
                viewer.terrainShadows = Cesium.ShadowMode.ENABLED;
                
                setViewerStatus(prev => ({ 
                  ...prev, 
                  terrainType: 'success',
                  terrainSource: 'world',
                  terrainMessage: 'Cesium World Terrain (fallback from MDT02)'
                }));
                logMessage('✓ Fell back to World Terrain', 'success');
              } catch {
                if (!viewer || viewer.isDestroyed()) return;
                viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
                logMessage('World Terrain also unavailable - using flat terrain', 'warn');
                setViewerStatus(prev => ({ 
                  ...prev, 
                  terrainType: 'fallback',
                  terrainSource: 'ellipsoid',
                  terrainMessage: 'Flat terrain (MDT02 & World Terrain unavailable)'
                }));
              }
            } else {
              // No Ion token, fallback to ellipsoid
              viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
              setViewerStatus(prev => ({ 
                ...prev, 
                terrainType: 'error',
                terrainSource: 'ellipsoid',
                terrainMessage: 'Run: pnpm terrain:build (no Ion token for fallback)'
              }));
            }
          }
          
        } else if (ionToken) {
          // Load Cesium World Terrain
          setViewerStatus(prev => ({ ...prev, terrainType: 'loading' }));
          logMessage('Enabling World terrain...', 'info');
          
          try {
            const terrainProvider = await withTimeout(
              Cesium.createWorldTerrainAsync({
                requestWaterMask: true,
                requestVertexNormals: true,
              }),
              TIMEOUTS.TERRAIN,
              'Terrain Toggle'
            );
            
            // Check viewer still exists after async operation
            if (!viewer || viewer.isDestroyed()) {
              logMessage('Viewer destroyed during terrain toggle', 'warn');
              return;
            }
            
            viewer.terrainProvider = terrainProvider;
            attachTerrainErrorHandler(terrainProvider, 'world');
            viewer.scene.globe.enableLighting = true;
            viewer.scene.globe.depthTestAgainstTerrain = false;
            viewer.terrainShadows = Cesium.ShadowMode.ENABLED;
            
            setViewerStatus(prev => ({ 
              ...prev, 
              terrainType: 'success',
              terrainSource: 'world',
              terrainMessage: 'Cesium World Terrain'
            }));
            logMessage('✓ World Terrain enabled', 'success');
          } catch (error) {
            // Check viewer still exists
            if (!viewer || viewer.isDestroyed()) return;

            const errorMsg = error instanceof Error ? error.message : 'Unknown';
            if (error instanceof TimeoutError) {
              logMessage(`Terrain timeout (${TIMEOUTS.TERRAIN}ms)`, 'warn');
            } else if (isOfflineError(errorMsg)) {
              if (shouldLog('terrain-world-toggle-offline')) {
                logMessage('World terrain offline - using ellipsoid', 'warn');
              }
              handleConnectivityIssue('terrain', errorMsg);
            } else {
              logMessage(`Terrain error: ${errorMsg}`, 'error');
            }
            
            viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
            setViewerStatus(prev => ({ ...prev, terrainType: 'fallback', terrainSource: 'ellipsoid' }));
          }
        } else {
          // No Ion token, fallback to ellipsoid
          viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
          setViewerStatus(prev => ({ ...prev, terrainType: 'success', terrainSource: 'ellipsoid' }));
          logMessage('Terrain enabled (ellipsoid - no Ion token)', 'info');
        }
      } else {
        // Disable terrain
        viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
        viewer.scene.globe.enableLighting = false;
        viewer.terrainShadows = Cesium.ShadowMode.DISABLED;
        setViewerStatus(prev => ({ ...prev, terrainType: 'success', terrainSource: 'ellipsoid' }));
        logMessage('Terrain disabled (ellipsoid)', 'info');
      }
    }

    updateTerrain();
  }, [terrainEnabled, terrainSource]);

  // Load real NDVI imagery layer with TIMEOUT and DEBUG
  useEffect(() => {
    if (!cesiumViewerRef.current || typeof window === 'undefined') return;

    const viewer = cesiumViewerRef.current;
    const Cesium = window.Cesium;

    async function loadRealNDVI() {
      if (!realNDVIEnabled || !recipe) return;

      // Guard: check viewer is still valid
      if (!viewer || viewer.isDestroyed()) {
        logMessage('Cannot load NDVI: viewer destroyed', 'warn');
        return;
      }

      // Check API health first
      if (!viewerStatus.apiStatus.healthy) {
        logMessage('Cannot load NDVI: API is offline', 'error');
        setViewerStatus(prev => ({ 
          ...prev, 
          ndviStatus: { 
            status: 'error', 
            message: 'API offline' 
          }
        }));
        return;
      }

      try {
        setViewerStatus(prev => ({ 
          ...prev, 
          ndviStatus: { status: 'loading' }
        }));

        // Calculate date range (last 30 days)
        const toDate = new Date();
        const fromDate = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        const from = fromDate.toISOString().split('T')[0];
        const to = toDate.toISOString().split('T')[0];

        const bbox = recipe.bbox;
        
        logMessage('Loading NDVI from Sentinel-2...', 'info');
        logMessage(`  Bbox: [${bbox.map((v: number) => v.toFixed(4)).join(', ')}]`, 'info');
        logMessage(`  Dates: ${from} to ${to}`, 'info');

        // Draw yellow bbox outline (loading indicator)
        if (ndviBboxEntityRef.current) {
          viewer.entities.remove(ndviBboxEntityRef.current);
        }
        
        const bboxEntity = viewer.entities.add({
          name: 'NDVI_BBOX_DEBUG',
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(bbox[0], bbox[1], bbox[2], bbox[3]),
            material: Cesium.Color.TRANSPARENT, // ALWAYS transparent to avoid black screen
            outline: false, // Outlines unsupported on terrain with height=0
            height: 0,
          },
        });
        ndviBboxEntityRef.current = bboxEntity;

        // Fetch NDVI with timeout
        const apiBaseUrl = viewerStatus.apiBaseUrl;
        logMessage(`  API: ${apiBaseUrl}/api/ndvi`, 'info');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.NDVI);

        let response;
        try {
          response = await fetch(`${apiBaseUrl}/api/ndvi`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ bbox, from, to }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
        } catch (fetchError) {
          clearTimeout(timeoutId);
          
          if (fetchError instanceof Error && fetchError.name === 'AbortError') {
            throw new TimeoutError(`NDVI request timeout after ${TIMEOUTS.NDVI}ms`, 'NDVI Fetch');
          }
          throw fetchError;
        }

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorJson.message || response.statusText;
          } catch {
            errorMessage = errorText || response.statusText;
          }
          
          throw new Error(`HTTP ${response.status}: ${errorMessage}`);
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const sizeKB = Math.round(blob.size / 1024);

        logMessage(`✓ NDVI image received (${sizeKB} KB)`, 'success');

        // Check viewer still exists after async operations
        if (!viewer || viewer.isDestroyed()) {
          logMessage('Viewer destroyed during NDVI load', 'warn');
          URL.revokeObjectURL(blobUrl); // Clean up blob URL
          return;
        }

        // Create imagery provider
        const imageryProvider = await withTimeout(
          Cesium.SingleTileImageryProvider.fromUrl(blobUrl, {
            rectangle: Cesium.Rectangle.fromDegrees(bbox[0], bbox[1], bbox[2], bbox[3]),
          }),
          5000,
          'NDVI ImageryProvider'
        );

        // Check viewer again before adding to scene
        if (!viewer || viewer.isDestroyed() || !viewer.imageryLayers) {
          logMessage('Viewer destroyed before adding NDVI layer', 'warn');
          URL.revokeObjectURL(blobUrl);
          return;
        }

        // Add imagery layer
        const imageryLayer = viewer.imageryLayers.addImageryProvider(imageryProvider);
        imageryLayer.alpha = 0.6;
        imageryLayer.brightness = 1.0;
        imageryLayer.contrast = 1.2;
        viewer.imageryLayers.raiseToTop(imageryLayer);
        
        ndviLayerRef.current = imageryLayer;

        // Change bbox to red (success)
        if (ndviBboxEntityRef.current) {
          ndviBboxEntityRef.current.rectangle.outlineColor = Cesium.Color.RED;
          ndviBboxEntityRef.current.rectangle.outlineWidth = 2;
        }

        // Hide demo NDVI
        const demoNDVIDataSource = dataSourcesRef.current.get('ndvi_demo' as LayerType);
        if (demoNDVIDataSource) {
          demoNDVIDataSource.show = false;
        }

        setViewerStatus(prev => ({ 
          ...prev, 
          ndviStatus: { 
            status: 'success', 
            message: `${sizeKB} KB`, 
            size: sizeKB 
          }
        }));
        
        logMessage('✓ NDVI layer displayed (red bbox)', 'success');
      } catch (error) {
        let errorMsg = 'Unknown error';
        let isTimeout = false;
        
        if (error instanceof TimeoutError) {
          errorMsg = `Timeout (${error.operation})`;
          isTimeout = true;
        } else if (error instanceof Error) {
          errorMsg = error.message;
        }
        
        logMessage(`NDVI failed: ${errorMsg}`, 'error');
        
        setViewerStatus(prev => ({ 
          ...prev, 
          ndviStatus: { 
            status: isTimeout ? 'fallback' : 'error', 
            message: errorMsg 
          }
        }));

        // Keep yellow bbox on error (shows expected region)
        logMessage('  (Yellow bbox shows expected region)', 'info');
      }
    }

    if (realNDVIEnabled) {
      loadRealNDVI();
    } else {
      // Remove NDVI imagery layer
      if (ndviLayerRef.current && viewer.imageryLayers) {
        viewer.imageryLayers.remove(ndviLayerRef.current);
        ndviLayerRef.current = null;
      }

      // Remove bbox outline
      if (ndviBboxEntityRef.current) {
        viewer.entities.remove(ndviBboxEntityRef.current);
        ndviBboxEntityRef.current = null;
      }

      // Show demo NDVI again
      const demoNDVIDataSource = dataSourcesRef.current.get('ndvi_demo' as LayerType);
      if (demoNDVIDataSource && enabledLayers.has('ndvi_demo' as LayerType)) {
        demoNDVIDataSource.show = true;
      }
      
      setViewerStatus(prev => ({ 
        ...prev, 
        ndviStatus: { status: 'idle' }
      }));
    }
  }, [realNDVIEnabled, recipe, enabledLayers, viewerStatus.apiBaseUrl, viewerStatus.apiStatus.healthy]);

  // Handle parcel layer visibility toggle
  useEffect(() => {
    if (!parcelDataSourceRef.current) return;
    
    const isParcelLayerEnabled = enabledLayers.has('parcel' as LayerType);
    parcelDataSourceRef.current.show = isParcelLayerEnabled;
    
    if (isParcelLayerEnabled) {
      logMessage('Parcel layer shown', 'info');
    } else {
      logMessage('Parcel layer hidden', 'info');
    }
  }, [enabledLayers]);

  // Cleanup click handler when component unmounts
  useEffect(() => {
    const viewer = cesiumViewerRef.current;
    
    return () => {
      // Cleanup click handler
      if (viewer && viewer.clickHandler && !viewer.clickHandler.isDestroyed()) {
        viewer.clickHandler.destroy();
        logMessage('✓ Click handler cleaned up', 'info');
      }
    };
  }, []);

  return <div 
    ref={viewerRef} 
    className={`w-full h-full cesium-viewer ${tileMode ? 'tile-mode' : ''}`}
    style={{ minHeight: '400px', minWidth: '400px', position: 'relative' }}
  />;
}

/**
 * Apply preset configuration to the viewer
 */
function applyPresetConfig(viewer: any, recipe: TwinRecipe, tileMode: boolean, terrainEnabled: boolean) {
  const Cesium = window.Cesium;
  const { presetConfig } = recipe;

  // Safety check: ensure viewer and scene are ready
  if (!viewer || viewer.isDestroyed() || !viewer.scene) {
    console.warn('Cannot apply preset config: viewer not ready');
    return;
  }

  // Terrain exaggeration based on preset (enhanced for terrain visibility)
  let exaggeration = 1.0;
  if (terrainEnabled) {
    switch (recipe.preset) {
      case 'mountain':
        exaggeration = 1.4;
        break;
      case 'dehesa':
        exaggeration = 1.15;
        break;
      case 'mediterranean':
        exaggeration = 1.1;
        break;
      default:
        exaggeration = 1.2;
    }
  }
  viewer.scene.verticalExaggeration = exaggeration;

  // Lighting
  viewer.scene.light.intensity = presetConfig.terrain.lightingIntensity;

  // Atmosphere effects
  viewer.scene.skyAtmosphere.brightnessShift = presetConfig.atmosphere.brightness - 1.0;
  viewer.scene.skyAtmosphere.saturationShift = presetConfig.atmosphere.saturation - 1.0;
  viewer.scene.skyAtmosphere.hueShift = presetConfig.atmosphere.hueShift / 360.0;

  // Haze for mediterranean/dusty atmosphere
  if (presetConfig.atmosphere.hazeIntensity) {
    viewer.scene.fog.density = presetConfig.atmosphere.hazeIntensity * 0.0001;
    viewer.scene.fog.enabled = true;
  }

  // Ground color tint (apply to globe)
  const tint = presetConfig.groundTint;
  // Use a lighter gray during loading to avoid black screen effect
  const baseColor = new Cesium.Color(
    tint.r / 255,
    tint.g / 255,
    tint.b / 255,
    tint.a
  );
  
  // If color is too dark (potential black screen), lighten it
  // Check both luminance AND alpha (low alpha makes dark backgrounds visible)
  const luminance = 0.299 * baseColor.red + 0.587 * baseColor.green + 0.114 * baseColor.blue;
  const effectiveBrightness = luminance * baseColor.alpha; // Low alpha = dark appearance
  
  if (luminance < 0.15 || effectiveBrightness < 0.3) {
    // Too dark, use medium gray to avoid black screen during tile loading
    viewer.scene.globe.baseColor = Cesium.Color.DARKGRAY;
  } else {
    viewer.scene.globe.baseColor = baseColor;
  }

  // Tile mode: darker background for floating tile effect
  if (tileMode && presetConfig.skyboxColor) {
    const skyColor = presetConfig.skyboxColor;
    viewer.scene.backgroundColor = new Cesium.Color(
      skyColor.r / 255,
      skyColor.g / 255,
      skyColor.b / 255,
      skyColor.a
    );
  } else {
    // Normal mode: use a visible gray background (not black)
    viewer.scene.backgroundColor = Cesium.Color.DARKGRAY;
  }
}

/**
 * Fly camera to parcel with deterministic isometric framing
 * 
 * Uses explicit flyTo + lookAt instead of flyToBoundingSphere for predictable framing.
 * This ensures consistent viewing angles regardless of parcel size or orientation.
 * 
 * @param viewer - Cesium viewer instance
 * @param Cesium - Cesium global object
 * @param sphere - BoundingSphere computed from parcel positions
 * @param positions - Array of Cartesian3 positions (parcel vertices)
 * @param logMessage - Logging function
 */
async function flyToIsometric(
  viewer: any, 
  boundingSphere: BoundingSphere, 
  marginFactor: number = 1.45
): Promise<void> {
  const Cesium = window.Cesium;
  if (!viewer || viewer.isDestroyed()) return;
  if (!viewer.scene || !viewer.scene.globe) return;
  if (!boundingSphere || !boundingSphere.center || !Number.isFinite(boundingSphere.radius)) return;

  const radius = boundingSphere.radius;
  
  // OPTIMIZED FOR ULTRA-SMALL PARCELS: Adjust pitch and margin based on radius
  const heading = Cesium.Math.toRadians(315); // 315° = looking from SE toward NW (classic isometric)
  let pitch = Cesium.Math.toRadians(-45);     // -45° = optimal for orthophoto projection detail
  let adjustedMarginFactor = marginFactor;
  
  // For ultra-small parcels, maximize resolution with closer view
  if (radius < 20) {
    pitch = Cesium.Math.toRadians(-45);       // Steeper angle for better orthophoto visibility
    adjustedMarginFactor = 1.2;               // Tighter framing (less margin)
    console.log(`[FlyTo] Ultra-small parcel optimization: pitch=-45°, margin=1.2x`);
  } else if (radius < 50) {
    pitch = Cesium.Math.toRadians(-40);       // Moderate angle
    adjustedMarginFactor = 1.3;
  } else {
    pitch = Cesium.Math.toRadians(-32);       // Standard oblique for terrain relief
    adjustedMarginFactor = marginFactor;
  }
  
  // Sample terrain at parcel center for true ground height
  const centerCarto = Cesium.Cartographic.fromCartesian(boundingSphere.center);

  try {
    // Try to sample terrain for accurate ground height
    const hasRealTerrain = viewer.terrainProvider &&
      !(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);

    let groundHeight = 0;
    let centroidLon = Cesium.Math.toDegrees(centerCarto.longitude);
    let centroidLat = Cesium.Math.toDegrees(centerCarto.latitude);

    if (hasRealTerrain) {
      const [sampledCenter] = await Cesium.sampleTerrainMostDetailed(
        viewer.terrainProvider,
        [centerCarto]
      );
      if (sampledCenter?.height != null) {
        groundHeight = sampledCenter.height;
        centroidLon = Cesium.Math.toDegrees(sampledCenter.longitude);
        centroidLat = Cesium.Math.toDegrees(sampledCenter.latitude);
      }
    }

    const range = computeIdealRange(radius) * adjustedMarginFactor;

    console.log(`📐 FlyTo Optimized: centroid=[${centroidLon.toFixed(6)}, ${centroidLat.toFixed(6)}], groundHeight=${groundHeight.toFixed(1)}m, radius=${radius.toFixed(1)}m, range=${range.toFixed(1)}m, pitch=${Cesium.Math.toDegrees(pitch).toFixed(1)}°`);

    // Use lookAt for reliable positioning (works with or without real terrain)
    const target = Cesium.Cartesian3.fromDegrees(centroidLon, centroidLat, groundHeight);
    viewer.camera.lookAt(
      target,
      new Cesium.HeadingPitchRange(heading, pitch, range)
    );
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  } catch (error) {
    console.warn('[flyToIsometric] Camera positioning failed, using flyToBoundingSphere:', error);
    const range = computeIdealRange(radius) * adjustedMarginFactor;
    viewer.camera.lookAt(
      boundingSphere.center,
      new Cesium.HeadingPitchRange(heading, pitch, range)
    );
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }
}

/**
 * Ensure parcel entities have correct styling and outline
 * Useful when loading KML that might have wrong colors or missing outlines
 * 
 * @param viewer - Cesium viewer instance
 * @param dataSource - DataSource containing parcel entities
 * @param logMessage - Optional logging function
 */
function extractParcelEntities(entities: any[]): { primary: any | null; candidates: any[] } {
  const candidates = entities.filter((entity) =>
    Boolean(entity?.polygon || entity?.polyline || entity?.rectangle)
  );

  const primary =
    candidates.find((entity) => entity?.polygon) ||
    candidates.find((entity) => entity?.polyline) ||
    candidates.find((entity) => entity?.rectangle) ||
    null;

  return { primary, candidates };
}

function getEntityPositions(entity: any, Cesium: any, time: any): any[] {
  if (entity?.polygon?.hierarchy) {
    const hierarchy = entity.polygon.hierarchy.getValue(time);
    if (hierarchy?.positions?.length) return hierarchy.positions;
  }

  if (entity?.polyline?.positions) {
    const positions = entity.polyline.positions.getValue(time);
    if (positions?.length) return positions;
  }

  if (entity?.rectangle?.coordinates) {
    const rect = entity.rectangle.coordinates.getValue(time);
    if (rect) {
      return [
        Cesium.Cartesian3.fromRadians(rect.west, rect.south),
        Cesium.Cartesian3.fromRadians(rect.east, rect.south),
        Cesium.Cartesian3.fromRadians(rect.east, rect.north),
        Cesium.Cartesian3.fromRadians(rect.west, rect.north),
        Cesium.Cartesian3.fromRadians(rect.west, rect.south),
      ];
    }
  }

  if (entity?.position) {
    const position = entity.position.getValue(time);
    return position ? [position] : [];
  }

  return [];
}

function createOutlinePolyline(dataSource: any, Cesium: any, positions: any[]): void {
  // Removed: outline polyline now created in styleParcelEntities with gold color
  // This function kept for compatibility but does nothing
}

function styleParcelEntities(viewer: any, dataSource: any, entities: any[]): void {
  const Cesium = window.Cesium;
  const time = Cesium.JulianDate.now();

  entities.forEach((entity) => {
    if (entity?.polygon) {
      // Terrain decal mode — ultra-transparent overlay (0.2 alpha) lets PNOA orthophoto show through
      entity.polygon.material = Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.2);
      entity.polygon.outline = false; // Outlines unsupported on terrain-clamped polygons
      entity.polygon.classificationType = Cesium.ClassificationType.TERRAIN; // Terrain-only decal for max PNOA clarity
      // Remove height/heightReference to let classification handle it
      entity.polygon.height = undefined;
      entity.polygon.extrudedHeight = undefined;
      entity.polygon.heightReference = undefined;
      entity.polygon.perPositionHeight = false;

      const positions = getEntityPositions(entity, Cesium, time);
      
      // Add gold boundary polyline (clamped to ground)
      if (positions && positions.length > 0) {
        const ring = positions[0].equals(positions[positions.length - 1])
          ? positions
          : [...positions, positions[0]];
        
        dataSource.entities.add({
          name: 'Parcel Boundary Gold',
          polyline: {
            positions: ring,
            width: 5.0,
            material: new Cesium.ColorMaterialProperty(
              Cesium.Color.fromCssColorString('#FFD700')
            ),
            clampToGround: true,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
        });
      }
    }

    if (entity?.polyline) {
      entity.polyline.width = 4; // Slightly thicker for better visibility
      entity.polyline.material = Cesium.Color.YELLOW;
      entity.polyline.clampToGround = true;
      // Ensure polyline is always visible
      entity.polyline.disableDepthTestDistance = Number.POSITIVE_INFINITY;
    }

    if (entity?.rectangle) {
      entity.rectangle.material = Cesium.Color.CYAN.withAlpha(0.55);
      entity.rectangle.outline = false; // Outlines unsupported on terrain-clamped rectangles
      entity.rectangle.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
      entity.rectangle.height = 0;
      
      // Anti z-fighting for rectangles
      if (entity.rectangle.classificationType !== undefined) {
        entity.rectangle.classificationType = Cesium.ClassificationType.BOTH;
      }
      entity.rectangle.disableDepthTestDistance = Number.POSITIVE_INFINITY;

      const positions = getEntityPositions(entity, Cesium, time);
      createOutlinePolyline(dataSource, Cesium, positions);
    }
  });

  viewer.scene.requestRender();
}

function computeEntityBoundingSphere(entityOrEntities: any, Cesium: any): BoundingSphere | null {
  if (!entityOrEntities) return null;

  if (typeof entityOrEntities.computeBoundingSphere === 'function') {
    try {
      const result = new Cesium.BoundingSphere();
      const state = entityOrEntities.computeBoundingSphere(Cesium.JulianDate.now(), result);
      if (state === Cesium.BoundingSphereState.DONE) {
        return result as BoundingSphere;
      }
    } catch (error) {
      console.warn('[BoundingSphere] computeBoundingSphere failed:', error);
    }
  }

  const entities = Array.isArray(entityOrEntities) ? entityOrEntities : [entityOrEntities];
  return computeCombinedBoundingSphere(entities, Cesium);
}

function computeCombinedBoundingSphere(entities: any[], Cesium: any): BoundingSphere | null {
  const time = Cesium.JulianDate.now();
  const positions: any[] = [];

  // Filter: only use parcel geometry entities (polygon, polyline, rectangle)
  // Exclude imagery/terrain tiles and other non-parcel entities
  const parcelEntities = entities.filter((entity) => {
    // Include if has parcel geometry
    const hasGeometry = entity?.polygon || entity?.polyline || entity?.rectangle;
    // Exclude if name suggests it's not a parcel (e.g., NDVI, imagery layer names)
    const isParcel = !entity?.name || 
      !entity.name.toLowerCase().includes('ndvi') &&
      !entity.name.toLowerCase().includes('imagery') &&
      !entity.name.toLowerCase().includes('tile');
    return hasGeometry && isParcel;
  });

  parcelEntities.forEach((entity) => {
    positions.push(...getEntityPositions(entity, Cesium, time));
  });

  if (positions.length === 0) {
    console.warn('[BoundingSphere] No valid positions found from entities');
    return null;
  }

  try {
    const sphere = Cesium.BoundingSphere.fromPoints(positions) as BoundingSphere;
    
    // Debug logging
    console.log(`🔍 Bounding Sphere Computed: entityCount=${parcelEntities.length}, positionCount=${positions.length}, radius=${sphere.radius.toFixed(1)}m`);
    
    // Warning if radius suspiciously large for a typical parcel
    if (sphere.radius > 5000 && parcelEntities.length < 10) {
      console.warn(`⚠️ Bounding sphere too large (${sphere.radius.toFixed(0)}m) for ${parcelEntities.length} entities. Check entity filtering - may include non-parcel data.`);
    }
    
    return sphere;
  } catch (error) {
    console.warn('[BoundingSphere] fromPoints failed:', error);
    return null;
  }
}

function detectInvalidWGS84(entities: any[], Cesium: any): boolean {
  const time = Cesium.JulianDate.now();

  for (const entity of entities) {
    const positions = getEntityPositions(entity, Cesium, time);
    for (const position of positions) {
      const cartographic = Cesium.Cartographic.fromCartesian(position);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Generate demo IoT sensor positions inside parcel
 */
function generateDemoSensors(center: [number, number], radiusM: number) {
  const sensors = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const r = radiusM * (0.3 + Math.random() * 0.5);
    const deltaLon = (r * Math.sin(angle)) / (111320 * Math.cos((center[1] * Math.PI) / 180));
    const deltaLat = (r * Math.cos(angle)) / 111320;
    sensors.push({
      lon: center[0] + deltaLon,
      lat: center[1] + deltaLat,
      type: ['TEMP', 'NH3', 'CO2', 'MOISTURE'][i % 4],
      value: (Math.random() * 100).toFixed(1),
      status: (i === 3 ? 'warning' : 'ok') as 'ok' | 'warning' | 'error',
    });
  }
  return sensors;
}

/**
 * Generate demo cattle positions inside parcel
 */
function generateDemoCattle(center: [number, number], radiusM: number) {
  const cattle = [];
  for (let i = 0; i < 8; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = radiusM * (0.2 + Math.random() * 0.6);
    const deltaLon = (r * Math.sin(angle)) / (111320 * Math.cos((center[1] * Math.PI) / 180));
    const deltaLat = (r * Math.cos(angle)) / 111320;
    cattle.push({
      id: `COW-${String(i + 1).padStart(3, '0')}`,
      lon: center[0] + deltaLon,
      lat: center[1] + deltaLat,
      weight: 450 + Math.floor(Math.random() * 150),
      collarId: `COLLAR-${i + 1}`,
      health: 'good' as const,
    });
  }
  return cattle;
}

/**
 * Create SVG icon for sensor status
 */
function createSensorIcon(status: 'ok' | 'warning' | 'error'): string {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  
  // Circle background
  ctx.fillStyle = status === 'ok' ? '#3bf28c' : status === 'warning' ? '#fbbf24' : '#ef4444';
  ctx.beginPath();
  ctx.arc(16, 16, 14, 0, Math.PI * 2);
  ctx.fill();
  
  // Inner ring
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Center dot
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(16, 16, 4, 0, Math.PI * 2);
  ctx.fill();
  
  return canvas.toDataURL();
}

/**
 * Load geometry and create data sources
 * Now accepts session ID to prevent operations on destroyed viewer
 * Supports both KML (direct load with auto-centering) and GeoJSON (manual parsing)
 */
async function loadGeometry(
  viewer: any, 
  recipe: TwinRecipe, 
  _tileMode: boolean, 
  logMessage: (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void,
  session: number,
  currentSessionRef: React.MutableRefObject<number>,
  setViewerStatus: React.Dispatch<React.SetStateAction<ViewerStatus>>,
  _terrainEnabled: boolean,
  parcelBoundingSphereRef: React.MutableRefObject<any>,
  parcelDataSourceRef: React.MutableRefObject<any>,
  parcelPositionsRef: React.MutableRefObject<any[]>,
  framingMargin: number,
  onParcelInfo?: (info: { centroidLonLat: [number, number]; radius: number; boundingSphere: any }) => void,
  onRecenterReady?: (ready: boolean) => void,
  onExportReady?: (ready: boolean) => void
) {
  const Cesium = window.Cesium;

  // Safety check: ensure viewer is ready
  if (!viewer || viewer.isDestroyed()) {
    logMessage('Cannot load geometry: viewer not ready', 'error');
    return;
  }

  // Check session is still valid
  if (currentSessionRef.current !== session) {
    logMessage('Session invalidated during geometry load', 'warn');
    return;
  }

  // Wait for scene, dataSources, and camera to be defined
  if (!viewer.scene || !viewer.dataSources || !viewer.camera) {
    logMessage('Cannot load geometry: viewer.scene/dataSources/camera not ready', 'error');
    return;
  }

  if (!viewer.scene || !viewer.scene.globe) {
    await waitForSceneAndGlobe(viewer);
  }

  try {
    onRecenterReady?.(false);
    onExportReady?.(false);
    logMessage('Loading parcel geometry...', 'info');

    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    const geometryUrl = recipe.geometryPath
      ? recipe.geometryPath.startsWith('http')
        ? recipe.geometryPath
        : `${apiBaseUrl}${recipe.geometryPath}`
      : '/sample-data/40212A00200007.kml';

    const lowerUrl = geometryUrl.toLowerCase();
    const response = await fetch(geometryUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch geometry: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const isGml = contentType.includes('gml') || lowerUrl.endsWith('.gml');
    const isKml = contentType.includes('xml') || lowerUrl.endsWith('.kml');
    const isJson = contentType.includes('json') || lowerUrl.endsWith('.geojson') || lowerUrl.endsWith('.json');

    let dataSource: any = null;
    let sourceEpsg = 'EPSG:4326';

    // ===== HANDLE GML FILES =====
    if (isGml) {
      const gmlText = await response.text();
      const { buildings, detectedZone, message } = parseGmlBuildings(gmlText);

      if (buildings.length === 0) {
        throw new Error(message);
      }

      // Create GML buildings data source
      const buildingsDataSource = new Cesium.DataSource(message);
      
      buildings.forEach((building, idx) => {
        const positions = building.coordinates.map(([lon, lat]) =>
          Cesium.Cartesian3.fromDegrees(lon, lat)
        );

        if (positions.length >= 3) {
          // Create building entity with extrusion
          buildingsDataSource.entities.add({
            name: building.properties?.['name'] || `Building ${idx + 1}`,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(positions),
              material: Cesium.Color.fromCssColorString('#808080').withAlpha(0.6),
              extrudedHeight: 8, // Default 8m extrusion
              outline: false, // Outlines unsupported with extrudedHeight
              heightReference: Cesium.HeightReference.NONE,
            },
          });
        }
      });

      if (currentSessionRef.current !== session || viewer.isDestroyed()) {
        logMessage('Session invalidated during GML load', 'warn');
        return;
      }

      // Remove old parcel data source if exists
      if (viewer.parcelDataSourceRef?.current) {
        viewer.dataSources.remove(viewer.parcelDataSourceRef.current);
      }

      await viewer.dataSources.add(buildingsDataSource);
      viewer.parcelDataSourceRef.current = buildingsDataSource;
      viewer.scene.requestRender();

      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));

      // Compute bounds from all buildings
      const entities = buildingsDataSource.entities.values;
      let boundingSphere = computeCombinedBoundingSphere(entities, Cesium);

      if (!boundingSphere) {
        boundingSphere = computeEntityBoundingSphere(entities, Cesium);
      }

      if (!boundingSphere) {
        throw new Error('Failed to compute building bounds');
      }

      const cartographic = Cesium.Cartographic.fromCartesian(boundingSphere.center);
      const centroidLonLat: [number, number] = [
        Cesium.Math.toDegrees(cartographic.longitude),
        Cesium.Math.toDegrees(cartographic.latitude),
      ];
      const radius = boundingSphere.radius;

      // Update state BEFORE setting ref
      setViewerStatus(prev => ({
        ...prev,
        parcelStatus: {
          loaded: true,
          centroid: centroidLonLat,
          radiusMeters: radius,
          wasReprojected: detectedZone !== undefined,
          sourceEPSG: detectedZone ? `EPSG:258${detectedZone}` : 'EPSG:4326',
        },
      }));

      parcelBoundingSphereRef.current = boundingSphere;
      onRecenterReady?.(true);

      // Extract and store positions from first building for plinth
      if (entities.length > 0 && entities[0]?.polygon?.hierarchy) {
        const time = Cesium.JulianDate.now();
        parcelPositionsRef.current = getEntityPositions(entities[0], Cesium, time);
      }

      onParcelInfo?.({ centroidLonLat, radius, boundingSphere });

      await flyToIsometric(viewer, boundingSphere, framingMargin);
      logMessage(message + ` - Centrado y volando a vista isométrica`, 'success');
      return;
    }

    // ===== HANDLE KML FILES =====
    if (isKml) {
      let kmlText = await response.text();

      // Check if KML is in UTM and auto-reproject
      const reprojectionResult = reprojectKmlString(kmlText);

      if (reprojectionResult.zone) {
        logMessage(`🔄 ${reprojectionResult.message}`, 'info');
        kmlText = reprojectionResult.kml;
        sourceEpsg = `EPSG:258${reprojectionResult.zone}`;
      }

      // Load KML via Cesium
      const arrayBuffer = new TextEncoder().encode(kmlText).buffer;
      const kmlBlob = new Blob([arrayBuffer], { type: 'application/vnd.google-earth.kml+xml' });
      const kmlUrl = URL.createObjectURL(kmlBlob);
      dataSource = await Cesium.KmlDataSource.load(kmlUrl, { clampToGround: true });
      URL.revokeObjectURL(kmlUrl);
    }
    // ===== HANDLE GEOJSON FILES =====
    else if (isJson) {
      const geojson = await response.json();
      dataSource = await Cesium.GeoJsonDataSource.load(geojson, { clampToGround: true });
    } else {
      throw new Error('Unsupported geometry format. Expected KML, GML, or GeoJSON.');
    }

    if (currentSessionRef.current !== session || viewer.isDestroyed()) {
      logMessage('Session invalidated during geometry load', 'warn');
      return;
    }

    // Pre-style entities BEFORE adding to viewer to prevent
    // "Entity geometry outlines are unsupported on terrain" warning
    dataSource.entities.values.forEach((entity: any) => {
      if (entity?.polygon) {
        entity.polygon.outline = false;
      }
    });

    if (viewer.parcelDataSourceRef?.current) {
      viewer.dataSources.remove(viewer.parcelDataSourceRef.current);
    }

    await viewer.dataSources.add(dataSource);
    viewer.parcelDataSourceRef.current = dataSource;
    viewer.scene.requestRender();

    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));

    const { primary, candidates } = extractParcelEntities(dataSource.entities.values);
    if (!primary || candidates.length === 0) {
      const message = 'No parcel geometry found in file';
      logMessage(message, 'error');
      setViewerStatus(prev => ({
        ...prev,
        parcelStatus: {
          loaded: false,
          error: message,
        },
      }));
      return;
    }

    // Only check for WGS84 validity if NOT reprojected
    if (sourceEpsg === 'EPSG:4326' && detectInvalidWGS84(candidates, Cesium)) {
      const message = 'Archivo en UTM, intentando auto-reproyectar...';
      logMessage(message, 'warn');
      // Should not reach here as KML is already reprojected above
    }

    styleParcelEntities(viewer, dataSource, candidates);
    
    // Extract and store parcel positions for plinth creation
    const time = Cesium.JulianDate.now();
    const parcelPositions = getEntityPositions(primary, Cesium, time);
    parcelPositionsRef.current = parcelPositions;
    
    viewer.scene.requestRender();
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));

    let boundingSphere = computeCombinedBoundingSphere(candidates, Cesium);
    if (!boundingSphere) {
      boundingSphere = computeEntityBoundingSphere(dataSource.entities.values, Cesium);
    }

    if (!boundingSphere) {
      const message = 'Failed to compute parcel bounds';
      logMessage(message, 'error');
      setViewerStatus(prev => ({
        ...prev,
        parcelStatus: {
          loaded: false,
          error: message,
        },
      }));
      return;
    }

    const cartographic = Cesium.Cartographic.fromCartesian(boundingSphere.center);
    const centroidLonLat: [number, number] = [
      Cesium.Math.toDegrees(cartographic.longitude),
      Cesium.Math.toDegrees(cartographic.latitude),
    ];
    const radius = boundingSphere.radius;

    // Update state BEFORE setting ref
    setViewerStatus(prev => ({
      ...prev,
      parcelStatus: {
        loaded: true,
        centroid: centroidLonLat,
        radiusMeters: radius,
        wasReprojected: sourceEpsg !== 'EPSG:4326',
        sourceEPSG: sourceEpsg,
      },
    }));

    parcelBoundingSphereRef.current = boundingSphere;
    onRecenterReady?.(true);
    onExportReady?.(true);

    onParcelInfo?.({ centroidLonLat, radius, boundingSphere });

    // === ADD IOT SENSORS LAYER ===
    const sensors = generateDemoSensors(centroidLonLat, radius);
    for (const sensor of sensors) {
      viewer.entities.add({
        name: `IoT Node ${sensors.indexOf(sensor) + 1}`,
        show: false, // PHASE 1: Hidden (not deleted) for Phase 2 toggle
        position: Cesium.Cartesian3.fromDegrees(sensor.lon, sensor.lat, 1.5),
        billboard: {
          image: createSensorIcon(sensor.status),
          width: 32,
          height: 32,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        label: {
          text: `${sensor.type}\\n${sensor.value}`,
          font: '11px monospace',
          fillColor: Cesium.Color.fromCssColorString('#3bf28c'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -40),
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          show: false, // Hidden by default, show on hover
        },
      });
    }

    // === ADD CATTLE GPS MARKERS LAYER ===
    const cattle = generateDemoCattle(centroidLonLat, radius);
    for (let i = 0; i < cattle.length; i++) {
      const animal = cattle[i];
      const entity = viewer.entities.add({
        name: `Cow ${i + 1}`,
        show: false, // PHASE 1: Hidden (not deleted) for Phase 2 toggle
        position: Cesium.Cartesian3.fromDegrees(animal.lon, animal.lat, 0),
        billboard: {
          image: '🐄',
          width: 28,
          height: 28,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `${animal.id}\\n${animal.weight}kg`,
          font: '10px monospace',
          fillColor: Cesium.Color.WHITE,
          pixelOffset: new Cesium.Cartesian2(0, -35),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          show: false, // Hidden by default, show on hover
        },
      });
      
      // Animate slow drift (simulates grazing movement)
      const initialLon = animal.lon;
      const initialLat = animal.lat;
      let t = Math.random() * Math.PI * 2;
      viewer.scene.preUpdate.addEventListener(() => {
        t += 0.0002;
        const dlon = Math.sin(t + i) * 0.0008;
        const dlat = Math.cos(t * 0.7 + i) * 0.0006;
        entity.position = Cesium.Cartesian3.fromDegrees(initialLon + dlon, initialLat + dlat, 0);
      });
    }

    logMessage(`✓ Added ${sensors.length} IoT sensors and ${cattle.length} cattle markers`, 'success');

    // ── HIGH-RES ORTHO OVERLAY FROM ENGINE CACHE (HYBRID SSD) ──
    // Load the pre-downloaded ortho PNG from the engine pipeline (zero WMS requests).
    // Check status first to avoid 404 errors in console.
    if (radius < 100 && viewer.imageryLayers) {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
      const twinId = recipe.twinId;
      
      try {
        // Check if tiles exist (this endpoint never 404s)
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
              orthoLayer.brightness = 1.0;
              orthoLayer.contrast = 1.0;
              orthoLayer.gamma = 1.0;
              orthoLayer.saturation = 1.0;
              orthoLayer.alpha = 1.0;
              
              logMessage(
                `✓ Ortho overlay loaded from cache (${meta.ortho.width}×${meta.ortho.height}px)`,
                'success'
              );
            }
          }
        } else {
          logMessage('Tiles not yet generated — base WMTS active', 'info');
        }
      } catch (orthoError) {
        // Silent — base WMTS remains active
      }
    }

    // ── DYNAMIC FRUSTUM & SHADOW MAP ADJUSTMENT ──
    // Adjust near/far planes based on parcel size to prevent z-fighting and blur
    // Critical for ultra-small parcels where default frustum causes depth precision issues
    try {
      const scene = viewer.scene;
      const camera = viewer.camera;
      
      // Calculate optimal frustum based on parcel radius
      // For ultra-small parcels, use tighter near/far planes
      if (radius < 20) {
        // Ultra-small: very tight frustum (near: radius*0.1, far: radius*50)
        camera.frustum.near = Math.max(0.5, radius * 0.1);
        camera.frustum.far = Math.max(500, radius * 50);
        logMessage(`Frustum adjusted for ultra-small parcel: near=${camera.frustum.near.toFixed(1)}m, far=${camera.frustum.far.toFixed(0)}m`, 'info');
      } else if (radius < 100) {
        // Small-medium: moderate frustum
        camera.frustum.near = Math.max(1, radius * 0.05);
        camera.frustum.far = Math.max(1000, radius * 100);
      } else {
        // Large: standard frustum
        camera.frustum.near = 1;
        camera.frustum.far = 5000000;
      }
      
      // Shadow map optimization if enabled
      if (scene.shadowMap?.enabled) {
        // Adjust shadow map size based on parcel size
        const shadowMapSize = radius < 20 ? 4096 : (radius < 100 ? 2048 : 1024);
        scene.shadowMap.size = shadowMapSize;
        scene.shadowMap.softShadows = true;
        logMessage(`Shadow map optimized: ${shadowMapSize}×${shadowMapSize}`, 'info');
      }
    } catch (frustumError) {
      console.warn('[Frustum] Adjustment failed (non-critical):', frustumError);
    }

    // Wait for scene to finish loading tiles before flying to parcel
    // This prevents black screens and ensures proper initial framing
    logMessage('Waiting for scene tiles to load...', 'info');
    try {
      await waitForSceneReady(viewer, { timeout: 6000, minFrames: 4, stableFrames: 2 });
      logMessage('Scene ready, flying to parcel...', 'success');
    } catch (error) {
      logMessage('Scene wait timeout, proceeding with fly...', 'warn');
    }

    await flyToIsometric(viewer, boundingSphere, framingMargin);
    logMessage(
      `Parcel loaded and centered: [${centroidLonLat[0].toFixed(5)}, ${centroidLonLat[1].toFixed(5)}], radius ${radius.toFixed(0)}m`,
      'success'
    );
  } catch (error) {
    const errorMsg = `Error loading geometry: ${error instanceof Error ? error.message : 'Unknown error'}`;
    logMessage(`❌ ${errorMsg}`, 'error');
    console.error('[loadGeometry] Critical error:', error);
    onRecenterReady?.(false);
    onExportReady?.(false);

    setViewerStatus(prev => ({
      ...prev,
      parcelStatus: {
        loaded: false,
        centroid: [0, 0],
        radiusMeters: 0,
        wasReprojected: false,
        error: errorMsg,
      },
    }));
  }
}

function waitForSceneAndGlobe(viewer: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!viewer || viewer.isDestroyed()) {
        reject(new Error('Viewer destroyed while waiting for scene'));
        return;
      }

      if (viewer.scene && viewer.scene.globe) {
        resolve();
        return;
      }

      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  });
}


/**
 * Compute bounding sphere from a Cesium DataSource
 * Collects all entity positions and creates a BoundingSphere
 */
