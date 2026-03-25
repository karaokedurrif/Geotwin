import { useState } from 'react';
import ControlPanel from '@/components/ControlPanel';
import CesiumViewer from '@/components/CesiumViewer';
import StatusHUD from '@/components/StatusHUD';
import ParcelBadge from '@/components/ParcelBadge';
import MeshGeneratorOverlay from '@/components/studio/MeshGeneratorOverlay';
import type { TwinRecipe, LayerType } from '@geotwin/types';
import { twinStore, createSnapshotFromRecipe, generateTwinId } from '@/lib/twinStore';
import { useTileProcessing } from '@/hooks/useTileProcessing';

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
  isOffline: boolean;
  parcelStatus?: {
    loaded: boolean;
    centroid?: [number, number];
    radiusMeters?: number;
    wasReprojected?: boolean;
    sourceEPSG?: string;
     error?: string; // Added error field for parcel status
  };
}

export default function Home() {
  const [recipe, setRecipe] = useState<TwinRecipe | null>(null);
  const [enabledLayers, setEnabledLayers] = useState<Set<LayerType>>(new Set());
  const [terrainEnabled, setTerrainEnabled] = useState(true);
  const [terrainSource, setTerrainSource] = useState<'world' | 'mdt02'>('world');
  const [realNDVIEnabled, setRealNDVIEnabled] = useState(false);
  const [pnoaImageryEnabled, setPnoaImageryEnabled] = useState(false);
  const [ndviDate, setNdviDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [viewerLogs, setViewerLogs] = useState<string[]>([]);
  const [viewerStatus, setViewerStatus] = useState<ViewerStatus | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerInstance, setViewerInstance] = useState<any>(null);
  const [recenterReady, setRecenterReady] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [framingMargin, setFramingMargin] = useState(1.15);
  const [terrainExaggeration, setTerrainExaggeration] = useState(1.0);
  const [generatedTwinId, setGeneratedTwinId] = useState<string | null>(null);
  const tileProcessing = useTileProcessing(generatedTwinId ?? recipe?.twinId);

  const handleRecipeLoaded = (loadedRecipe: TwinRecipe) => {
    setRecipe(loadedRecipe);
    setRecenterReady(false);
    setExportReady(false);
    setGeneratedTwinId(null); // Reset twin ID on new load
    // Initialize with all visible layers enabled
    const visibleLayers = loadedRecipe.layers
      .filter((l: any) => l.visible)
      .map((l: any) => l.id);
    setEnabledLayers(new Set(visibleLayers));
  };

  const toggleLayer = (layerId: LayerType) => {
    setEnabledLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  };

  const toggleTerrain = () => {
    setTerrainEnabled((prev) => !prev);
  };

  const handleTerrainSourceChange = (source: 'world' | 'mdt02') => {
    setTerrainSource(source);
  };

  const toggleRealNDVI = () => {
    setRealNDVIEnabled((prev) => !prev);
  };

  const togglePNOAImagery = () => {
    setPnoaImageryEnabled((prev) => !prev);
  };

  const handleNDVIDateChange = (date: string) => {
    setNdviDate(date);
    // If NDVI is enabled, this will trigger a reload
  };

  const handleRecenterCamera = () => {
    if (viewerInstance && viewerInstance.recenterCamera) {
      viewerInstance.recenterCamera();
    }
  };

  const handleIsometricView = () => {
    if (viewerInstance && viewerInstance.isometricView) {
      viewerInstance.isometricView();
    }
  };

  const handleExportParcel = () => {
    console.log('[Export] Attempting export...', {
      hasViewer: !!viewerInstance,
      hasSaveMethod: !!viewerInstance?.saveTwinSnapshot,
      hasRecipe: !!recipe,
      exportEnabled: exportReady
    });
    
    if (viewerInstance && viewerInstance.saveTwinSnapshot && recipe) {
      try {
        const sourceFileName = recipe?.geometryPath?.split('/').pop();
        const twinId = viewerInstance.saveTwinSnapshot(sourceFileName, twinStore, recipe);
        console.log('[Export] Twin ID generated:', twinId);
        if (twinId) {
          setGeneratedTwinId(twinId);
          console.log('[Export] ✓ Export successful, twinId:', twinId);
        } else {
          console.error('[Export] ✗ No twinId returned from saveTwinSnapshot');
        }
      } catch (error) {
        console.error('[Export] ✗ Error during export:', error);
      }
    } else {
      console.warn('[Export] ✗ Missing required components for export');
    }
  };

  const handleLogMessage = (message: string) => {
    setViewerLogs((prev) => [...prev.slice(-9), message]); // Keep last 10 messages
  };

  const handleStatusUpdate = (status: ViewerStatus) => {
    setViewerStatus(status);
  };

  const handleViewerReady = (viewer: any) => {
    setViewerReady(true);
    setViewerInstance(viewer);
    
    // Expose recenter function globally for testing
    if (typeof window !== 'undefined') {
      (window as any).recenterCamera = () => {
        if (viewer && viewer.recenterCamera) {
          viewer.recenterCamera();
        }
      };
    }
  };

  return (
    <main className="h-screen w-screen overflow-hidden flex flex-col" style={{ background: '#1a1a1e', fontFamily: "'DM Sans', 'Inter', system-ui, sans-serif" }}>
      {/* TopBar — compact 36px, estilo Blender */}
      <header className="flex items-center justify-between z-20 px-3 flex-shrink-0" style={{ height: '36px', background: '#222226', borderBottom: '1px solid #2e2e34' }}>
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center rounded" style={{ width: '22px', height: '22px', background: '#10B981' }}>
            <span style={{ fontSize: '13px', lineHeight: 1 }}>⬢</span>
          </div>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#E8E8EC', letterSpacing: '-0.01em' }}>GeoTwin</span>
          <span style={{ fontSize: '11px', color: '#6B6B73', fontWeight: 500 }}>Engine</span>
        </div>
        
        {recipe && (
          <div className="flex items-center gap-3">
            <span style={{ fontSize: '11px', color: '#6B6B73' }}>Twin</span>
            <span style={{ fontSize: '11px', color: '#10B981', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{recipe.twinId.slice(0, 10)}</span>
          </div>
        )}
      </header>

      {/* Main Layout: Sidebar + Viewer */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <ControlPanel
          onRecipeLoaded={handleRecipeLoaded}
          recipe={recipe}
          enabledLayers={enabledLayers}
          onToggleLayer={toggleLayer}
          terrainEnabled={terrainEnabled}
          onToggleTerrain={toggleTerrain}
          terrainSource={terrainSource}
          onTerrainSourceChange={handleTerrainSourceChange}
          realNDVIEnabled={realNDVIEnabled}
          onToggleRealNDVI={toggleRealNDVI}
          pnoaImageryEnabled={pnoaImageryEnabled}
          onTogglePNOAImagery={togglePNOAImagery}
          ndviDate={ndviDate}
          onNDVIDateChange={handleNDVIDateChange}
          onRecenterCamera={handleRecenterCamera}
          onIsometricView={handleIsometricView}
          onExportParcel={handleExportParcel}
          recenterEnabled={recenterReady}
          exportEnabled={exportReady}
          generatedTwinId={generatedTwinId}
          framingMargin={framingMargin}
          onFramingMarginChange={setFramingMargin}
          terrainExaggeration={terrainExaggeration}
          onExaggerationChange={setTerrainExaggeration}
          viewerLogs={viewerLogs}
          terrainStatus={viewerStatus ? { status: viewerStatus.terrainType, message: viewerStatus.terrainMessage } : undefined}
          imageryStatus={viewerStatus ? { status: viewerStatus.imageryType, message: viewerStatus.imageryMessage } : undefined}
          ndviStatus={viewerStatus ? viewerStatus.ndviStatus : undefined}
          parcelStatus={viewerStatus?.parcelStatus}
          viewerStatus={viewerStatus ? { isOffline: viewerStatus.isOffline } : undefined}
        />

        {/* Right Viewer */}
        <div className="flex-1 relative" style={{ background: '#1a1a1e' }}>
          {recipe ? (
            <>
              <CesiumViewer 
                recipe={recipe} 
                enabledLayers={enabledLayers} 
                tileMode={false}
                terrainEnabled={terrainEnabled}
                terrainSource={terrainSource}
                realNDVIEnabled={realNDVIEnabled}
                framingMargin={framingMargin}
                terrainExaggeration={terrainExaggeration}
                onViewerReady={handleViewerReady}
                onLogMessage={handleLogMessage}
                onStatusUpdate={handleStatusUpdate}
                onParcelInfo={() => undefined}
                onRecenterReady={setRecenterReady}
                onExportReady={setExportReady}
              />
              
              <StatusHUD
                terrainStatus={viewerStatus ? { status: viewerStatus.terrainType, message: viewerStatus.terrainMessage } : undefined}
                imageryStatus={viewerStatus ? { status: viewerStatus.imageryType, message: viewerStatus.imageryMessage } : undefined}
                ndviStatus={viewerStatus?.ndviStatus}
                isOffline={viewerStatus?.isOffline}
              />
              
              <ParcelBadge
                twinId={recipe.twinId}
                centroid={recipe.centroid}
                radiusMeters={viewerStatus?.parcelStatus?.radiusMeters}
                wasReprojected={viewerStatus?.parcelStatus?.wasReprojected}
                sourceEPSG={viewerStatus?.parcelStatus?.sourceEPSG}
              />

              {/* Mesh generator overlay — tripo3d-style */}
              <MeshGeneratorOverlay tileProcessing={tileProcessing} />
            </>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center space-y-3">
                <div style={{ fontSize: '48px', opacity: 0.3 }}>⬢</div>
                <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#6B6B73' }}>No Twin Loaded</h2>
                <p style={{ fontSize: '12px', color: '#45454D' }}>
                  Sube un archivo KML o carga datos de ejemplo
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
