import { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronDown,
  Image,
  Palette,
  Map,
  Download,
  Box,
  Loader2,
  Sparkles,
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
  onGenerateMesh?: () => void;
  meshStatus?: string;
  twinId?: string;
}

export default function StudioTopBar({
  snapshot,
  visualStyle,
  viewerRef,
  onExport,
  onBackToCapture,
  onGenerateMesh,
  meshStatus,
  twinId,
}: StudioTopBarProps) {
  const [illustrationUrl, setIllustrationUrl] = useState<string | null>(null);
  const [illustrationBlob, setIllustrationBlob] = useState<Blob | null>(null);
  const [showIllustrationModal, setShowIllustrationModal] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null); // track which export is running
  const [showExportMenu, setShowExportMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Capture helpers ────────────────────────────────────────────────
  const runCapture = async (name: string, viewAngle: string, pixelRatio: number, boundaryOnly: boolean, download?: string) => {
    if (!viewerRef) return;
    setExporting(name);
    try {
      const blob = await captureHQIllustration({
        viewer: viewerRef, snapshot, viewAngle: viewAngle as any,
        pixelRatio, style: visualStyle?.preset as any ?? 'natural', boundaryOnly,
      });
      if (download) {
        downloadBlob(blob, download);
      } else {
        const url = URL.createObjectURL(blob);
        setIllustrationUrl(url);
        setIllustrationBlob(blob);
        setShowIllustrationModal(true);
      }
    } catch (e: any) {
      console.error(`[Export] ${name} failed:`, e);
      alert(`Error: ${e.message}`);
    } finally {
      setExporting(null);
      setShowExportMenu(false);
    }
  };

  const handleCenitalHD = () => runCapture('cenital', 'top', 3, true, `geotwin_${snapshot.twinId}_cenital_HD.png`);
  const handleVista3D = () => runCapture('vista3d', 'current', 2, false);

  const handleDownloadGLB = async () => {
    setExporting('glb');
    setShowExportMenu(false);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
      const id = twinId || snapshot.twinId;
      const res = await fetch(`${apiBase}/api/tiles/${encodeURIComponent(id)}/lod0.glb`);
      if (!res.ok) throw new Error('GLB not available — generate mesh first');
      const blob = await res.blob();
      downloadBlob(blob, `geotwin_${id}_3d_model.glb`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setExporting(null);
    }
  };

  const handleDownloadKML = () => {
    const geojson = snapshot.parcel?.geojson;
    if (!geojson) { alert('No geometry available'); return; }
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    downloadBlob(blob, `geotwin_${snapshot.twinId}_polygon.geojson`);
    setShowExportMenu(false);
  };

  const handleIllustration = async () => {
    setExporting('illustration');
    setShowExportMenu(false);
    try {
      // 1. Start generation job
      const res = await fetch('/api/illustration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot: {
            twinId: twinId || snapshot.twinId,
            parcel: snapshot.parcel,
          },
          style: visualStyle?.preset ?? 'natural',
          width: 1100,
          height: 820,
          z_scale: 130,
        }),
      });
      if (!res.ok) throw new Error('Illustration service unavailable');
      const { job_id } = await res.json();

      // 2. Poll for completion (max 120s)
      const maxPolls = 40;
      for (let i = 0; i < maxPolls; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const statusRes = await fetch(`/api/illustration-status?job_id=${encodeURIComponent(job_id)}`);
        if (!statusRes.ok) continue;
        const status = await statusRes.json();
        if (status.status === 'completed' && status.image_url) {
          // 3. Fetch the generated image via proxy
          const imgRes = await fetch(`/api/illustration-image?path=${encodeURIComponent(status.image_url)}`);
          if (!imgRes.ok) throw new Error('Failed to fetch illustration image');
          const blob = await imgRes.blob();
          const url = URL.createObjectURL(blob);
          setIllustrationUrl(url);
          setIllustrationBlob(blob);
          setShowIllustrationModal(true);
          return;
        }
        if (status.status === 'error') {
          throw new Error(status.error || 'Illustration generation failed');
        }
      }
      throw new Error('Illustration timed out after 2 minutes');
    } catch (e: any) {
      console.error('[Illustration]', e);
      alert(`Error: ${e.message}`);
    } finally {
      setExporting(null);
    }
  };

  const meshRunning = meshStatus === 'running' || meshStatus === 'queued';
  const meshDone = meshStatus === 'completed' || meshStatus === 'available';

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

        {/* Mallado 3D */}
        <button
          className={styles.actionBtn}
          onClick={() => onGenerateMesh?.()}
          disabled={!onGenerateMesh || meshRunning || meshDone}
          style={{ borderColor: '#6366f160', color: meshRunning ? '#6366f1' : meshDone ? '#10B981' : undefined }}
          title="Genera malla 3D real con textura PNOA"
        >
          {meshRunning ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Palette size={10} />}
          {meshRunning ? 'Generando...' : meshDone ? 'Mallado 3D \u2713' : 'Mallado 3D'}
        </button>

        {/* Export dropdown */}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            className={styles.actionBtn}
            onClick={() => setShowExportMenu(!showExportMenu)}
            disabled={!!exporting}
            style={{ borderColor: '#10B98160', gap: '3px' }}
          >
            {exporting ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={10} />}
            Exportar
            <ChevronDown size={8} />
          </button>
          {showExportMenu && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4,
              background: '#1a1a2e', border: '1px solid #333', borderRadius: 8,
              padding: '6px 0', minWidth: 240, zIndex: 9999,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}>
              <DropItem icon={<Map size={13}/>} label="Cenital (PNG)" desc="Vista top-down de todo el polígono" onClick={handleCenitalHD} disabled={!viewerRef} />
              <DropItem icon={<Image size={13}/>} label="Vista actual (PNG)" desc="Screenshot de lo que se ve" onClick={handleVista3D} disabled={!viewerRef} />
              <div style={{ height: 1, background: '#333', margin: '6px 0' }} />
              <DropItem icon={<Sparkles size={13}/>} label="Ilustración 3D" desc="Render isométrico con terreno y PNOA" onClick={handleIllustration} disabled={exporting === 'illustration'} />
              <div style={{ height: 1, background: '#333', margin: '6px 0' }} />
              <DropItem icon={<Box size={13}/>} label="Modelo 3D (GLB)" desc="Mesh texturizado descargable" onClick={handleDownloadGLB} disabled={!meshDone} />
              <DropItem icon={<Box size={13}/>} label="Polígono (KML)" desc="Contorno catastral para QGIS" onClick={handleDownloadKML} />
            </div>
          )}
        </div>
      </div>
    </header>

      {/* Illustration Modal (preview captures) */}
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
              downloadBlob(illustrationBlob, `geotwin_${snapshot.twinId}_vista3D.png`);
            }
          }}
        />
      )}
    </>
  );
}

/** Dropdown menu item */
function DropItem({ icon, label, desc, onClick, disabled }: {
  icon: React.ReactNode; label: string; desc: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '8px 12px', background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer',
        color: disabled ? '#555' : '#ccc', textAlign: 'left', fontSize: 13,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (!disabled) (e.target as HTMLElement).style.background = '#ffffff10'; }}
      onMouseLeave={e => { (e.target as HTMLElement).style.background = 'none'; }}
    >
      <span style={{ flexShrink: 0, opacity: disabled ? 0.3 : 0.7 }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontWeight: 500, fontSize: 13 }}>{label}</span>
        <span style={{ fontSize: 10, color: '#777' }}>{desc}</span>
      </span>
    </button>
  );
}
