import { useStudioStore } from '../store';

const sliderTrack: React.CSSProperties = {
  width: '100%', height: 4, appearance: 'none' as const,
  background: '#333', borderRadius: 2, outline: 'none',
  cursor: 'pointer',
};

function Slider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, color: '#71717a', marginBottom: 4,
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}>
        <span>{label}</span>
        <span style={{ color: '#e8e8ec' }}>{value.toFixed(2)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          ...sliderTrack,
          accentColor: '#10B981',
        }}
      />
    </div>
  );
}

export default function MaterialSection() {
  const roughness = useStudioStore((s) => s.roughness);
  const metalness = useStudioStore((s) => s.metalness);
  const envMapIntensity = useStudioStore((s) => s.envMapIntensity);
  const setMaterialParam = useStudioStore((s) => s.setMaterialParam);

  return (
    <div>
      <Slider
        label="Roughness" value={roughness} min={0} max={1} step={0.01}
        onChange={(v) => setMaterialParam('roughness', v)}
      />
      <Slider
        label="Metalness" value={metalness} min={0} max={1} step={0.01}
        onChange={(v) => setMaterialParam('metalness', v)}
      />
      <Slider
        label="Env. Map" value={envMapIntensity} min={0} max={3} step={0.05}
        onChange={(v) => setMaterialParam('envMapIntensity', v)}
      />
    </div>
  );
}
