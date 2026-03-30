import { useStudioStore } from '../store';

const toggleRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  marginBottom: 8,
};

const toggleTrack: React.CSSProperties = {
  width: 32, height: 18, borderRadius: 9,
  position: 'relative', cursor: 'pointer',
  transition: 'background 0.2s',
  border: 'none', padding: 0,
};

const toggleThumb: React.CSSProperties = {
  width: 14, height: 14, borderRadius: '50%',
  background: '#fff', position: 'absolute', top: 2,
  transition: 'left 0.2s',
};

export default function PostFXSection() {
  const ssao = useStudioStore((s) => s.ssaoEnabled);
  const bloom = useStudioStore((s) => s.bloomEnabled);
  const vignette = useStudioStore((s) => s.vignetteEnabled);
  const toggleFX = useStudioStore((s) => s.toggleFX);

  const fxList = [
    { key: 'ssaoEnabled', label: 'SSAO', on: ssao },
    { key: 'bloomEnabled', label: 'Bloom', on: bloom },
    { key: 'vignetteEnabled', label: 'Vignette', on: vignette },
  ];

  return (
    <div>
      {fxList.map((fx) => (
        <div key={fx.key} style={toggleRow}>
          <span style={{
            fontSize: 11, color: '#d4d4d8',
            fontFamily: "'DM Sans', system-ui, sans-serif",
          }}>
            {fx.label}
          </span>
          <button
            style={{ ...toggleTrack, background: fx.on ? '#10B981' : '#3a3a40' }}
            onClick={() => toggleFX(fx.key)}
          >
            <div style={{ ...toggleThumb, left: fx.on ? 16 : 2 }} />
          </button>
        </div>
      ))}
    </div>
  );
}
