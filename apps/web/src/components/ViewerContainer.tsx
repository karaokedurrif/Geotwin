'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import LayerControls from './LayerControls';
import type { TwinRecipe, LayerType } from '@geotwin/types';

// Import CesiumViewer client-side only (no SSR)
const CesiumViewer = dynamic(() => import('./CesiumViewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-climate-dark">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-climate-accent mx-auto mb-4"></div>
        <p className="text-gray-400">Loading 3D Viewer...</p>
      </div>
    </div>
  ),
});

interface ViewerContainerProps {
  recipe: TwinRecipe;
  autoplay?: boolean;
  tileMode?: boolean;
}

// Autoplay sequence configuration (90 seconds)
const AUTOPLAY_SEQUENCE = [
  { step: 1, time: 0, layers: ['parcel'], message: 'Loading parcel boundary...' },
  { step: 2, time: 10000, layers: ['parcel', 'extrusion'], message: 'Extruding terrain...' },
  { step: 3, time: 25000, layers: ['parcel', 'extrusion', 'ndvi_demo'], message: 'Analyzing vegetation health...' },
  { step: 4, time: 40000, layers: ['parcel', 'extrusion', 'ndvi_demo', 'water_demo'], message: 'Mapping water sources...' },
  { step: 5, time: 55000, layers: ['parcel', 'extrusion', 'ndvi_demo', 'water_demo', 'roi_demo', 'oak_trees', 'plinth'], message: 'Simulation ready.' },
];

export default function ViewerContainer({ recipe, autoplay = false, tileMode = false }: ViewerContainerProps) {
  const [enabledLayers, setEnabledLayers] = useState<Set<LayerType>>(
    autoplay ? new Set<LayerType>() : new Set(['parcel' as LayerType]) // ONLY parcel active by default
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const sequenceIndexRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cesiumViewerRef = useRef<any>(null);

  // Snapshot export
  const handleSnapshotExport = () => {
    if (!cesiumViewerRef.current || !window.Cesium) return;

    try {
      const canvas = cesiumViewerRef.current.scene.canvas;
      const dataUrl = canvas.toDataURL('image/png');
      
      // Download snapshot
      const link = document.createElement('a');
      link.download = `geotwin-${recipe.twinId}-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();

      setToastMessage('Snapshot exported!');
      setTimeout(() => setToastMessage(null), 2000);
    } catch (err) {
      console.error('Snapshot export error:', err);
      setToastMessage('Snapshot export failed');
      setTimeout(() => setToastMessage(null), 2000);
    }
  };

  // Autoplay orchestration
  useEffect(() => {
    if (!autoplay) return;

    const runSequence = () => {
      if (sequenceIndexRef.current >= AUTOPLAY_SEQUENCE.length) {
        return; // Sequence complete
      }

      const currentStep = AUTOPLAY_SEQUENCE[sequenceIndexRef.current];
      
      // Update layers
      setEnabledLayers(new Set(currentStep.layers as LayerType[]));
      
      // Show toast message
      setToastMessage(currentStep.message);
      setTimeout(() => setToastMessage(null), 3000);

      // Schedule next step
      sequenceIndexRef.current++;
      if (sequenceIndexRef.current < AUTOPLAY_SEQUENCE.length) {
        const nextStep = AUTOPLAY_SEQUENCE[sequenceIndexRef.current];
        const delay = nextStep.time - currentStep.time;
        timeoutRef.current = setTimeout(runSequence, delay);
      }
    };

    // Start sequence
    runSequence();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [autoplay]);

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

  return (
    <div className="h-full relative">
      {/* Cesium Viewer */}
      <CesiumViewer 
        recipe={recipe} 
        enabledLayers={enabledLayers} 
        tileMode={tileMode}
        onViewerReady={(viewer) => {
          cesiumViewerRef.current = viewer;
        }}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-30 bg-climate-accent/95 backdrop-blur border border-climate-accent-bright rounded-lg px-6 py-3 shadow-lg animate-fade-in">
          <p className="text-sm font-medium text-white">{toastMessage}</p>
        </div>
      )}

      {/* Snapshot Export Button */}
      <div className="absolute top-4 left-4 z-20">
        <button
          onClick={handleSnapshotExport}
          className="px-4 py-2 bg-climate-dark/90 hover:bg-climate-dark border border-gray-700 hover:border-climate-accent rounded-lg transition-all flex items-center gap-2 group"
          title="Export snapshot as PNG"
        >
          <span className="text-xl">📸</span>
          <span className="text-sm font-medium group-hover:text-climate-accent-bright">Export Snapshot</span>
        </button>
      </div>

      {/* Layer Controls Overlay (hide in autoplay mode) */}
      {!autoplay && (
        <div className="absolute top-4 right-4 z-20">
          <LayerControls
            recipe={recipe}
            enabledLayers={enabledLayers}
            onToggleLayer={toggleLayer}
          />
        </div>
      )}

      {/* Info Panel */}
      <div className="absolute bottom-4 left-4 z-20 bg-climate-dark/90 backdrop-blur border border-gray-700 rounded-lg p-4 max-w-sm">
        <h3 className="font-bold text-lg mb-2">{recipe.presetConfig.displayName} Twin</h3>
        <div className="text-sm space-y-1 text-gray-300">
          <div>
            <span className="text-gray-500">Area:</span> {recipe.area_ha.toFixed(2)} ha
          </div>
          <div>
            <span className="text-gray-500">Centroid:</span> {recipe.centroid[1].toFixed(5)}°,{' '}
            {recipe.centroid[0].toFixed(5)}°
          </div>
          <div>
            <span className="text-gray-500">Twin ID:</span>{' '}
            <code className="text-xs bg-gray-800 px-1 py-0.5 rounded">{recipe.twinId}</code>
          </div>
        </div>
      </div>
    </div>
  );
}
