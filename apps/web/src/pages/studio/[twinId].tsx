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

const DEFAULT_VISUAL_STYLE: VisualStyle = {
  preset: 'default',
  fillColor: '#00d4ff',
  fillOpacity: 0.09,
  boundaryColor: '#f0c040',
  boundaryWidth: 2.0,
  terrainExaggeration: 2.5,
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

  // When tile processing completes, load tileset into viewer
  const handleTileProcessingComplete = useCallback(() => {
    if (!viewerRef || viewerRef.isDestroyed?.()) return;
    const Cesium = (window as any).Cesium;
    if (!Cesium) return;
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    const url = `${apiBase}/api/tiles/${encodeURIComponent(twinId as string)}/tileset.json`;
    Cesium.Cesium3DTileset.fromUrl(url, { maximumScreenSpaceError: 8, maximumMemoryUsage: 256 })
      .then((tileset: any) => viewerRef.scene.primitives.add(tileset))
      .catch((err: any) => console.warn('[Studio] Failed to load tileset after processing:', err));
  }, [viewerRef, twinId]);

  useEffect(() => {
    if (tileProcessing.status === 'completed') handleTileProcessingComplete();
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
              area_ha: recipe.parcel?.area_ha || 0,
              centroid: recipe.parcel?.centroid || [0, 0],
            },
            layers: {},
            camera: recipe.camera || { headingDeg: 0, pitchDeg: -45, range_m: 3000, centerLon: 0, centerLat: 0 },
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
      terrainExaggeration: Math.max(loadedStyle.terrainExaggeration ?? 2.5, 2.0),
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
        onGenerateMesh={tileProcessing.startProcessing}
        meshStatus={tileProcessing.status}
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
          
          {/* Mesh generator overlay — tripo3d-style visual effect */}
          {activeMode === 'terrain' && (
            <MeshGeneratorOverlay
              tileProcessing={tileProcessing}
              viewerRef={viewerRef}
              parcelBounds={snapshot.parcel?.geojson ? computeParcelBounds(snapshot.parcel.geojson) : undefined}
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

      {/* Status bar: FPS, coords, altitud */}
      <StatusBar viewerRef={viewerRef} version={snapshot.version} />
    </div>
  );
}
