import { useEffect, useCallback } from 'react';
import TerrainCanvas from './TerrainCanvas';
import StudioToolbar from './toolbar/StudioToolbar';
import StudioSidebar from './sidebar/StudioSidebar';
import { useStudioStore } from './store';
import type { ViewMode } from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

interface TerrainStudioProps {
  twinId: string;
  areaHa?: number;
  onClose: () => void;
  geojson?: Record<string, unknown> | null;
}

const statusBar: React.CSSProperties = {
  height: 28,
  background: '#18181b',
  borderTop: '1px solid #2e2e34',
  display: 'flex',
  alignItems: 'center',
  padding: '0 12px',
  gap: 16,
  fontSize: 11,
  color: '#71717a',
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  flexShrink: 0,
};

export default function TerrainStudio({ twinId, areaHa, onClose, geojson }: TerrainStudioProps) {
  const modelInfo = useStudioStore((s) => s.modelInfo);
  const setModelInfo = useStudioStore((s) => s.setModelInfo);
  const setViewMode = useStudioStore((s) => s.setViewMode);
  const setActiveTool = useStudioStore((s) => s.setActiveTool);
  const setLightPreset = useStudioStore((s) => s.setLightPreset);

  const glbUrl = `${API_BASE}/api/tiles/${encodeURIComponent(twinId)}/${encodeURIComponent(twinId)}.glb`;

  // Set area from prop
  useEffect(() => {
    if (areaHa) setModelInfo({ areaHa });
  }, [areaHa, setModelInfo]);

  // Keyboard shortcuts
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const shortcuts: Record<string, () => void> = {
      t: () => setViewMode('textured'),
      w: () => setViewMode('wireframe'),
      c: () => setViewMode('clay'),
      n: () => setViewMode('ndvi'),
      s: () => setViewMode('slope'),
      e: () => setViewMode('elevation'),
      m: () => setActiveTool('measure'),
      a: () => setActiveTool('annotate'),
      '1': () => setLightPreset('dawn'),
      '2': () => setLightPreset('park'),
      '3': () => setLightPreset('sunset'),
      '4': () => setLightPreset('night'),
      '5': () => setLightPreset('studio'),
      Escape: onClose,
    };
    const fn = shortcuts[e.key.toLowerCase()] || shortcuts[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }, [setViewMode, setActiveTool, setLightPreset, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', flexDirection: 'column',
      background: '#0a0a14',
    }}>
      <StudioToolbar twinId={twinId} glbUrl={glbUrl} onClose={onClose} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <StudioSidebar />
        <div style={{ flex: 1, position: 'relative' }}>
          <TerrainCanvas glbUrl={glbUrl} geojson={geojson} />
        </div>
      </div>

      <div style={statusBar}>
        <span>V:{modelInfo.vertices.toLocaleString()}</span>
        <span>T:{modelInfo.faces.toLocaleString()}</span>
        <span>Tex:{modelInfo.textureSize}</span>
        <span>{modelInfo.fileSize}</span>
        {modelInfo.areaHa > 0 && <span>{modelInfo.areaHa.toFixed(1)} ha</span>}
        {modelInfo.fps > 0 && <span>{modelInfo.fps} fps</span>}
      </div>
    </div>
  );
}
