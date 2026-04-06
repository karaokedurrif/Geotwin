import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { twinStore } from '@/lib/twinStore';
import type { TwinSnapshot, VisualStyle } from '@/lib/twinStore';
import type { StudioMode } from '@/components/studio/StudioBottomBar';
import StudioTopBar from '@/components/studio/StudioTopBar';
import StudioRightPanel from '@/components/studio/StudioRightPanel';
import StudioBottomBar from '@/components/studio/StudioBottomBar';
import StatusBar from '@/ui/shell/StatusBar';
import { useTileProcessing } from '@/hooks/useTileProcessing';
import { useIoTData } from '@/hooks/useIoTData';
import TimelineBar, { useTimeline } from '@/components/studio/TimelineBar';
import MeshGeneratorOverlay from '@/components/studio/MeshGeneratorOverlay';
import styles from '@/styles/studio.module.css';

// Three.js viewer — client-side only
const ModelViewer3D = dynamic(
  () => import('@/components/studio/ModelViewer3D'),
  { ssr: false }
);

/** Extract lon/lat bounding box from GeoJSON for terrain sampling */
function computeParcelBounds(geojson: any): { west: number; south: number; east: number; north: number } | undefined {
  try {
    const coords: number[][] = [];
    const geometry = geojson?.geometry ?? geojson?.features?.[0]?.geometry;
    if (!geometry) return undefined;
    const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates?.[0];
    if (!rings?.[0]) return undefined;
    for (const c of rings[0]) coords.push(c);
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const [lon, lat] of coords) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    return { west, south, east, north };
  } catch {
    return undefined;
  }
}

/** Extract the outer ring coordinates [lon,lat][] from GeoJSON */
function extractPolygonRing(geojson: any): [number, number][] | undefined {
  try {
    const geometry = geojson?.geometry ?? geojson?.features?.[0]?.geometry;
    if (!geometry) return undefined;
    const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates?.[0];
    if (!rings?.[0]) return undefined;
    return rings[0] as [number, number][];
  } catch {
    return undefined;
  }
}

// Cesium must be loaded client-side only
const StudioViewer = dynamic(
  () => import('@/components/studio/StudioViewer'),
  { ssr: false, loading: () => <div className={styles.viewerLoading}>Cargando visor 3D...</div> }
);

// 🎮 Simulator Mode - also client-side only (uses Cesium APIs)
const SimulatorMode = dynamic(
  () => import('@/components/studio/SimulatorMode'),
  { ssr: false }
);

// Terrain Studio — full-screen Three.js inspector
const TerrainStudio = dynamic(
  () => import('@/components/terrain-studio/TerrainStudio'),
  { ssr: false }
);

const DEFAULT_VISUAL_STYLE: VisualStyle = {
  preset: 'default',
  fillColor: '#00d4ff',
  fillOpacity: 0.2,      // DECAL MODE: Low opacity lets PNOA orthophoto show through
  boundaryColor: '#FFD700',
  boundaryWidth: 4.0,
  terrainExaggeration: 1.0,
  enableLighting: true,
  timeOfDay: new Date(2024, 0, 1, 8, 0, 0).toISOString(),
  atmosphereDensity: 1.0,
};

