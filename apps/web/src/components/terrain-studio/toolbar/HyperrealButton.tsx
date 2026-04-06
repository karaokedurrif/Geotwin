/**
 * HyperrealButton — Captures depth map from Three.js viewer and sends it
 * to the GeoTwin Hyperreal service (ComfyUI + FLUX ControlNet).
 *
 * This is a STANDALONE component. It does NOT modify any existing code.
 * It is imported into StudioToolbar.tsx via a single import + JSX line.
 */
import { useState } from 'react';
import * as THREE from 'three';
import HyperrealResult from './HyperrealResult';

// Always try localhost:8003 — works from any origin if service is running locally
const HYPERREAL_API = 'http://localhost:8003';

const STYLE_OPTIONS = [
  { value: 'extensivo', label: 'Dehesa' },
  { value: 'bodega', label: 'Bodega' },
  { value: 'granja', label: 'Granja' },
  { value: 'vinedo', label: 'Viñedo' },
  { value: 'gallinero', label: 'Gallinero' },
] as const;

interface HyperrealButtonProps {
  /** Twin ID for labelling */
  twinId: string;
}

/**
 * Access Three.js renderer/scene/camera from the R3F Canvas via the
 * internal __r3f store attached to the DOM canvas element.
 */
function getThreeState(): { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera } | null {
  const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
  if (!canvas) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const root = (canvas as any).__r3f;
  if (!root) return null;
  const state = root.store?.getState?.();
  if (!state?.gl || !state?.scene || !state?.camera) return null;
  return { gl: state.gl, scene: state.scene, camera: state.camera };
}

