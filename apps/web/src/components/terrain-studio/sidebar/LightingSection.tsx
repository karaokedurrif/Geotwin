import { useStudioStore } from '../store';
import type { LightPreset } from '../types';

const presets: { key: LightPreset; label: string; emoji: string }[] = [
  { key: 'dawn', label: 'Dawn', emoji: '🌅' },
  { key: 'park', label: 'Park', emoji: '🌿' },
  { key: 'sunset', label: 'Sunset', emoji: '🌇' },
  { key: 'night', label: 'Night', emoji: '🌙' },
  { key: 'studio', label: 'Studio', emoji: '💡' },
];

const presetBtn: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11, borderRadius: 4,
  border: '1px solid #3a3a40', background: 'transparent',
  color: '#a1a1aa', cursor: 'pointer',
  fontFamily: "'DM Sans', system-ui, sans-serif",
  transition: 'all 0.15s',
};

const presetBtnActive: React.CSSProperties = {
  ...presetBtn,
  background: '#10B981', color: '#fff', borderColor: '#10B981',
};

export default function LightingSection() {
  const preset = useStudioStore((s) => s.lightPreset);
  const setPreset = useStudioStore((s) => s.setLightPreset);
  const intensity = useStudioStore((s) => s.lightIntensity);
  const setIntensity = useStudioStore((s) => s.setLightIntensity);
  const rotation = useStudioStore((s) => s.lightRotation);
  const setRotation = useStudioStore((s) => s.setLightRotation);

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
        {presets.map((p) => (
          <button
            key={p.key}
            style={preset === p.key ? presetBtnActive : presetBtn}
            onClick={() => setPreset(p.key)}
            title={p.label}
          >
            {p.emoji}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 11, color: '#71717a', marginBottom: 4,
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}>
          <span>Intensity</span>
          <span style={{ color: '#e8e8ec' }}>{intensity.toFixed(1)}</span>
        </div>
        <input
          type="range" min={0} max={3} step={0.1} value={intensity}
          onChange={(e) => setIntensity(parseFloat(e.target.value))}
          style={{ width: '100%', height: 4, accentColor: '#10B981' }}
        />
      </div>

      <div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 11, color: '#71717a', marginBottom: 4,
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}>
          <span>Rotation</span>
          <span style={{ color: '#e8e8ec' }}>{rotation}°</span>
        </div>
        <input
          type="range" min={0} max={360} step={5} value={rotation}
          onChange={(e) => setRotation(parseInt(e.target.value))}
          style={{ width: '100%', height: 4, accentColor: '#10B981' }}
        />
      </div>
    </div>
  );
}
