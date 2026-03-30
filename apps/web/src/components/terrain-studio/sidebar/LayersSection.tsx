import { useStudioStore } from '../store';

const layers = [
  { key: 'parcel', label: 'Parcel Outline' },
  { key: 'ndvi', label: 'NDVI Layer' },
  { key: 'slope', label: 'Slope Map' },
  { key: 'elevation', label: 'Elevation' },
  { key: 'sentinel', label: 'Sentinel RGB' },
];

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

export default function LayersSection() {
  const layersState = useStudioStore((s) => s.layers);
  const toggleLayer = useStudioStore((s) => s.toggleLayer);
  const showGrid = useStudioStore((s) => s.showGrid);
  const toggleGrid = useStudioStore((s) => s.toggleGrid);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {layers.map((layer) => {
        const on = layersState[layer.key] ?? false;
        return (
          <div key={layer.key} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{
              fontSize: 11, color: '#d4d4d8',
              fontFamily: "'DM Sans', system-ui, sans-serif",
            }}>
              {layer.label}
            </span>
            <button
              style={{ ...toggleTrack, background: on ? '#10B981' : '#3a3a40' }}
              onClick={() => toggleLayer(layer.key)}
            >
              <div style={{ ...toggleThumb, left: on ? 16 : 2 }} />
            </button>
          </div>
        );
      })}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: 11, color: '#d4d4d8',
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}>
          Reference Grid
        </span>
        <button
          style={{ ...toggleTrack, background: showGrid ? '#10B981' : '#3a3a40' }}
          onClick={toggleGrid}
        >
          <div style={{ ...toggleThumb, left: showGrid ? 16 : 2 }} />
        </button>
      </div>
    </div>
  );
}