/** Capture a depth map from the Three.js viewport */
function captureDepthMap(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): Blob | null {
  const size = gl.getSize(new THREE.Vector2());
  
  // Use a regular color render target (no depth texture to avoid WebGL errors)
  const depthTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
  });

  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });

  // Store original override material
  const originalOverride = scene.overrideMaterial;
  
  scene.overrideMaterial = depthMaterial;
  gl.setRenderTarget(depthTarget);
  gl.render(scene, camera);

  const pixels = new Uint8Array(size.x * size.y * 4);
  gl.readRenderTargetPixels(depthTarget, 0, 0, size.x, size.y, pixels);

  // Restore original state
  scene.overrideMaterial = originalOverride;
  gl.setRenderTarget(null);
  
  // Force re-render to clear the depth material
  gl.render(scene, camera);
  
  // Clean up
  depthTarget.dispose();
  depthMaterial.dispose();

  const canvas = document.createElement('canvas');
  canvas.width = size.x;
  canvas.height = size.y;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imageData = ctx.createImageData(size.x, size.y);

  // Flip Y (WebGL → Canvas)
  for (let y = 0; y < size.y; y++) {
    for (let x = 0; x < size.x; x++) {
      const srcIdx = ((size.y - y - 1) * size.x + x) * 4;
      const dstIdx = (y * size.x + x) * 4;
      const depth = pixels[srcIdx];
      imageData.data[dstIdx] = depth;
      imageData.data[dstIdx + 1] = depth;
      imageData.data[dstIdx + 2] = depth;
      imageData.data[dstIdx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // Use toDataURL (synchronous) instead of toBlob (async)
  const dataUrl = canvas.toDataURL('image/png');
  const bytes = atob(dataUrl.split(',')[1]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: 'image/png' });
}

/** Capture the RGB view from the Three.js canvas */
function captureRGB(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Blob {
  gl.render(scene, camera);
  const dataUrl = gl.domElement.toDataURL('image/png');
  const bytes = atob(dataUrl.split(',')[1]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: 'image/png' });
}

export default function HyperrealButton({ twinId }: HyperrealButtonProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('extensivo');
  const [showPicker, setShowPicker] = useState(false);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);

  // Always show button — error handling happens on click

  const handleClick = async () => {
    const state = getThreeState();
    if (!state) {
      setError('Visor 3D no disponible');
      return;
    }
    const { gl, scene, camera } = state;

    setLoading(true);
    setError(null);
    setRenderUrl(null);

    try {
      // 1. Capture depth + RGB
      setStatus('Capturando escena...');
      const depthBlob = captureDepthMap(gl, scene, camera);
      if (!depthBlob) throw new Error('Error capturando depth map');
      const rgbBlob = captureRGB(gl, scene, camera);
      // Keep the original RGB for comparison
      setOriginalUrl(URL.createObjectURL(rgbBlob));

      // 2. Send to hyperreal service
      setStatus('Enviando al motor IA...');
      const formData = new FormData();
      formData.append('depth_map', depthBlob, 'depth.png');
      formData.append('rgb_capture', rgbBlob, 'rgb.png');
      formData.append('style', selectedStyle);
      formData.append('resolution', '2048');
      formData.append('twin_id', twinId);

      const resp = await fetch(`${HYPERREAL_API}/render`, {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) throw new Error(`Error ${resp.status}`);
      const { job_id } = (await resp.json()) as { job_id: string };

      // 3. Poll for result
      setStatus('Renderizando con IA (~15s)...');
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusResp = await fetch(`${HYPERREAL_API}/status/${job_id}`);
        const job = (await statusResp.json()) as {
          status: string;
          result?: string;
          error?: string;
        };
        if (job.status === 'completed' && job.result) {
          const url = `${HYPERREAL_API}${job.result}`;
          setRenderUrl(url);
          setShowResult(true);
          setStatus('');
          return;
        }
        if (job.status === 'error') throw new Error(job.error || 'Error en render');
      }
      throw new Error('Timeout: render tardó demasiado');
    } catch (err: any) {
      // Detect connection errors (service not running)
      if (err.message?.includes('fetch') || err.name === 'TypeError') {
        setError('Servicio hyperreal no disponible. Inicia: docker compose --profile hyperreal up -d');
      } else {
        setError(err.message || 'Error desconocido');
      }
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {/* Style picker dropdown */}
      <button
        onClick={() => setShowPicker(!showPicker)}
        style={{
          padding: '5px 8px',
          fontSize: 11,
          fontWeight: 600,
          background: 'transparent',
          color: '#a1a1aa',
          border: '1px solid #3a3a40',
          borderRadius: 4,
          cursor: 'pointer',
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}
        title="Estilo de render"
      >
        {STYLE_OPTIONS.find((s) => s.value === selectedStyle)?.label || 'Estilo'}
        <span style={{ marginLeft: 4, fontSize: 9 }}>▾</span>
      </button>

      {showPicker && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#222226',
            border: '1px solid #3a3a40',
            borderRadius: 6,
            padding: 4,
            zIndex: 100,
            minWidth: 120,
          }}
        >
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setSelectedStyle(opt.value);
                setShowPicker(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                fontSize: 12,
                background: selectedStyle === opt.value ? '#10B981' : 'transparent',
                color: selectedStyle === opt.value ? '#fff' : '#a1a1aa',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: "'DM Sans', system-ui, sans-serif",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Main button */}
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          padding: '5px 10px',
          fontSize: 11,
          fontWeight: 700,
          background: loading ? '#374151' : 'linear-gradient(135deg, #8B5CF6, #EC4899)',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: loading ? 'wait' : 'pointer',
          fontFamily: "'DM Sans', system-ui, sans-serif",
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          opacity: loading ? 0.7 : 1,
        }}
        title="Generar render hiperrealista con IA"
      >
        ✨ {loading ? status || 'Procesando...' : 'Hyperreal'}
      </button>

      {/* Error */}
      {error && (
        <span style={{ fontSize: 10, color: '#EF4444', maxWidth: 200 }}>{error}</span>
      )}

      {/* Render result link */}
      {renderUrl && (
        <button
          onClick={() => setShowResult(true)}
          style={{
            padding: '5px 8px',
            fontSize: 11,
            fontWeight: 600,
            background: '#10B981',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: "'DM Sans', system-ui, sans-serif",
          }}
        >
          🖼 Ver render
        </button>
      )}

      {/* Before/After comparison modal */}
      {showResult && renderUrl && originalUrl && (
        <HyperrealResult
          originalUrl={originalUrl}
          renderUrl={renderUrl}
          style={selectedStyle}
          resolution={2048}
          onClose={() => setShowResult(false)}
        />
      )}
    </div>
  );
}
