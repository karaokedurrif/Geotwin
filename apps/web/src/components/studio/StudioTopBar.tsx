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
}

export default function StudioTopBar({
  snapshot,
  visualStyle,
  viewerRef,
  onExport,
  onBackToCapture,
}: StudioTopBarProps) {
  const [generatingIllustration, setGeneratingIllustration] = useState(false);
  const [illustrationUrl, setIllustrationUrl] = useState<string | null>(null);
  const [illustrationBlob, setIllustrationBlob] = useState<Blob | null>(null);
  const [showIllustrationModal, setShowIllustrationModal] = useState(false);
  const [capturingHQ, setCapturingHQ] = useState(false);
  const [capturingRaw, setCapturingRaw] = useState(false);
  const [capturingCenital, setCapturingCenital] = useState(false);

  // Nueva función: Captura HQ directa desde canvas de Cesium
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
        pixelRatio: 3,  // 3x = excelente calidad sin archivos gigantes
        style: visualStyle?.preset as any ?? 'natural',
        boundaryOnly: true,  // ✂️ Recortar a solo la geometría de la parcela
      });
      
      // Crear URL para vista previa
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

  // Nueva función: Captura 4K Raw (5x resolución, canvas completo sin recorte)
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
        viewAngle: 'current',  // vista actual sin mover cámara
        pixelRatio: 5,          // 5x = 4K+ para trabajar en Photoshop
        style: visualStyle?.preset as any ?? 'natural',
        boundaryOnly: false,    // canvas completo sin recorte
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

  // Nueva función: Captura cenital (vista 90° desde arriba)
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
        viewAngle: 'top',      // 90° cenital
        pixelRatio: 3,
        style: visualStyle?.preset as any ?? 'natural',
        boundaryOnly: true,   // ✂️ Recortar al polígono de la parcela
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

  const handleGenerateIllustration = async () => {
    if (!viewerRef) {
      alert('Viewer no disponible');
      return;
    }
    setGeneratingIllustration(true);
    try {
      const stylePreset = visualStyle?.preset ?? 'natural';
      
      console.log('[Illustration] 🎨 Iniciando renderizado 3D isométrico...');
      
      // PASO 1: Enviar snapshot al renderer 3D Python (NO Replicate)
      const res = await fetch('/api/illustration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot: snapshot,
          style: stylePreset,
          width: 1600,
          height: 1200,
          z_scale: 130,
          boundary_only: false,
        }),
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.detail || errData.error || `API error: ${res.status}`);
      }
      const data = await res.json();
      const jobId = data.job_id;
      
      if (!jobId) {
        throw new Error('No job_id returned from illustration service');
      }
      
      console.log('[Illustration] ⏳ Job iniciado:', jobId, '— polling status...');
      
      // PASO 2: Poll hasta que termine (max 120s)
      const maxAttempts = 60;  // 60 × 2s = 120s
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(r => setTimeout(r, 2000));
        
        const statusRes = await fetch(`/api/illustration-status?job_id=${encodeURIComponent(jobId)}`);
        if (!statusRes.ok) continue;
        
        const status = await statusRes.json();
        console.log(`[Illustration] 📊 Status (${attempt + 1}):`, status.status);
        
        if (status.status === 'completed' && status.image_url) {
          // image_url es relativo al illustration service (e.g. /generated/illustration_xxx.png)
          // Necesitamos construir la URL completa via el proxy
          const imageUrl = `/api/illustration-image?path=${encodeURIComponent(status.image_url)}`;
          
          // Descargar la imagen como blob para preview
          const imgRes = await fetch(imageUrl);
          if (imgRes.ok) {
            const blob = await imgRes.blob();
            const url = URL.createObjectURL(blob);
            setIllustrationUrl(url);
            setIllustrationBlob(blob);
            setShowIllustrationModal(true);
            console.log('[Illustration] ✅ Ilustración 3D completada');
          }
          return;
        }
        
        if (status.status === 'error') {
          throw new Error(status.error || 'Error en el renderizado');
        }
      }
      
      throw new Error('Timeout: la ilustración tardó demasiado (>120s)');
    } catch (e: any) {
      console.error('[Illustration] ❌ Error:', e);
      alert(`Error: ${e.message}`);
    } finally {
      setGeneratingIllustration(false);
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

        {/* 2: Ilustración 3D — HQ Contorno → Replicate Flux */}
        <button
          className={styles.actionBtn}
          onClick={() => handleGenerateIllustration()}
          disabled={generatingIllustration || !viewerRef}
          style={{ borderColor: '#6366f160', color: generatingIllustration ? '#6366f1' : undefined }}
          title="Genera ilustración artística isométrica via Replicate Flux"
        >
          {generatingIllustration ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Palette size={10} />}
          {generatingIllustration ? 'Generando...' : 'Ilustración 3D'}
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
