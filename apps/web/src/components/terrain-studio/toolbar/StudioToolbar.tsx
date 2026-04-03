import { Ruler, MapPin, FolderOpen } from 'lucide-react';
import { useRef } from 'react';
import { useStudioStore } from '../store';
import ViewModeToggle from './ViewModeToggle';
import ExportMenu from './ExportMenu';
import HyperrealButton from './HyperrealButton';

interface StudioToolbarProps {
  twinId: string;
  glbUrl: string;
  onClose: () => void;
}

const toolBtn: React.CSSProperties = {
  padding: '5px 8px',
  fontSize: 11,
  fontWeight: 600,
  background: 'transparent',
  color: '#a1a1aa',
  border: '1px solid #3a3a40',
  borderRadius: 4,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  transition: 'all 0.15s',
};

const toolBtnActive: React.CSSProperties = {
  ...toolBtn,
  background: '#10B981',
  color: '#fff',
  borderColor: '#10B981',
};

export default function StudioToolbar({ twinId, glbUrl, onClose }: StudioToolbarProps) {
  const activeTool = useStudioStore((s) => s.activeTool);
  const setActiveTool = useStudioStore((s) => s.setActiveTool);
  const setGlbOverrideUrl = useStudioStore((s) => s.setGlbOverrideUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenGlb = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.name.endsWith('.glb')) {
      const url = URL.createObjectURL(file);
      setGlbOverrideUrl(url);
    }
    e.target.value = '';
  };

  return (
    <div style={{
      height: 40,
      background: '#222226',
      borderBottom: '1px solid #2e2e34',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 8,
      flexShrink: 0,
    }}>
      {/* Left: title */}
      <span style={{
        color: '#10B981', fontWeight: 700, fontSize: 13,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        marginRight: 8,
      }}>
        GeoTwin Terrain Studio
      </span>

      {/* View mode toggles */}
      <ViewModeToggle />

      <div style={{ width: 1, height: 20, background: '#3a3a40', margin: '0 4px' }} />

      {/* Open GLB file */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <button
        style={toolBtn}
        onClick={handleOpenGlb}
        title="Open GLB file"
      >
        <FolderOpen size={14} />
        <span>Open</span>
      </button>

      <div style={{ width: 1, height: 20, background: '#3a3a40', margin: '0 4px' }} />

      {/* Tools */}
      <button
        style={activeTool === 'measure' ? toolBtnActive : toolBtn}
        onClick={() => setActiveTool(activeTool === 'measure' ? 'orbit' : 'measure')}
        title="Measure tool (M)"
      >
        <Ruler size={14} />
      </button>
      <button
        style={activeTool === 'annotate' ? toolBtnActive : toolBtn}
        onClick={() => setActiveTool(activeTool === 'annotate' ? 'orbit' : 'annotate')}
        title="Annotate (A)"
      >
        <MapPin size={14} />
      </button>

      <div style={{ flex: 1 }} />

      {/* Right: Hyperreal + Export + Close */}
      <HyperrealButton twinId={twinId} />
      <ExportMenu twinId={twinId} glbUrl={glbUrl} />
      <button
        onClick={onClose}
        style={{
          padding: '5px 10px', fontSize: 13, fontWeight: 700,
          background: 'transparent', color: '#71717a',
          border: '1px solid #3a3a40', borderRadius: 4, cursor: 'pointer',
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}
        title="Close (Esc)"
      >
        ✕
      </button>
    </div>
  );
}
