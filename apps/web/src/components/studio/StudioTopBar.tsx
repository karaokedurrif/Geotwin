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
      // PASO 1: Capturar HQ Contorno como base para Replicate
      console.log('[Illustration] 📸 Capturando HQ Contorno como base...');
      const baseBlob = await captureHQIllustration({
        viewer: viewerRef,
        snapshot,
        viewAngle: 'current',
        pixelRatio: 3,
        style: visualStyle?.preset as any ?? 'natural',
        boundaryOnly: true,
      });
      
      // PASO 2: Convertir blob a base64 para Replicate img2img
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(baseBlob);
      });
      
      // PASO 3: Enviar a Replicate via FastAPI
      const parcel = snapshot.parcel;
      const stylePreset = visualStyle?.preset ?? 'natural';
      
      const stylePrompts: Record<string, string> = {
        natural: `Isometric 3D artistic illustration of a ${parcel.area_ha?.toFixed(0)}ha Spanish dehesa parcel in Sistema Central mountains, holm oak trees, rocky terrain, golden cadastral boundary glowing, aerial perspective 45 degrees, painterly style, cinematic lighting, high detail`,
        ndvi: `Isometric 3D satellite vegetation analysis of a ${parcel.area_ha?.toFixed(0)}ha Spanish parcel, NDVI false color, green healthy zones, yellows sparse vegetation, golden boundary, scientific illustration style`,
        night: `Isometric 3D night view of a ${parcel.area_ha?.toFixed(0)}ha Spanish dehesa, moonlit terrain, blue atmosphere, golden glowing cadastral boundary, dramatic shadows, cinematic`,
        topo: `Isometric 3D topographic illustration of a ${parcel.area_ha?.toFixed(0)}ha Spanish mountain parcel, contour lines, elevation colors, golden cadastral boundary, technical map style`,
      };
      
      const prompt = stylePrompts[stylePreset] || stylePrompts.natural;
      
      console.log('[Illustration] 🎨 Enviando a Replicate Flux...');
      const res = await fetch('/api/illustration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          cesium_screenshot: base64,
          snapshot_context: {
            area_ha: parcel.area_ha,
            centroid: parcel.centroid,
            twin_id: snapshot.twinId,
            style: stylePreset,
          },
          boundary_only: false,
        }),
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error || `API error: ${res.status}`);
      }
      const data = await res.json();
      
      if (data.image_url) {
        setIllustrationUrl(data.image_url);
        setIllustrationBlob(null);
        setShowIllustrationModal(true);
        console.log('[Illustration] ✅ Ilustración generada:', data.image_url);
      }
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
