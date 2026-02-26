import { useState } from 'react';
import ControlPanel from '@/components/ControlPanel';
import CesiumViewer from '@/components/CesiumViewer';
import StatusHUD from '@/components/StatusHUD';
import ParcelBadge from '@/components/ParcelBadge';
import type { TwinRecipe, LayerType } from '@geotwin/types';
import { twinStore, createSnapshotFromRecipe, generateTwinId } from '@/lib/twinStore';

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
  const [framingMargin, setFramingMargin] = useState(1.45);
  const [terrainExaggeration, setTerrainExaggeration] = useState(1.0);
  const [generatedTwinId, setGeneratedTwinId] = useState<string | null>(null);

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
    <main className="h-screen w-screen overflow-hidden flex flex-col bg-climate-darker">
      {/* Header */}
      <header className="bg-climate-dark border-b border-gray-800 px-6 py-3 flex items-center justify-between z-20">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-climate-accent rounded-lg flex items-center justify-center text-xl">
            🌍
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">GeoTwin Engine</h1>
            <p className="text-xs text-gray-500">Interactive 3D Geospatial Twins</p>
          </div>
        </div>
        
        {recipe && (
          <div className="text-right">
            <div className="text-xs text-gray-500">Twin ID</div>
            <div className="text-sm font-mono text-climate-accent">{recipe.twinId}</div>
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
        <div className="flex-1 relative bg-black">
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
              
              {/* Bento Light HUDs */}
              <StatusHUD
                terrainStatus={viewerStatus ? { status: viewerStatus.terrainType, message: viewerStatus.terrainMessage } : undefined}
                imageryStatus={viewerStatus ? { status: viewerStatus.imageryType, message: viewerStatus.imageryMessage } : undefined}
                ndviStatus={viewerStatus?.ndviStatus}
                isOffline={viewerStatus?.isOffline}
              />
              
              <ParcelBadge
                twinId={recipe.twinId}
                centroid={recipe.centroid}
                radiusMeters={recipe.parcel_radius_m}
                wasReprojected={viewerStatus?.parcelStatus?.wasReprojected}
                sourceEPSG={viewerStatus?.parcelStatus?.sourceEPSG}
              />
            </>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center space-y-2">
                <div className="text-6xl mb-4">🌍</div>
                <h2 className="text-2xl font-bold text-gray-400">No Twin Loaded</h2>
                <p className="text-sm text-gray-600">
                  Upload a cadastral file or load sample data
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
