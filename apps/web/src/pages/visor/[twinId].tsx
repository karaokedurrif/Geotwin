/**
 * GeoTwin Visor — standalone 3D terrain viewer with Sketchfab-like controls.
 * URL: /visor/{twinId}
 *
 * Features:
 *  - Textured / Wireframe / Clay / NDVI shading modes
 *  - Adjustable lighting (direction, intensity, ambient)
 *  - FOV slider, auto-rotate, background color
 *  - Vegetation tint overlay for finca twins
 *  - Grid toggle, mesh info, download GLB
 *  - Shareable URL
 */
import { useRouter } from 'next/router';
import { Suspense, useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import Head from 'next/head';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

type ShadingMode = 'textured' | 'wireframe' | 'clay' | 'ndvi';

interface MeshStats {
  vertices: number;
  triangles: number;
  gridY: number;
}

interface PipelineMeta {
  twin_id: string;
  area_ha: number;
  centroid: [number, number];
  vertex_count: number;
  face_count: number;
  ortho?: { width: number; height: number; texture: string };
}

interface SceneSettings {
  shading: ShadingMode;
  lightIntensity: number;
  lightAngle: number;      // 0-360 degrees around Y
  lightElevation: number;  // 10-80 degrees from horizon
  ambientIntensity: number;
  fov: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
  bgColor: string;
  showGrid: boolean;
  envPreset: string;
  vegetationTint: number;  // 0=off, 1=max green overlay
  roughness: number;
  metalness: number;
}

const DEFAULT_SETTINGS: SceneSettings = {
  shading: 'textured',
  lightIntensity: 1.0,
  lightAngle: 225,
  lightElevation: 45,
  ambientIntensity: 0.4,
  fov: 45,
  autoRotate: false,
  autoRotateSpeed: 1.0,
  bgColor: '#1a1a2e',
  showGrid: true,
  envPreset: 'sunset',
  vegetationTint: 0,
  roughness: 0.9,
  metalness: 0.0,
};

/* ── Terrain Model ─────────────────────────────────────────── */

function TerrainMesh({
  url,
  settings,
  onStats,
  controlsRef,
  resetRef,
  topRef,
}: {
  url: string;
  settings: SceneSettings;
  onStats?: (s: MeshStats) => void;
  controlsRef: React.RefObject<unknown>;
  resetRef?: React.MutableRefObject<(() => void) | null>;
  topRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const { scene } = useGLTF(url);
  const { camera, invalidate } = useThree();
  const origMaterials = useRef<Map<string, THREE.Material>>(new Map());

  // Initial setup: center, scale, orient, auto-fit camera
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const center = new THREE.Vector3();
    box.getCenter(center);
    scene.position.sub(center);

    const size = new THREE.Vector3();
    box.getSize(size);
    const hzMax = Math.max(size.x, size.z) || 1;
    const yRange = size.y || 0.001;
    const flatRatio = hzMax / yRange;

    // Rotate 180° around Y — GLB has -Z=North, this makes North face camera
    scene.rotation.y = Math.PI;

    const baseScale = 2 / hzMax;
    scene.scale.set(baseScale, baseScale, baseScale);

    if (flatRatio > 30) {
      // Ultra-flat: no exag — avoids mesh explosion on gardens/parking lots
    } else if (flatRatio > 15) {
      scene.scale.y = baseScale * Math.min(flatRatio / 20, 2.5);
    } else if (flatRatio > 10) {
      scene.scale.y = baseScale * Math.min(flatRatio / 8, 5.0);
    }

    const fb = new THREE.Box3().setFromObject(scene);
    const fc = new THREE.Vector3();
    fb.getCenter(fc);
    const fs = new THREE.Vector3();
    fb.getSize(fs);
    const maxDim = Math.max(fs.x, fs.y, fs.z);
    const dist = Math.max(maxDim * 1.8, 2);

    camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
    camera.updateProjectionMatrix();

    const ctrl = controlsRef.current as any;
    if (ctrl?.target) { ctrl.target.copy(fc); ctrl.update?.(); }
    else { camera.lookAt(fc); }

    invalidate();

    // Store original materials + sharpen textures + collect stats
    let verts = 0, tris = 0;
    scene.traverse((child: any) => {
      if (child.isMesh && child.geometry) {
        const geo = child.geometry;
        verts += geo.attributes.position?.count ?? 0;
        tris += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3;

        // Store original material for shading mode restore
        if (!origMaterials.current.has(child.uuid)) {
          origMaterials.current.set(child.uuid, child.material.clone());
        }

        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat?.map) {
          mat.map.anisotropy = 16;
          mat.map.minFilter = THREE.LinearMipmapLinearFilter;
          mat.map.magFilter = THREE.LinearFilter;
          mat.map.generateMipmaps = true;
          mat.map.needsUpdate = true;
        }
      }
    });
    onStats?.({ vertices: verts, triangles: Math.round(tris), gridY: fb.min.y - 0.02 });

    if (resetRef) {
      resetRef.current = () => {
        camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
        camera.updateProjectionMatrix();
        const c = controlsRef.current as any;
        if (c?.target) { c.target.copy(fc); c.update?.(); }
        invalidate();
      };
    }
    if (topRef) {
      topRef.current = () => {
        camera.position.set(fc.x, dist * 1.2, fc.z);
        camera.updateProjectionMatrix();
        const c = controlsRef.current as any;
        if (c?.target) { c.target.copy(fc); c.update?.(); }
        invalidate();
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, camera, invalidate]);

  // Apply shading mode + vegetation tint + material properties
  useEffect(() => {
    scene.traverse((child: any) => {
      if (!child.isMesh) return;

      const orig = origMaterials.current.get(child.uuid) as THREE.MeshStandardMaterial | undefined;

      if (settings.shading === 'wireframe') {
        child.material.wireframe = true;
        child.material.color?.set('#10B981');
        child.material.map = null;
        child.material.needsUpdate = true;
      } else if (settings.shading === 'clay') {
        child.material.wireframe = false;
        child.material.map = null;
        child.material.color?.set('#d4c5a9');
        child.material.roughness = 1.0;
        child.material.metalness = 0.0;
        child.material.needsUpdate = true;
      } else if (settings.shading === 'ndvi') {
        // Fake NDVI: green → yellow → brown based on luminance
        child.material.wireframe = false;
        child.material.map = null;
        child.material.color?.set('#4a7c3f');
        child.material.roughness = 0.95;
        child.material.metalness = 0.0;
        child.material.needsUpdate = true;
      } else {
        // Textured — restore original
        child.material.wireframe = false;
        if (orig?.map) {
          child.material.map = orig.map;
          child.material.map.anisotropy = 16;
          child.material.map.minFilter = THREE.LinearMipmapLinearFilter;
          child.material.map.generateMipmaps = true;
          child.material.map.needsUpdate = true;
        }
        if (orig?.color) child.material.color?.copy(orig.color);
        child.material.needsUpdate = true;
      }

      // Apply vegetation tint overlay (blend green onto existing color)
      if (settings.vegetationTint > 0 && settings.shading === 'textured') {
        const veg = new THREE.Color('#3a6b35');
        const current = child.material.color || new THREE.Color(1, 1, 1);
        current.lerp(veg, settings.vegetationTint * 0.35);
        child.material.color = current;
        child.material.needsUpdate = true;
      }

      // Material properties
      child.material.roughness = settings.roughness;
      child.material.metalness = settings.metalness;
    });
    invalidate();
  }, [scene, settings.shading, settings.vegetationTint, settings.roughness, settings.metalness, invalidate]);

  return <primitive object={scene} />;
}

/* ── Dynamic Light ─────────────────────────────────────────── */

function DynamicLight({ settings }: { settings: SceneSettings }) {
  const lightRef = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    if (!lightRef.current) return;
    const a = THREE.MathUtils.degToRad(settings.lightAngle);
    const e = THREE.MathUtils.degToRad(settings.lightElevation);
    const r = 10;
    lightRef.current.position.set(
      r * Math.cos(e) * Math.sin(a),
      r * Math.sin(e),
      r * Math.cos(e) * Math.cos(a),
    );
    lightRef.current.intensity = settings.lightIntensity;
  }, [settings.lightAngle, settings.lightElevation, settings.lightIntensity]);

  return (
    <>
      <ambientLight intensity={settings.ambientIntensity} />
      <directionalLight
        ref={lightRef}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight position={[-3, 2, -4]} intensity={settings.lightIntensity * 0.2} />
    </>
  );
}

