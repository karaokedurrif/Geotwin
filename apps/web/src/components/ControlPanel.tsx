import { useEffect, useRef, useState } from 'react';
import type { TwinRecipe, LayerType, StylePreset } from '@geotwin/types';
import { uploadCadastralFile, loadSampleData } from '@/lib/api';
import styles from './ControlPanel.module.css';

type ServiceStatus = 'idle' | 'loading' | 'success' | 'error' | 'fallback';

interface ServiceStatusInfo {
  status: ServiceStatus;
  message?: string;
}

interface ControlPanelProps {
  onRecipeLoaded: (recipe: TwinRecipe) => void;
  recipe: TwinRecipe | null;
  enabledLayers: Set<LayerType>;
  onToggleLayer: (layerId: LayerType) => void;
  terrainEnabled: boolean;
  onToggleTerrain: () => void;
  terrainSource?: 'world' | 'mdt02';
  onTerrainSourceChange?: (source: 'world' | 'mdt02') => void;
  realNDVIEnabled: boolean;
  onToggleRealNDVI: () => void;
  pnoaImageryEnabled?: boolean;
  onTogglePNOAImagery?: () => void;
  ndviDate?: string;
  onNDVIDateChange?: (date: string) => void;
  onRecenterCamera?: () => void;
  onIsometricView?: () => void;
  onExportParcel?: () => void;
  recenterEnabled?: boolean;
  exportEnabled?: boolean;
  generatedTwinId?: string | null;
  framingMargin?: number;
  onFramingMarginChange?: (margin: number) => void;
  terrainExaggeration?: number;
  onExaggerationChange?: (value: number) => void;
  viewerLogs?: string[];
  terrainStatus?: ServiceStatusInfo;
  imageryStatus?: ServiceStatusInfo;
  ndviStatus?: ServiceStatusInfo;
  onToggleBuildings?: () => void;
  parcelStatus?: {
    loaded: boolean;
    centroid?: [number, number];
    radiusMeters?: number;
    wasReprojected?: boolean;
    sourceEPSG?: string;
    error?: string;
  };
  viewerStatus?: { isOffline?: boolean };
}

