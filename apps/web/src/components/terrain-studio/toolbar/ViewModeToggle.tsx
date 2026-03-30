import { useStudioStore } from '../store';
import type { ViewMode } from '../types';

const modes: { key: ViewMode; label: string; shortcut: string }[] = [
  { key: 'textured', label: 'Textured', shortcut: 'T' },
  { key: 'wireframe', label: 'Wire', shortcut: 'W' },
  { key: 'clay', label: 'Clay', shortcut: 'C' },
  { key: 'ndvi', label: 'NDVI', shortcut: 'N' },
  { key: 'slope', label: 'Slope', shortcut: 'S' },
  { key: 'elevation', label: 'Elev', shortcut: 'E' },
];

const btnBase: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 11,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  fontWeight: 600,
  borderRadius: 4,
  border: '1px solid #3a3a40',
  background: 'transparent',
  color: '#a1a1aa',
  cursor: 'pointer',
  transition: 'all 0.15s',
};

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: '#10B981',
  color: '#fff',
  borderColor: '#10B981',
};

export default function ViewModeToggle() {
  const viewMode = useStudioStore((s) => s.viewMode);
  const setViewMode = useStudioStore((s) => s.setViewMode);

  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {modes.map((m) => (
        <button
          key={m.key}
          style={viewMode === m.key ? btnActive : btnBase}
          onClick={() => setViewMode(m.key)}
          title={`${m.label} (${m.shortcut})`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