export default function TwinStudioPage() {
  const router = useRouter();
  const { twinId } = router.query;

  const [snapshot, setSnapshot] = useState<TwinSnapshot | null>(null);
  const [activeMode, setActiveMode] = useState<StudioMode>('terrain');
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(DEFAULT_VISUAL_STYLE);
  const [layerState, setLayerState] = useState<Record<string, boolean>>({});
  const [viewerRef, setViewerRef] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const tileProcessing = useTileProcessing(typeof twinId === 'string' ? twinId : undefined, snapshot?.parcel?.geojson);
  const iot = useIoTData(typeof twinId === 'string' ? twinId : undefined);
  const timeline = useTimeline(7);
  const [selectedSensor, setSelectedSensor] = useState<string | null>(null);
  const [showModelViewer, setShowModelViewer] = useState(false);
  const [showTerrainStudio, setShowTerrainStudio] = useState(false);

  // When tile processing completes, load tileset into viewer and fly back to parcel
  const handleTileProcessingComplete = useCallback(() => {
    if (!viewerRef || viewerRef.isDestroyed?.()) return;
    const Cesium = (window as any).Cesium;
    if (!Cesium || !snapshot) return;
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    const url = `${apiBase}/api/tiles/${encodeURIComponent(twinId as string)}/tileset.json`;
    Cesium.Cesium3DTileset.fromUrl(url, { maximumScreenSpaceError: 1, maximumMemoryUsage: 256 })
      .then((tileset: any) => {
        if (!viewerRef || viewerRef.isDestroyed?.()) return;
        viewerRef.scene.primitives.add(tileset);

        // Handle shader errors gracefully (v_texCoord_0 crash)
        tileset.tileFailed.addEventListener((ev: any) => {
          console.warn('[Studio] Tile failed:', ev.message);
        });

        // Fly camera back to parcel using lookAt (guarantees correct framing)
        const parcel = snapshot.parcel;
        if (parcel?.centroid) {
          const [lon, lat] = parcel.centroid;
          const areaHa = parcel.area_ha ?? 100;
          const radiusM = Math.sqrt(areaHa * 10000 / Math.PI);
          let dist = 400;
          if (areaHa < 0.5) dist = Math.max(radiusM * 5, 80);
          else if (areaHa < 10) dist = Math.max(radiusM * 4, 300);
          else if (areaHa < 100) dist = Math.max(radiusM * 3, 1000);
          else dist = Math.max(radiusM * 2.5, 2000);
          const pitchDeg = areaHa < 0.5 ? -40 : areaHa < 10 ? -35 : areaHa < 100 ? -32 : -30;

          const center = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
          viewerRef.camera.lookAt(
            center,
            new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(225),
              Cesium.Math.toRadians(pitchDeg),
              dist * 1.3,
            )
          );
          viewerRef.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        }

        // Load ortho overlay from engine cache (high-res single tile)
        fetch(`${apiBase}/api/tiles/${encodeURIComponent(twinId as string)}/pipeline_result.json`)
          .then(r => r.ok ? r.json() : null)
          .then(meta => {
            if (!meta?.ortho?.bbox || !meta?.ortho?.texture) return;
            if (!viewerRef || viewerRef.isDestroyed?.()) return;
            const orthoUrl = `${apiBase}/api/tiles/${encodeURIComponent(twinId as string)}/${meta.ortho.texture}`;
            const ob = meta.ortho.bbox;
            return Cesium.SingleTileImageryProvider.fromUrl(orthoUrl, {
              rectangle: Cesium.Rectangle.fromDegrees(ob[0], ob[1], ob[2], ob[3]),
            }).then((provider: any) => {
              if (!viewerRef || viewerRef.isDestroyed?.()) return;
              const layer = viewerRef.imageryLayers.addImageryProvider(provider);
              viewerRef.imageryLayers.raiseToTop(layer);
              layer.alpha = 1.0;
              console.log(`[Studio] ✓ Ortho overlay loaded (${meta.ortho.width}×${meta.ortho.height}px)`);
            });
          })
          .catch(() => console.warn('[Studio] Ortho overlay not available'));
      })
      .catch((err: any) => console.warn('[Studio] Failed to load tileset after processing:', err));
  }, [viewerRef, twinId, snapshot]);

  useEffect(() => {
    if (tileProcessing.status === 'completed' || tileProcessing.status === 'available') handleTileProcessingComplete();
    if (tileProcessing.status === 'completed') setShowModelViewer(true);
  }, [tileProcessing.status, handleTileProcessingComplete]);

  // Persist meshStatus to localStorage when it changes
  useEffect(() => {
    if (!twinId || typeof twinId !== 'string') return;
    const statusMap: Record<string, 'none' | 'processing' | 'completed' | 'failed' | undefined> = {
      idle: 'none',
      checking: undefined,
      queued: 'processing',
      running: 'processing',
      completed: 'completed',
      failed: 'failed',
      available: 'completed',
    };
    const meshStatus = statusMap[tileProcessing.status];
    if (meshStatus) {
      twinStore.updateMeshStatus(twinId, meshStatus);
    }
  }, [tileProcessing.status, twinId]);

  // Load snapshot from localStorage, fallback to API
  useEffect(() => {
    if (!twinId || typeof twinId !== 'string') return;
    
    setLoading(true);
    const snap = twinStore.get(twinId);
    
    if (snap) {
      applySnapshot(snap);
      return;
    }

    // Fallback: load from API (server-side twinId URL)
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    fetch(`${apiBase}/api/twin/${encodeURIComponent(twinId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.recipe) {
          // Build minimal snapshot from recipe
          const recipe = data.recipe;
          const minSnap: TwinSnapshot = {
            version: '1.0',
            twinId,
            timestamp: new Date().toISOString(),
            parcel: {
              sourceFile: recipe.parcel?.file || 'api',
              name: recipe.parcel?.name || twinId,
              geojson: recipe.parcel?.geometry || recipe.geometry || null,
              area_ha: recipe.parcel?.area_ha || recipe.area_ha || 0,
              centroid: recipe.parcel?.centroid || recipe.centroid || [0, 0],
            },
            layers: {},
            camera: recipe.camera || { headingDeg: 315, pitchDeg: -45, range_m: 0, centerLon: 0, centerLat: 0 },
          } as TwinSnapshot;
          applySnapshot(minSnap);
        } else {
          setNotFound(true);
          setLoading(false);
        }
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [twinId]);

  function applySnapshot(snap: TwinSnapshot) {
    setSnapshot(snap);
    setLayerState(snap.layers ?? {});
    
    const loadedStyle = snap.visualStyle ?? DEFAULT_VISUAL_STYLE;
    const mergedStyle: VisualStyle = {
      ...DEFAULT_VISUAL_STYLE,
      ...loadedStyle,
      terrainExaggeration: loadedStyle.terrainExaggeration ?? 1.0,
    };
    setVisualStyle(mergedStyle);
    setLoading(false);

    // Sync twin geometry to server (fire-and-forget) so that engine
    // services like Sentinel-2, illustration, tile processing work.
    if (snap.parcel?.geojson) {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
      fetch(`${apiBase}/api/twin/${encodeURIComponent(snap.twinId)}/sync`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geojson: snap.parcel.geojson,
          area_ha: snap.parcel.area_ha,
          centroid: snap.parcel.centroid,
          name: snap.parcel.name,
        }),
      }).catch(() => {});  // Non-critical, don't block UI
    }
  }

  // Handle dropped JSON files (for sharing)
  const handleDropSnapshot = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith('.json')) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const jsonString = event.target?.result as string;
        const snap = twinStore.importFromJSON(jsonString);
        setSnapshot(snap);
        router.replace(`/studio/${snap.twinId}`, undefined, { shallow: true });
      } catch (error) {
        console.error('[Studio] Invalid snapshot:', error);
        alert('Archivo JSON inválido');
      }
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Not found state
  if (notFound) {
    return (
      <div className={styles.studioShell}>
        <div className={styles.notFound}>
          <h1>Twin no encontrado</h1>
          <p>El Digital Twin con ID <code>{twinId}</code> no existe en localStorage.</p>
          <button
            className={styles.btnPrimary}
            onClick={() => router.push('/')}
          >
            ← Volver a Captura
          </button>
          <div className={styles.dropZone}>
            <p>O arrastra un archivo .json aquí</p>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading || !snapshot) {
    return (
      <div className={styles.studioShell}>
        <div className={styles.skeleton}>
          <div className={styles.skeletonBar} />
          <div className={styles.skeletonBody} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.studioShell}
      onDragOver={handleDragOver}
      onDrop={handleDropSnapshot}
    >
      {/* Top bar: Twin ID, parcel name, actions */}
      <StudioTopBar
        snapshot={snapshot}
        visualStyle={visualStyle}
        viewerRef={viewerRef}
        onExport={() => {
          const json = JSON.stringify(snapshot, null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `geotwin_${snapshot.twinId}_export.json`;
          a.click();
          URL.revokeObjectURL(url);
        }}
        onBackToCapture={() => router.push('/')}
        onGenerateMesh={tileProcessing.tilesAvailable
          ? () => setShowModelViewer(true)
          : tileProcessing.startProcessing
        }
        onOpenTerrainStudio={() => setShowTerrainStudio(true)}
        meshStatus={tileProcessing.status}
        twinId={typeof twinId === 'string' ? twinId : undefined}
      />

      <div className={styles.studioBody}>
        {/* Main 3D viewer — takes all remaining space */}
        <div className={styles.studioViewport}>
          <StudioViewer
            snapshot={snapshot}
            visualStyle={visualStyle}
            layerState={layerState}
            activeMode={activeMode}
            onViewerReady={setViewerRef}
          />

          {/* Floating recenter button */}
          {viewerRef && (
            <button
              onClick={() => viewerRef.recenterCamera?.()}
              title="Recentrar parcela"
              style={{
                position: 'absolute', bottom: 80, right: 16, zIndex: 50,
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)',
                color: '#10B981', cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                backdropFilter: 'blur(4px)', transition: 'all 0.15s',
              }}
              onMouseOver={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.3)'; }}
              onMouseOut={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.15)'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
              </svg>
            </button>
          )}
          
          {/* Mesh generator overlay — tripo3d-style visual effect */}
          {activeMode === 'terrain' && (
            <MeshGeneratorOverlay
              tileProcessing={tileProcessing}
              viewerRef={viewerRef}
              parcelBounds={snapshot.parcel?.geojson ? computeParcelBounds(snapshot.parcel.geojson) : undefined}
              polygonCoords={snapshot.parcel?.geojson ? extractPolygonRing(snapshot.parcel.geojson) : undefined}
            />
          )}
          
          {/* Simulator Mode Overlay - activo solo en modo 'sim' */}
          {activeMode === 'sim' && viewerRef && (
            <SimulatorMode
              viewerRef={viewerRef}
              snapshot={snapshot}
              active={activeMode === 'sim'}
            />
          )}

          {/* 3D Model inspector (Three.js) — shown after mesh completes */}
          {typeof twinId === 'string' && (
            <ModelViewer3D
              twinId={twinId}
              visible={showModelViewer}
              onClose={() => setShowModelViewer(false)}
              onOpenStudio={() => { setShowModelViewer(false); setShowTerrainStudio(true); }}
            />
          )}
        </div>

        {/* Right panel: layer styles for current mode */}
        <StudioRightPanel
          activeMode={activeMode}
          visualStyle={visualStyle}
          layerState={layerState}
          snapshot={snapshot}
          tileProcessing={tileProcessing}
          iot={iot}
          selectedSensor={selectedSensor}
          onSelectSensor={setSelectedSensor}
          onVisualStyleChange={(update: Partial<VisualStyle>) => {
            const next = { ...visualStyle, ...update };
            setVisualStyle(next);
            // Persist immediately
            twinStore.save({ ...snapshot, visualStyle: next });
          }}
          onLayerToggle={(id: string) => {
            const next = { ...layerState, [id]: !layerState[id] };
            setLayerState(next);
            twinStore.save({ ...snapshot, layers: next });
          }}
        />
      </div>

      {/* Bottom bar: selector de capas */}
      <StudioBottomBar
        activeMode={activeMode}
        snapshot={snapshot}
        onModeChange={setActiveMode}
      />

      {/* Timeline bar: visible when in IoT mode */}
      {activeMode === 'iot' && iot.hasData && (
        <TimelineBar
          startTime={timeline.startTime}
          endTime={timeline.endTime}
          currentTime={timeline.currentTime}
          onTimeChange={timeline.setCurrentTime}
          playing={timeline.playing}
          onTogglePlay={timeline.togglePlay}
          speed={timeline.speed}
          onSpeedChange={timeline.setSpeed}
        />
      )}

      {/* Terrain Studio — fullscreen Three.js environment */}
      {showTerrainStudio && typeof twinId === 'string' && (
        <TerrainStudio
          twinId={twinId}
          areaHa={snapshot.parcel?.area_ha}
          geojson={snapshot.parcel?.geojson}
          onClose={() => setShowTerrainStudio(false)}
        />
      )}

      {/* Status bar: FPS, coords, altitud */}
      <StatusBar viewerRef={viewerRef} version={snapshot.version} />
    </div>
  );
}
