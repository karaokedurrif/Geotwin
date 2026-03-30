import { useCallback, useRef, useState } from 'react';
import { Ruler, MapPin, Camera, Film, Box, FileDown } from 'lucide-react';
import { useStudioStore } from '../store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

interface ExportMenuProps {
  twinId: string;
  glbUrl: string;
  canvasRef?: React.RefObject<HTMLDivElement>;
}

export default function ExportMenu({ twinId, glbUrl }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const handleScreenshot = useCallback(() => {
    setOpen(false);
    setExporting('screenshot');
    const canvas = document.querySelector('canvas');
    if (canvas) {
      const link = document.createElement('a');
      link.download = `geotwin_${twinId}_screenshot.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
    setExporting(null);
  }, [twinId]);

  const handleDownloadGLB = useCallback(async () => {
    setOpen(false);
    setExporting('glb');
    try {
      const res = await fetch(glbUrl);
      if (!res.ok) throw new Error('GLB not available');
      const blob = await res.blob();
      const link = document.createElement('a');
      link.download = `geotwin_${twinId}_terrain.glb`;
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      console.error('GLB download failed:', e);
    }
    setExporting(null);
  }, [twinId, glbUrl]);

  const menuStyle: React.CSSProperties = {
    position: 'absolute', top: '100%', right: 0, marginTop: 4,
    background: '#1a1a1e', border: '1px solid #2e2e34', borderRadius: 6,
    padding: 4, minWidth: 180, zIndex: 100,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  };

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 12px', fontSize: 12, color: '#d4d4d8',
    background: 'none', border: 'none', width: '100%',
    cursor: 'pointer', borderRadius: 4,
    fontFamily: "'DM Sans', system-ui, sans-serif",
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: '5px 10px', fontSize: 11, fontWeight: 600,
          background: open ? '#10B981' : 'transparent',
          color: open ? '#fff' : '#a1a1aa',
          border: '1px solid #3a3a40', borderRadius: 4, cursor: 'pointer',
          fontFamily: "'DM Sans', system-ui, sans-serif",
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <FileDown size={14} />
        Export
      </button>
      {open && (
        <div style={menuStyle}>
          <button
            style={itemStyle}
            onClick={handleScreenshot}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a30'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            disabled={exporting === 'screenshot'}
          >
            <Camera size={14} /> Screenshot PNG
          </button>
          <button
            style={itemStyle}
            onClick={handleDownloadGLB}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a30'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            disabled={exporting === 'glb'}
          >
            <Box size={14} /> Modelo GLB
          </button>
        </div>
      )}
    </div>
  );
}
