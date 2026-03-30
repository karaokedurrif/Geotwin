import { useStudioStore } from '../store';

const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between',
  fontSize: 11, marginBottom: 6,
  fontFamily: "'DM Sans', system-ui, sans-serif",
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

export default function InfoSection() {
  const info = useStudioStore((s) => s.modelInfo);

  return (
    <div>
      <div style={row}>
        <span style={{ color: '#71717a' }}>Vertices</span>
        <span style={{ color: '#e8e8ec', fontFamily: "'JetBrains Mono', monospace" }}>
          {formatNumber(info.vertices)}
        </span>
      </div>
      <div style={row}>
        <span style={{ color: '#71717a' }}>Triangles</span>
        <span style={{ color: '#e8e8ec', fontFamily: "'JetBrains Mono', monospace" }}>
          {formatNumber(info.faces)}
        </span>
      </div>
      <div style={row}>
        <span style={{ color: '#71717a' }}>Texture</span>
        <span style={{ color: '#e8e8ec', fontFamily: "'JetBrains Mono', monospace" }}>
          {info.textureSize}
        </span>
      </div>
      <div style={row}>
        <span style={{ color: '#71717a' }}>File Size</span>
        <span style={{ color: '#e8e8ec', fontFamily: "'JetBrains Mono', monospace" }}>
          {info.fileSize}
        </span>
      </div>
      <div style={row}>
        <span style={{ color: '#71717a' }}>Area</span>
        <span style={{ color: '#e8e8ec', fontFamily: "'JetBrains Mono', monospace" }}>
          {info.areaHa > 0 ? `${info.areaHa.toFixed(1)} ha` : '-'}
        </span>
      </div>
    </div>
  );
}