export default function ControlPanel({
  onRecipeLoaded,
  recipe,
  enabledLayers,
  onToggleLayer,
  terrainEnabled,
  onToggleTerrain,
  terrainSource = 'world',
  onTerrainSourceChange,
  realNDVIEnabled,
  onToggleRealNDVI,
  pnoaImageryEnabled,
  onTogglePNOAImagery,
  ndviDate,
  onNDVIDateChange,
  onRecenterCamera,
  onIsometricView,
  onExportParcel,
  recenterEnabled,
  exportEnabled,
  generatedTwinId,
  framingMargin = 1.45,
  onFramingMarginChange,
  terrainExaggeration = 1.0,
  onExaggerationChange,
  viewerLogs,
  terrainStatus,
  imageryStatus,
  ndviStatus,
  onToggleBuildings,
  parcelStatus,
  viewerStatus,
}: ControlPanelProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debug: log export state changes
  useEffect(() => {
    console.log('[ControlPanel] Export state:', { exportEnabled, generatedTwinId, hasRecipe: !!recipe });
  }, [exportEnabled, generatedTwinId, recipe]);

  // Handle KML file upload
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setIsUploading(true);
    setUploadError(null);
    
    try {
      const recipe = await uploadCadastralFile({
        file,
        preset: 'dehesa', // Default preset for Phase 1
        onProgress: (status) => console.log(status),
      });

      onRecipeLoaded(recipe);
    } catch (error: any) {
      console.error('Upload error:', error);
      setUploadError(error.message || 'Failed to upload file');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle sample data loading
  const handleLoadSample = async () => {
    setIsLoadingSample(true);
    setUploadError(null);
    
    try {
      const recipe = await loadSampleData({
        preset: 'dehesa', // Default preset for Phase 1
        onProgress: (status) => console.log(status),
      });

      onRecipeLoaded(recipe);
    } catch (error: any) {
      console.error('Sample load error:', error);
      setUploadError(error.message || 'Failed to load sample data');
    } finally {
      setIsLoadingSample(false);
    }
  };

  const handleGenerateTwin = () => {
    fileInputRef.current?.click();
  };

  return (
    <aside className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>Geotwin</h1>
        <p className={styles.subtitle}>Digital Twin Manager</p>
      </div>

      {/* Main Controls Card */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Data Source</h2>
        
        {/* Upload Button */}
        <button 
          className={styles.primaryButton}
          onClick={handleGenerateTwin}
          disabled={isUploading}
        >
          {isUploading ? 'Uploading...' : 'Upload KML'}
        </button>
        
        <input
          ref={fileInputRef}
          type="file"
          accept=".kml"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {/* Sample Data Button */}
        <button
          className={styles.secondaryButton}
          onClick={handleLoadSample}
          disabled={isLoadingSample || isUploading}
        >
          {isLoadingSample ? 'Loading...' : 'Load Sample'}
        </button>

        {/* Error Message */}
        {uploadError && (
          <div className={styles.errorMessage}>
            {uploadError}
          </div>
        )}

        {/* Success State */}
        {recipe && !uploadError && (
          <div className={styles.successMessage}>
            ✓ Twin loaded: {recipe.twinId.slice(0, 8)}
          </div>
        )}
      </div>

      {/* Camera Controls Card */}
      {recipe && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Camera</h2>
          
          <button
            className={styles.secondaryButton}
            onClick={onRecenterCamera}
            disabled={!recenterEnabled}
          >
            Recenter View
          </button>

          <button
            className={styles.secondaryButton}
            onClick={onIsometricView}
            disabled={!recenterEnabled}
          >
            Isometric View
          </button>

          {/* Zoom Slider (inverted: right = closer camera) */}
          <div className={styles.sliderGroup}>
            <label className={styles.sliderLabel}>
              <span>Zoom</span>
              <span className={styles.sliderValue}>{(3.5 - framingMargin).toFixed(1)}x</span>
            </label>
            <input
              type="range"
              min="1.0"
              max="2.5"
              step="0.05"
              value={3.5 - framingMargin}
              onChange={(e) => onFramingMarginChange?.(3.5 - parseFloat(e.target.value))}
              className={styles.slider}
            />
          </div>
        </div>
      )}

      {/* Terrain Card */}
      {recipe && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Terrain</h2>

          {/* Terrain Toggle */}
          <div className={styles.toggleRow}>
            <span className={styles.toggleLabel}>3D Relief</span>
            <button
              className={`${styles.toggle} ${terrainEnabled ? styles.toggleActive : ''}`}
              onClick={onToggleTerrain}
              role="switch"
              aria-checked={terrainEnabled}
            >
              <span className={styles.toggleThumb}></span>
            </button>
          </div>

          {/* Terrain Source Selection */}
          {terrainEnabled && onTerrainSourceChange && (
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="terrainSource"
                  value="world"
                  checked={terrainSource === 'world'}
                  onChange={() => onTerrainSourceChange('world')}
                  className={styles.radio}
                />
                <span>World Terrain</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="terrainSource"
                  value="mdt02"
                  checked={terrainSource === 'mdt02'}
                  onChange={() => onTerrainSourceChange('mdt02')}
                  className={styles.radio}
                />
                <span>MDT02 (Spain 2m)</span>
              </label>
            </div>
          )}

          {/* Terrain Exaggeration Slider */}
          {terrainEnabled && (
            <div className={styles.sliderGroup}>
              <label className={styles.sliderLabel}>
                <span>Relief</span>
                <span className={styles.sliderValue}>{terrainExaggeration.toFixed(2)}x</span>
              </label>
              <input
                type="range"
                min="1.0"
                max="3.0"
                step="0.25"
                value={terrainExaggeration}
                onChange={(e) => onExaggerationChange?.(parseFloat(e.target.value))}
                className={styles.slider}
              />
            </div>
          )}
        </div>
      )}

      {/* Imagery Card */}
      {recipe && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Imagery</h2>

          {/* PNOA Toggle */}
          {onTogglePNOAImagery && (
            <div className={styles.toggleRow}>
              <span className={styles.toggleLabel}>PNOA Orthophoto</span>
              <button
                className={`${styles.toggle} ${pnoaImageryEnabled ? styles.toggleActive : ''}`}
                onClick={onTogglePNOAImagery}
                role="switch"
                aria-checked={pnoaImageryEnabled}
              >
                <span className={styles.toggleThumb}></span>
              </button>
            </div>
          )}

          {/* Real NDVI Toggle */}
          <div className={styles.toggleRow}>
            <span className={styles.toggleLabel}>Sentinel-2 NDVI</span>
            <button
              className={`${styles.toggle} ${realNDVIEnabled ? styles.toggleActive : ''}`}
              onClick={onToggleRealNDVI}
              role="switch"
              aria-checked={realNDVIEnabled}
            >
              <span className={styles.toggleThumb}></span>
            </button>
          </div>

          {/* NDVI Date Picker */}
          {realNDVIEnabled && onNDVIDateChange && (
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Acquisition Date</label>
              <input
                type="date"
                value={ndviDate}
                onChange={(e) => onNDVIDateChange(e.target.value)}
                className={styles.dateInput}
              />
            </div>
          )}
        </div>
      )}

      {/* Data Layers Card */}
      {recipe && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Data Layers</h2>

          {/* IoT Sensors - Phase 2 */}
          <div className={styles.layerRow}>
            <div className={styles.layerInfo}>
              <span className={styles.layerName}>IoT Sensors</span>
              <span className={styles.phaseBadge}>F2</span>
            </div>
            <button
              className={`${styles.toggle} ${styles.toggleDisabled}`}
              disabled
              role="switch"
              aria-checked={false}
            >
              <span className={styles.toggleThumb}></span>
            </button>
          </div>

          {/* Cattle GPS - Phase 2 */}
          <div className={styles.layerRow}>
            <div className={styles.layerInfo}>
              <span className={styles.layerName}>Cattle GPS</span>
              <span className={styles.phaseBadge}>F2</span>
            </div>
            <button
              className={`${styles.toggle} ${styles.toggleDisabled}`}
              disabled
              role="switch"
              aria-checked={false}
            >
              <span className={styles.toggleThumb}></span>
            </button>
          </div>

          {/* Water Points - Phase 3 */}
          <div className={styles.layerRow}>
            <div className={styles.layerInfo}>
              <span className={styles.layerName}>Water Points</span>
              <span className={styles.phaseBadge}>F3</span>
            </div>
            <button
              className={`${styles.toggle} ${styles.toggleDisabled}`}
              disabled
              role="switch"
              aria-checked={false}
            >
              <span className={styles.toggleThumb}></span>
            </button>
          </div>

          {/* Vegetation ROI - Phase 3 */}
          <div className={styles.layerRow}>
            <div className={styles.layerInfo}>
              <span className={styles.layerName}>Vegetation ROI</span>
              <span className={styles.phaseBadge}>F3</span>
            </div>
            <button
              className={`${styles.toggle} ${styles.toggleDisabled}`}
              disabled
              role="switch"
              aria-checked={false}
            >
              <span className={styles.toggleThumb}></span>
            </button>
          </div>

          {/* Oak Trees - Phase 4 */}
          <div className={styles.layerRow}>
            <div className={styles.layerInfo}>
              <span className={styles.layerName}>Oak Trees</span>
              <span className={styles.phaseBadge}>F4</span>
            </div>
            <button
              className={`${styles.toggle} ${styles.toggleDisabled}`}
              disabled
              role="switch"
              aria-checked={false}
            >
              <span className={styles.toggleThumb}></span>
            </button>
          </div>
        </div>
      )}

      {/* Export Card */}
      {recipe && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Export</h2>
          
          <button
            className={styles.secondaryButton}
            onClick={() => {
              console.log('[ControlPanel] Export button clicked, enabled:', exportEnabled);
              onExportParcel?.();
            }}
            disabled={!exportEnabled}
            title={!exportEnabled ? 'Esperando generación del twin...' : 'Exportar geometría y datos del twin'}
          >
            Export Parcel KML
          </button>

          {generatedTwinId && (
            <a
              href={`/studio/${generatedTwinId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.btnStudio}
            >
              Open in Studio →
            </a>
          )}
        </div>
      )}
    </aside>
  );
}
