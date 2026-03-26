import { useState } from 'react';
import {
  ChevronLeft,
  Image,
  Palette,
  FileImage,
  Map,
  Package,
  Loader2,
} from 'lucide-react';
import type { TwinSnapshot, VisualStyle } from '@/lib/twinStore';
import styles from '@/styles/studio.module.css';
import IllustrationModal from './IllustrationModal';
import { captureHQIllustration, downloadBlob } from '@/services/hq_capture';

interface StudioTopBarProps {
  snapshot: TwinSnapshot;
  visualStyle?: VisualStyle;
  viewerRef?: any;  // Cesium.Viewer reference
  onExport: () => void;
  onBackToCapture: () => void;
  onGenerateMesh?: () => void;  // Trigger 3D terrain mesh generation (GLB + 3D Tiles)
  meshStatus?: string;  // 'idle' | 'running' | 'completed' | etc.
}

export default function StudioTopBar({
  snapshot,
  visualStyle,
  viewerRef,
  onExport,
  onBackToCapture,
  onGenerateMesh,
  meshStatus,
}: StudioTopBarProps) {
  const [illustrationUrl, setIllustrationUrl] = useState<string | null>(null);
  const [illustrationBlob, setIllustrationBlob] = useState<Blob | null>(null);
  const [showIllustrationModal, setShowIllustrationModal] = useState(false);
  const [capturingHQ, setCapturingHQ] = useState(false);
  const [capturingRaw, setCapturingRaw] = useState(false);
  const [capturingCenital, setCapturingCenital] = useState(false);

  // Captura HQ directa desde canvas de Cesium (contorno)
  const handleCaptureHQ = async (viewAngle: 'helicopter' | 'isometric' | 'lateral' | 'current' = 'current') => {
    if (!viewerRef) {
      alert('Viewer no disponible. Espera a que el visor 3D esté cargado.');
      return;
    }
    
    setCapturingHQ(true);
    try {
      console.log('[TopBar] 📸 Iniciando captura HQ desde canvas (SOLO CONTORNO)...');
      
      const blob = await captureHQIllustration({
        viewer: viewerRef,
        snapshot,
        viewAngle,
        pixelRatio: 3,
        style: visualStyle?.preset as any ?? 'natural',
        boundaryOnly: true,
      });
      
      const url = URL.createObjectURL(blob);
      setIllustrationUrl(url);
      setIllustrationBlob(blob);
      setShowIllustrationModal(true);
      
      console.log('[TopBar] ✅ Captura HQ completada (recortada a contorno)');
    } catch (error) {
      console.error('[TopBar] ❌ Error en captura HQ:', error);
      alert('Error capturando imagen. Verifica que el visor 3D esté completamente cargado.');
    } finally {
      setCapturingHQ(false);
    }
  };

  // Captura 4K Raw (5x resolución, canvas completo sin recorte)
  const handleCapture4KRaw = async () => {
    if (!viewerRef) {
      alert('Viewer no disponible. Espera a que el visor 3D esté cargado.');
      return;
    }
    setCapturingRaw(true);
    try {
      console.log('[TopBar] 🖼️ Capturando canvas 4K raw (5x sin recorte)...');
      const blob = await captureHQIllustration({
        viewer: viewerRef,
        snapshot,
        viewAngle: 'current',
        pixelRatio: 5,
        style: visualStyle?.preset as any ?? 'natural',
        boundaryOnly: false,
      });
      downloadBlob(blob, `geotwin_${snapshot.twinId}_4K_raw.png`);
      console.log('[TopBar] ✅ 4K Raw descargado');
    } catch (error) {
      console.error('[TopBar] ❌ Error en captura 4K Raw:', error);
      alert('Error capturando 4K Raw');
    } finally {
      setCapturingRaw(false);
    }
  };

  // Captura cenital (vista 90° desde arriba)
  const handleCaptureCenital = async () => {
    if (!viewerRef) {
      alert('Viewer no disponible. Espera a que el visor 3D esté cargado.');
      return;
    }
    setCapturingCenital(true);
    try {
      console.log('[TopBar] 🗺️ Capturando vista cenital...');
      const blob = await captureHQIllustration({
        viewer: viewerRef,
        snapshot,
        viewAngle: 'top',
        pixelRatio: 3,
        style: visualStyle?.preset as any ?? 'natural',
        boundaryOnly: true,
      });
      downloadBlob(blob, `geotwin_${snapshot.twinId}_cenital.png`);
      console.log('[TopBar] ✅ Mapa cenital descargado');
    } catch (error) {
      console.error('[TopBar] ❌ Error en captura cenital:', error);
      alert('Error capturando mapa cenital');
    } finally {
      setCapturingCenital(false);
    }
  };

  return (
    <>
      <header className={styles.studioTopBar}>
      {/* Left: back + breadcrumb */}
      <button className={styles.backBtn} onClick={onBackToCapture} title="Volver a Captura">
        <ChevronLeft size={14} />
      </button>

      <div className={styles.breadcrumb}>
        <span className={styles.breadcrumbApp}>GeoTwin</span>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbTwin}>
          {snapshot.parcel.name || 'Digital Twin'}
        </span>
      </div>

      {/* Center: area + coordinates pill */}
      <div className={styles.parcelPill}>
        <span className={styles.pillArea}>
          {snapshot.parcel.area_ha.toFixed(1)} ha
        </span>
        <span className={styles.pillSep}>·</span>
        <span className={styles.pillCoord}>
          {snapshot.parcel.centroid[0].toFixed(4)}, {snapshot.parcel.centroid[1].toFixed(4)}
        </span>
      </div>

      {/* Right: Twin ID + actions */}
      <div className={styles.topRight}>
        <div className={styles.twinIdBadge}>
          <span className={styles.twinIdLabel}>Twin</span>
          <code className={styles.twinId}>{snapshot.twinId}</code>
        </div>

        {/* 1: HQ Contorno — captura recortada al polígono */}
        <button
          className={styles.actionBtn}
          onClick={() => handleCaptureHQ('current')}
          disabled={capturingHQ || !viewerRef}
          style={{ borderColor: '#10B98160', color: capturingHQ ? '#10B981' : undefined }}
          title="Captura PNG 3x recortada al polígono, fondo transparente"
        >
          {capturingHQ ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Image size={10} />}
          HQ Contorno
        </button>

        {/* 2: Mallado 3D — Genera mesh real con textura PNOA en el visor */}
        <button
          className={styles.actionBtn}
          onClick={() => onGenerateMesh?.()}
          disabled={!onGenerateMesh || meshStatus === 'running' || meshStatus === 'queued' || meshStatus === 'completed' || meshStatus === 'available'}
          style={{ borderColor: '#6366f160', color: (meshStatus === 'running' || meshStatus === 'queued') ? '#6366f1' : meshStatus === 'completed' || meshStatus === 'available' ? '#10B981' : undefined }}
          title="Genera malla 3D real con textura PNOA sobre el polígono — rotable y zoomable"
        >
          {(meshStatus === 'running' || meshStatus === 'queued') ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Palette size={10} />}
          {(meshStatus === 'running' || meshStatus === 'queued') ? 'Generando...' : (meshStatus === 'completed' || meshStatus === 'available') ? 'Mallado 3D ✓' : 'Mallado 3D'}
        </button>

        {/* 3: 4K Raw — canvas completo 5x para Photoshop */}
        <button
          className={styles.actionBtn}
          onClick={handleCapture4KRaw}
          disabled={capturingRaw || !viewerRef}
          style={{ borderColor: '#F59E0B60', color: capturingRaw ? '#F59E0B' : undefined }}
          title="Captura PNG 5x del canvas completo para edición profesional"
        >
          {capturingRaw ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <FileImage size={10} />}
          4K Raw
        </button>

        {/* 4: Mapa Cenital — vista 90° desde arriba */}
        <button
          className={styles.actionBtn}
          onClick={handleCaptureCenital}
          disabled={capturingCenital || !viewerRef}
          style={{ borderColor: '#3B82F660', color: capturingCenital ? '#3B82F6' : undefined }}
          title="Vista cenital 90° para usar como mapa base en Digital Twin"
        >
          {capturingCenital ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Map size={10} />}
          Mapa Cenital
        </button>

        {/* Exportar */}
        <button className={styles.actionBtn} onClick={onExport} title="Exportar snapshot JSON">
          <Package size={10} />
          Exportar
        </button>
      </div>
    </header>

      {/* Illustration Modal */}
      {showIllustrationModal && illustrationUrl && (
        <IllustrationModal
          imageUrl={illustrationUrl}
          imageBlob={illustrationBlob}
          snapshot={snapshot}
          onClose={() => {
            setShowIllustrationModal(false);
            if (illustrationUrl) URL.revokeObjectURL(illustrationUrl);
            setIllustrationUrl(null);
            setIllustrationBlob(null);
          }}
          onDownload={() => {
            if (illustrationBlob) {
              downloadBlob(illustrationBlob, `geotwin_${snapshot.twinId}_HQ.png`);
            }
          }}
        />
      )}
    </>
  );
}
