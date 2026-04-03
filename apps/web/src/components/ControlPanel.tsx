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
  const [refcatInput, setRefcatInput] = useState('');
  const [refcat2Input, setRefcat2Input] = useState('');
  const [refcat3Input, setRefcat3Input] = useState('');
  const [mergeEnabled, setMergeEnabled] = useState(false);
  const [isRefcatLoading, setIsRefcatLoading] = useState(false);
  const [refcatStatus, setRefcatStatus] = useState('');
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

  // Handle refcat submission (single or multi-parcel)
  const handleRefcatSubmit = async () => {
    const trimmed = refcatInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{14}([A-Z0-9]{6})?$/.test(trimmed)) {
      setUploadError('Ref. catastral inválida (14 o 20 caracteres alfanuméricos)');
      return;
    }

    // Collect extra refcats if merge is enabled
    const refcats: string[] = [trimmed];
    if (mergeEnabled) {
      for (const extra of [refcat2Input, refcat3Input]) {
        const t = extra.trim().toUpperCase();
        if (t && /^[A-Z0-9]{14}([A-Z0-9]{6})?$/.test(t)) {
          refcats.push(t);
        } else if (t) {
          setUploadError(`Ref. catastral inválida: "${t}"`);
          return;
        }
      }
    }

    const isMulti = refcats.length > 1;
    setIsRefcatLoading(true);
    setUploadError(null);
    setRefcatStatus(isMulti ? `Uniendo ${refcats.length} parcelas...` : 'Enviando al Catastro...');
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
      const endpoint = isMulti ? `${API_BASE}/api/twin/from-refcat/multi` : `${API_BASE}/api/twin/from-refcat`;
      const body = isMulti ? JSON.stringify({ refcats }) : JSON.stringify({ refcat: trimmed });
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || `Error ${resp.status}`);
      }
      const { job_id, twin_id } = await resp.json() as { job_id: string; twin_id: string };
      // Poll job until complete
      let attempts = 0;
      while (attempts < 120) {
        await new Promise(r => setTimeout(r, 3000));
        const jobResp = await fetch(`${API_BASE}/api/twin/from-refcat/${job_id}`);
        if (!jobResp.ok) break;
        const job = await jobResp.json() as { status: string; result?: any; error?: string; current_step?: string; progress?: number };
        if (job.current_step) {
          setRefcatStatus(`${job.current_step}${job.progress ? ` (${Math.round(job.progress)}%)` : ''}`);
        }
        if (job.status === 'completed' && job.result) {
          const r = job.result;
          const centroid: [number, number] = r.centroid || [0, 0];
          const areaHa: number = r.area_ha || 0;
          // Compute bbox from centroid + area (approximate radius)
          const radiusDeg = Math.sqrt(areaHa * 10000) / 111000;
          const bbox: [number, number, number, number] = r.bbox || [
            centroid[0] - radiusDeg,
            centroid[1] - radiusDeg,
            centroid[0] + radiusDeg,
            centroid[1] + radiusDeg,
          ];
          const recipe = {
            twinId: twin_id,
            preset: 'dehesa',
            createdAt: new Date().toISOString(),
            centroid,
            bbox,
            area_ha: areaHa,
            camera: {
              longitude: centroid[0],
              latitude: centroid[1],
              height: Math.max(500, Math.sqrt(areaHa * 10000) * 3),
              heading: 315,
              pitch: -35,
              roll: 0,
            },
            presetConfig: { name: 'dehesa', displayName: 'Dehesa', description: '', terrain: { verticalExaggeration: 1, lightingIntensity: 1 }, atmosphere: { brightness: 1, saturation: 1, hueShift: 0 }, groundTint: { r: 0, g: 0, b: 0, a: 1 } },
            layers: [],
            geometryPath: `/api/tiles/${twin_id}/geometry.geojson`,
          } as unknown as TwinRecipe;
          onRecipeLoaded(recipe);
          return;
        }
        if (job.status === 'failed') {
          const errMsg = job.error || 'Pipeline failed';
          // Make Catastro "not found" errors user-friendly
          if (errMsg.includes('No se ha encontrado la parcela') || errMsg.includes('huso')) {
            throw new Error(`Parcela "${trimmed}" no encontrada en el Catastro. Verifica la referencia catastral.`);
          }
          throw new Error(errMsg);
        }
        attempts++;
      }
      throw new Error('Timeout: pipeline tardó demasiado');
    } catch (error: any) {
      setUploadError(error.message || 'Error al procesar referencia catastral');
    } finally {
      setIsRefcatLoading(false);
      setRefcatStatus('');
    }
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
        <h2 className={styles.cardTitle}>Referencias Catastrales</h2>
        
        {/* Referencia Catastral 1 — PRIMARY */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <input
            type="text"
            value={refcatInput}
            onChange={(e) => setRefcatInput(e.target.value)}
            placeholder="RC 1 (obligatoria)"
            maxLength={20}
            disabled={isRefcatLoading}
            style={{
              flex: 1,
              padding: '8px 10px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '6px',
              color: '#e0e0e0',
              fontSize: '13px',
              fontFamily: 'monospace',
              letterSpacing: '0.5px',
            }}
            onKeyDown={(e) => e.key === 'Enter' && !mergeEnabled && handleRefcatSubmit()}
          />
          {!mergeEnabled && (
            <button
              className={styles.primaryButton}
              onClick={handleRefcatSubmit}
              disabled={isRefcatLoading || !refcatInput.trim()}
              style={{ padding: '8px 14px', minWidth: 'auto', marginTop: 0 }}
            >
              {isRefcatLoading ? '...' : 'Crear'}
            </button>
          )}
        </div>

        {/* Multi-parcel toggle */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          margin: '8px 0 4px', cursor: 'pointer', fontSize: '12px', color: '#b0b0b0',
        }}>
          <input
            type="checkbox"
            checked={mergeEnabled}
            onChange={(e) => setMergeEnabled(e.target.checked)}
            disabled={isRefcatLoading}
            style={{ accentColor: '#4ecdc4' }}
          />
          Unir parcelas colindantes (hasta 3)
        </label>

        {/* Extra refcat fields when merge is enabled */}
        {mergeEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
            <input
              type="text"
              value={refcat2Input}
              onChange={(e) => setRefcat2Input(e.target.value)}
              placeholder="RC 2 (opcional)"
              maxLength={20}
              disabled={isRefcatLoading}
              style={{
                padding: '8px 10px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '6px',
                color: '#e0e0e0',
                fontSize: '13px',
                fontFamily: 'monospace',
                letterSpacing: '0.5px',
              }}
            />
            <input
              type="text"
              value={refcat3Input}
              onChange={(e) => setRefcat3Input(e.target.value)}
              placeholder="RC 3 (opcional)"
              maxLength={20}
              disabled={isRefcatLoading}
              style={{
                padding: '8px 10px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '6px',
                color: '#e0e0e0',
                fontSize: '13px',
                fontFamily: 'monospace',
                letterSpacing: '0.5px',
              }}
            />
            <button
              className={styles.primaryButton}
              onClick={handleRefcatSubmit}
              disabled={isRefcatLoading || !refcatInput.trim()}
              style={{ padding: '8px 14px', marginTop: '4px' }}
            >
              {isRefcatLoading ? '...' : 'Crear Gemelo Unificado'}
            </button>
          </div>
        )}
        {refcatStatus && (
          <p style={{
            color: '#4ecdc4',
            fontSize: '11px',
            margin: '6px 0 0',
            fontStyle: 'italic',
          }}>
            {refcatStatus}
          </p>
        )}

        {/* Separator */}
        <p style={{
          textAlign: 'center',
          color: 'rgba(255,255,255,0.4)',
          fontSize: '11px',
          margin: '10px 0 6px',
        }}>
          O sube tu KML
        </p>

        {/* Upload KML — secondary method */}
        <button 
          className={styles.secondaryButton}
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