/* ── Auto-Rotate Controller ───────────────────────────────── */

function AutoRotate({ enabled, speed, controlsRef }: {
  enabled: boolean; speed: number; controlsRef: React.RefObject<unknown>;
}) {
  useFrame(() => {
    const c = controlsRef.current as any;
    if (c && enabled) {
      c.autoRotate = true;
      c.autoRotateSpeed = speed;
    } else if (c) {
      c.autoRotate = false;
    }
  });
  return null;
}

/* ── FOV Controller ───────────────────────────────────────── */

function FOVController({ fov }: { fov: number }) {
  const { camera } = useThree();
  useEffect(() => {
    if ((camera as THREE.PerspectiveCamera).fov !== fov) {
      (camera as THREE.PerspectiveCamera).fov = fov;
      camera.updateProjectionMatrix();
    }
  }, [fov, camera]);
  return null;
}

/* ── Loading Spinner ───────────────────────────────────────── */

function LoadingSpinner() {
  return (
    <Html center>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: '#e4e4e7', fontFamily: 'system-ui' }}>
        <div style={{
          width: 40, height: 40,
          border: '3px solid rgba(16,185,129,0.2)',
          borderTop: '3px solid #10B981',
          borderRadius: '50%',
          animation: 'visor-spin 1s linear infinite',
        }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>Cargando modelo 3D…</span>
        <style>{`@keyframes visor-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </Html>
  );
}

/* ── Sidebar Panel Helpers ─────────────────────────────────── */

function PanelSection({ title, icon, children, defaultOpen = true }: {
  title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', border: 'none', background: 'transparent',
          color: '#d1d5db', fontSize: 11, fontWeight: 700, cursor: 'pointer',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}
      >
        <span>{icon}</span>
        <span style={{ flex: 1, textAlign: 'left' }}>{title}</span>
        <span style={{ fontSize: 10, opacity: 0.5 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div style={{ padding: '4px 12px 12px' }}>{children}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, unit }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ color: '#9ca3af', fontSize: 11 }}>{label}</span>
        <span style={{ color: '#d1d5db', fontSize: 11, fontFamily: 'monospace' }}>
          {value.toFixed(step < 1 ? 1 : 0)}{unit ?? ''}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#10B981', height: 4 }}
      />
    </div>
  );
}

function Toggle({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 28, height: 16, borderRadius: 8,
          background: value ? '#10B981' : '#374151',
          position: 'relative', transition: 'background 0.2s',
        }}
      >
        <div style={{
          width: 12, height: 12, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 2, left: value ? 14 : 2,
          transition: 'left 0.2s',
        }} />
      </div>
      <span style={{ color: '#9ca3af', fontSize: 11 }}>{label}</span>
    </label>
  );
}

function ModeButton({ label, active, onClick }: {
  label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '5px 4px', border: '1px solid',
        borderColor: active ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.1)',
        borderRadius: 4,
        background: active ? 'rgba(16,185,129,0.15)' : 'transparent',
        color: active ? '#10B981' : '#9ca3af',
        fontSize: 10, fontWeight: 600, cursor: 'pointer',
        textTransform: 'uppercase', letterSpacing: '0.02em',
      }}
    >
      {label}
    </button>
  );
}

/* ── Visor Page ────────────────────────────────────────────── */

export default function VisorPage() {
  const router = useRouter();
  const { twinId } = router.query;
  const tid = typeof twinId === 'string' ? twinId : '';

  const [settings, setSettings] = useState<SceneSettings>(DEFAULT_SETTINGS);
  const [glbReady, setGlbReady] = useState<boolean | null>(null);
  const [stats, setStats] = useState<MeshStats | null>(null);
  const [meta, setMeta] = useState<PipelineMeta | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const controlsRef = useRef<unknown>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const topRef = useRef<(() => void) | null>(null);

  const glbUrl = useMemo(
    () => tid ? `${API_BASE}/api/tiles/${encodeURIComponent(tid)}/lod0.glb` : '',
    [tid],
  );

  const set = useCallback((patch: Partial<SceneSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
  }, []);

  // Check GLB + load pipeline metadata
  useEffect(() => {
    if (!tid) return;
    fetch(glbUrl, { method: 'HEAD' })
      .then(r => setGlbReady(r.ok))
      .catch(() => setGlbReady(false));
    fetch(`${API_BASE}/api/tiles/${encodeURIComponent(tid)}/pipeline_result.json`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMeta(d); })
      .catch(() => {});
  }, [tid, glbUrl]);

  if (!tid) return null;

  return (
    <>
      <Head>
        <title>GeoTwin Visor — {tid}</title>
        <meta name="description" content={`Visor 3D interactivo del gemelo digital ${tid}`} />
      </Head>

      <div style={S.shell}>
        {/* ── Top bar ── */}
        <header style={S.header}>
          <div style={S.hLeft}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            <span style={{ color: '#10B981', fontSize: 14, fontWeight: 700 }}>GeoTwin Visor</span>
            <code style={{ color: '#6b7280', fontSize: 11, background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 3 }}>{tid}</code>
            {meta && <span style={{ color: '#4b5563', fontSize: 11 }}>{meta.area_ha.toFixed(1)} ha</span>}
          </div>
          <div style={S.hRight}>
            <button onClick={() => setPanelOpen(!panelOpen)} style={S.iconBtn} title="Panel de ajustes">
              ⚙️
            </button>
            <button onClick={() => resetRef.current?.()} style={S.iconBtn} title="Vista isométrica">🔄</button>
            <button onClick={() => topRef.current?.()} style={S.iconBtn} title="Vista cenital">🧭</button>
            <a href={glbUrl} download={`${tid}.glb`} style={{ ...S.iconBtn, textDecoration: 'none' }} title="Descargar GLB">📥</a>
            <button onClick={() => router.push(`/studio/${tid}`)} style={S.studioBtn}>← Studio</button>
          </div>
        </header>

        <div style={S.body}>
          {/* ── Settings Panel (left) ── */}
          {panelOpen && (
            <aside style={S.panel}>
              {/* Shading */}
              <PanelSection title="Sombreado" icon="🎨">
                <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                  <ModeButton label="Textura" active={settings.shading === 'textured'} onClick={() => set({ shading: 'textured' })} />
                  <ModeButton label="Wire" active={settings.shading === 'wireframe'} onClick={() => set({ shading: 'wireframe' })} />
                  <ModeButton label="Clay" active={settings.shading === 'clay'} onClick={() => set({ shading: 'clay' })} />
                  <ModeButton label="NDVI" active={settings.shading === 'ndvi'} onClick={() => set({ shading: 'ndvi' })} />
                </div>
                <Slider label="Rugosidad" value={settings.roughness} min={0} max={1} step={0.05} onChange={v => set({ roughness: v })} />
                <Slider label="Metalicidad" value={settings.metalness} min={0} max={1} step={0.05} onChange={v => set({ metalness: v })} />
              </PanelSection>

              {/* Vegetation */}
              <PanelSection title="Vegetación" icon="🌿" defaultOpen={false}>
                <Slider label="Tinte verde" value={settings.vegetationTint} min={0} max={1} step={0.05} onChange={v => set({ vegetationTint: v })} />
                <p style={{ color: '#6b7280', fontSize: 10, margin: '4px 0 0' }}>
                  Superpone un tono de vegetación sobre la ortofoto. Útil para resaltar zonas verdes en fincas.
                </p>
              </PanelSection>

              {/* Lighting */}
              <PanelSection title="Iluminación" icon="☀️">
                <Slider label="Intensidad sol" value={settings.lightIntensity} min={0} max={3} step={0.1} onChange={v => set({ lightIntensity: v })} />
                <Slider label="Ángulo sol" value={settings.lightAngle} min={0} max={360} step={5} unit="°" onChange={v => set({ lightAngle: v })} />
                <Slider label="Elevación sol" value={settings.lightElevation} min={5} max={85} step={5} unit="°" onChange={v => set({ lightElevation: v })} />
                <Slider label="Luz ambiental" value={settings.ambientIntensity} min={0} max={2} step={0.1} onChange={v => set({ ambientIntensity: v })} />
                <div style={{ marginTop: 4 }}>
                  <span style={{ color: '#9ca3af', fontSize: 11 }}>Entorno</span>
                  <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                    {['sunset', 'dawn', 'night', 'warehouse', 'forest', 'studio', 'city', 'park', 'lobby'].map(p => (
                      <button key={p} onClick={() => set({ envPreset: p })} style={{
                        padding: '3px 6px', border: '1px solid',
                        borderColor: settings.envPreset === p ? '#10B981' : 'rgba(255,255,255,0.1)',
                        borderRadius: 3, background: settings.envPreset === p ? 'rgba(16,185,129,0.2)' : 'transparent',
                        color: settings.envPreset === p ? '#10B981' : '#6b7280',
                        fontSize: 9, cursor: 'pointer', textTransform: 'capitalize',
                      }}>{p}</button>
                    ))}
                  </div>
                </div>
              </PanelSection>

              {/* Camera */}
              <PanelSection title="Cámara" icon="📷" defaultOpen={false}>
                <Slider label="Campo de visión" value={settings.fov} min={20} max={90} step={1} unit="°" onChange={v => set({ fov: v })} />
                <Toggle label="Auto-rotación" value={settings.autoRotate} onChange={v => set({ autoRotate: v })} />
                {settings.autoRotate && (
                  <Slider label="Velocidad" value={settings.autoRotateSpeed} min={0.1} max={5} step={0.1} onChange={v => set({ autoRotateSpeed: v })} />
                )}
              </PanelSection>

              {/* Background */}
              <PanelSection title="Fondo" icon="🖼️" defaultOpen={false}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {['#1a1a2e', '#0f0f14', '#2d1b69', '#1a2e1a', '#2e2e2e', '#f5f5f5', '#87CEEB'].map(c => (
                    <button key={c} onClick={() => set({ bgColor: c })} style={{
                      width: 24, height: 24, borderRadius: 4,
                      background: c, cursor: 'pointer',
                      border: settings.bgColor === c ? '2px solid #10B981' : '1px solid rgba(255,255,255,0.15)',
                    }} />
                  ))}
                </div>
                <Toggle label="Cuadrícula" value={settings.showGrid} onChange={v => set({ showGrid: v })} />
              </PanelSection>

              {/* Info */}
              <PanelSection title="Modelo" icon="ℹ️" defaultOpen={false}>
                {stats && (
                  <div style={{ color: '#9ca3af', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.8 }}>
                    <div>Vértices: <b style={{ color: '#d1d5db' }}>{stats.vertices.toLocaleString()}</b></div>
                    <div>Triángulos: <b style={{ color: '#d1d5db' }}>{stats.triangles.toLocaleString()}</b></div>
                    {meta?.ortho && <div>Textura: <b style={{ color: '#d1d5db' }}>{meta.ortho.width}×{meta.ortho.height}</b></div>}
                    {meta && <div>Centroide: <b style={{ color: '#d1d5db' }}>{meta.centroid[0].toFixed(5)}, {meta.centroid[1].toFixed(5)}</b></div>}
                    {meta && <div>Superficie: <b style={{ color: '#d1d5db' }}>{meta.area_ha.toFixed(2)} ha</b></div>}
                  </div>
                )}
              </PanelSection>
            </aside>
          )}

          {/* ── 3D Viewport ── */}
          <div style={S.viewport}>
            {glbReady === false && (
              <div style={S.noModel}>
                <p style={{ fontSize: 48, margin: 0 }}>📦</p>
                <p style={{ color: '#e4e4e7', fontWeight: 600 }}>Modelo 3D no disponible</p>
                <p style={{ color: '#6b7280', fontSize: 13 }}>Genera el mallado desde el Studio primero.</p>
                <button onClick={() => router.push(`/studio/${tid}`)} style={S.studioBtn}>Ir al Studio →</button>
              </div>
            )}

            {glbReady !== false && (
              <Canvas
                style={{ width: '100%', height: '100%' }}
                camera={{ position: [3, 2, 3], fov: settings.fov }}
                gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
                dpr={[1, 2]}
                shadows
              >
                <color attach="background" args={[settings.bgColor]} />
                <DynamicLight settings={settings} />
                <FOVController fov={settings.fov} />
                <AutoRotate enabled={settings.autoRotate} speed={settings.autoRotateSpeed} controlsRef={controlsRef} />

                <Suspense fallback={<LoadingSpinner />}>
                  {glbReady && (
                    <TerrainMesh
                      url={glbUrl}
                      settings={settings}
                      onStats={setStats}
                      controlsRef={controlsRef}
                      resetRef={resetRef}
                      topRef={topRef}
                    />
                  )}
                </Suspense>

                {settings.showGrid && (
                  <Grid
                    position={[0, stats?.gridY ?? -0.5, 0]}
                    args={[20, 20]}
                    cellSize={0.5}
                    cellThickness={0.6}
                    cellColor="rgba(255,255,255,0.03)"
                    sectionSize={2}
                    sectionThickness={1}
                    sectionColor="#10B981"
                    fadeDistance={12}
                    infiniteGrid
                  />
                )}

                <Environment preset={settings.envPreset as any} />
                <OrbitControls
                  ref={controlsRef as React.Ref<never>}
                  makeDefault
                  enableDamping
                  dampingFactor={0.08}
                  minDistance={0.3}
                  maxDistance={20}
                  minPolarAngle={0}
                  maxPolarAngle={Math.PI}
                />
              </Canvas>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <footer style={S.footer}>
          <span>🖱️ Rotar</span><span>⚙️ Zoom</span><span>Shift+🖱️ Pan</span>
          <span style={{ marginLeft: 'auto', opacity: 0.5 }}>geotwin.es/visor/{tid}</span>
        </footer>
      </div>
    </>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  shell: { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#0f0f14', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: '#0f0f14', borderBottom: '1px solid rgba(255,255,255,0.06)', zIndex: 10 },
  hLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  hRight: { display: 'flex', alignItems: 'center', gap: 4 },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },
  panel: { width: 240, background: '#111118', borderRight: '1px solid rgba(255,255,255,0.06)', overflowY: 'auto', flexShrink: 0 },
  viewport: { flex: 1, position: 'relative' },
  footer: { display: 'flex', alignItems: 'center', gap: 16, padding: '4px 12px', borderTop: '1px solid rgba(255,255,255,0.04)', color: '#4b5563', fontSize: 10 },
  iconBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, background: 'transparent', color: '#d1d5db', fontSize: 13, cursor: 'pointer' },
  studioBtn: { padding: '4px 10px', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 4, background: 'rgba(16,185,129,0.1)', color: '#10B981', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  noModel: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 },
};
