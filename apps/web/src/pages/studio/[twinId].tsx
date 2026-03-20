import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { twinStore } from '@/lib/twinStore';
import type { TwinSnapshot, VisualStyle } from '@/lib/twinStore';
import type { StudioMode } from '@/components/studio/StudioBottomBar';
import StudioTopBar from '@/components/studio/StudioTopBar';
import StudioRightPanel from '@/components/studio/StudioRightPanel';
import StudioBottomBar from '@/components/studio/StudioBottomBar';
import StatusBar from '@/ui/shell/StatusBar';
import styles from '@/styles/studio.module.css';

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

  // Load snapshot from localStorage
  useEffect(() => {
    if (!twinId || typeof twinId !== 'string') return;
    
    setLoading(true);
    const snap = twinStore.get(twinId);
    
    if (!snap) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    
    setSnapshot(snap);
    setLayerState(snap.layers ?? {});
    
    // Merge snapshot visualStyle with defaults, ensuring minimum terrain exaggeration
    const loadedStyle = snap.visualStyle ?? DEFAULT_VISUAL_STYLE;
    const mergedStyle: VisualStyle = {
      ...DEFAULT_VISUAL_STYLE,
      ...loadedStyle,
      // Ensure terrain exaggeration is at least 2.0 for visible relief
      terrainExaggeration: Math.max(loadedStyle.terrainExaggeration ?? 2.5, 2.0),
    };
    setVisualStyle(mergedStyle);
    console.log('[Studio] Loaded visual style with terrain exaggeration:', mergedStyle.terrainExaggeration);
    
    setLoading(false);
  }, [twinId]);

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

      {/* Status bar: FPS, coords, altitud */}
      <StatusBar viewerRef={viewerRef} version={snapshot.version} />
    </div>
  );
}
