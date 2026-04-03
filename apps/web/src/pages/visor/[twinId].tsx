/**
 * GeoTwin Visor — standalone 3D terrain viewer.
 * URL: /visor/{twinId}
 *
 * Full-screen Three.js viewer with orbit controls, textured/wireframe toggle,
 * download GLB, and shareable URL. No studio chrome — just the model.
 */
import { useRouter } from 'next/router';
import { Suspense, useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import Head from 'next/head';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

type ViewMode = 'textured' | 'wireframe';

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

/* ── Terrain Model ─────────────────────────────────────────── */

function TerrainMesh({
  url,
  viewMode,
  onStats,
  controlsRef,
  resetRef,
  topRef,
}: {
  url: string;
  viewMode: ViewMode;
  onStats?: (s: MeshStats) => void;
  controlsRef: React.RefObject<unknown>;
  resetRef?: React.MutableRefObject<(() => void) | null>;
  topRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const { scene } = useGLTF(url);
  const { camera, invalidate } = useThree();

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

    const baseScale = 2 / hzMax;
    scene.scale.set(baseScale, baseScale, baseScale);

    // Gentle vertical exaggeration for flat terrain
    if (flatRatio > 10) {
      const yExag = flatRatio > 25
        ? Math.min(flatRatio / 25, 2.0)
        : Math.min(flatRatio / 15, 2.5);
      scene.scale.y = baseScale * yExag;
    }

    // Camera auto-fit
    const fb = new THREE.Box3().setFromObject(scene);
    const fc = new THREE.Vector3();
    fb.getCenter(fc);
    const fs = new THREE.Vector3();
    fb.getSize(fs);
    const maxDim = Math.max(fs.x, fs.y, fs.z);
    const dist = Math.max(maxDim * 1.8, 2);

    camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
    camera.updateProjectionMatrix();

    const ctrl = controlsRef.current as { target?: { copy(v: unknown): void }; update?(): void } | null;
    if (ctrl?.target) { ctrl.target.copy(fc); ctrl.update?.(); }
    else { camera.lookAt(fc); }

    invalidate();

    // Sharpen textures + collect stats
    let verts = 0, tris = 0;
    scene.traverse((child: any) => {
      if (child.isMesh && child.geometry) {
        const geo = child.geometry;
        verts += geo.attributes.position?.count ?? 0;
        tris += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3;

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

    // Toolbar camera callbacks
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
  }, [scene, camera, invalidate, onStats, controlsRef, resetRef, topRef]);

  useEffect(() => {
    scene.traverse((child: any) => {
      if (child.isMesh && child.material) {
        child.material.wireframe = viewMode === 'wireframe';
      }
    });
  }, [scene, viewMode]);

  return <primitive object={scene} />;
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

/* ── Visor Page ────────────────────────────────────────────── */

export default function VisorPage() {
  const router = useRouter();
  const { twinId } = router.query;
  const tid = typeof twinId === 'string' ? twinId : '';

  const [viewMode, setViewMode] = useState<ViewMode>('textured');
  const [glbReady, setGlbReady] = useState<boolean | null>(null);
  const [stats, setStats] = useState<MeshStats | null>(null);
  const [meta, setMeta] = useState<PipelineMeta | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const controlsRef = useRef<unknown>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const topRef = useRef<(() => void) | null>(null);

  const glbUrl = useMemo(
    () => tid ? `${API_BASE}/api/tiles/${encodeURIComponent(tid)}/lod0.glb` : '',
    [tid],
  );

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

      <div style={styles.shell}>
        {/* ── Top bar ── */}
        <header style={styles.header}>
          <div style={styles.headerLeft}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            <span style={styles.brand}>GeoTwin Visor</span>
            <span style={styles.twinLabel}>{tid}</span>
            {meta && (
              <span style={styles.areaLabel}>{meta.area_ha.toFixed(1)} ha</span>
            )}
          </div>

          <div style={styles.headerCenter}>
            <button
              onClick={() => setViewMode('textured')}
              style={{ ...styles.btn, ...(viewMode === 'textured' ? styles.btnActive : {}) }}
            >
              🖼️ Textura
            </button>
            <button
              onClick={() => setViewMode('wireframe')}
              style={{ ...styles.btn, ...(viewMode === 'wireframe' ? styles.btnWire : {}) }}
            >
              🔲 Wireframe
            </button>
          </div>

          <div style={styles.headerRight}>
            <button onClick={() => setShowInfo(!showInfo)} style={styles.iconBtn} title="Información">
              ℹ️
            </button>
            <button onClick={() => resetRef.current?.()} style={styles.iconBtn} title="Vista isométrica">
              🔄
            </button>
            <button onClick={() => topRef.current?.()} style={styles.iconBtn} title="Vista cenital">
              🧭
            </button>
            <a href={glbUrl} download={`${tid}.glb`} style={{ ...styles.iconBtn, textDecoration: 'none' }} title="Descargar GLB">
              📥
            </a>
            <button onClick={() => router.push(`/studio/${tid}`)} style={styles.studioBtn} title="Abrir Studio">
              ← Studio
            </button>
          </div>
        </header>

        {/* ── 3D Viewport ── */}
        <div style={styles.viewport}>
          {/* Info overlay */}
          {showInfo && (stats || meta) && (
            <div style={styles.infoPanel}>
              {stats && (
                <>
                  <div>Vértices: <b>{stats.vertices.toLocaleString()}</b></div>
                  <div>Triángulos: <b>{stats.triangles.toLocaleString()}</b></div>
                </>
              )}
              {meta?.ortho && (
                <div>Textura: <b>{meta.ortho.width}×{meta.ortho.height} px</b></div>
              )}
              {meta && (
                <div>Centroide: <b>{meta.centroid[0].toFixed(5)}, {meta.centroid[1].toFixed(5)}</b></div>
              )}
            </div>
          )}

          {glbReady === false && (
            <div style={styles.noModel}>
              <p style={{ fontSize: 48, margin: 0 }}>📦</p>
              <p style={{ color: '#e4e4e7', fontWeight: 600, fontSize: 16 }}>Modelo 3D no disponible</p>
              <p style={{ color: '#6b7280', fontSize: 13 }}>Genera el mallado desde el Studio primero.</p>
              <button onClick={() => router.push(`/studio/${tid}`)} style={styles.studioBtn}>
                Ir al Studio →
              </button>
            </div>
          )}

          {glbReady !== false && (
            <Canvas
              style={{ width: '100%', height: '100%' }}
              camera={{ position: [3, 2, 3], fov: 50 }}
              gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
              dpr={[1, 2]}
            >
              <color attach="background" args={['#0f0f14']} />
              <ambientLight intensity={0.5} />
              <directionalLight
                position={[5, 8, 5]}
                intensity={1.0}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
              />
              <directionalLight position={[-3, 4, -2]} intensity={0.3} />

              <Suspense fallback={<LoadingSpinner />}>
                {glbReady && (
                  <TerrainMesh
                    url={glbUrl}
                    viewMode={viewMode}
                    onStats={setStats}
                    controlsRef={controlsRef}
                    resetRef={resetRef}
                    topRef={topRef}
                  />
                )}
              </Suspense>

              <Grid
                position={[0, stats?.gridY ?? -0.5, 0]}
                args={[20, 20]}
                cellSize={0.5}
                cellThickness={0.6}
                cellColor="#1a1a2e"
                sectionSize={2}
                sectionThickness={1}
                sectionColor="#10B981"
                fadeDistance={12}
                infiniteGrid
              />

              <Environment preset="studio" />
              <OrbitControls
                ref={controlsRef as React.Ref<never>}
                makeDefault
                enableDamping
                dampingFactor={0.08}
                minDistance={0.3}
                maxDistance={20}
                maxPolarAngle={Math.PI / 1.8}
              />
            </Canvas>
          )}
        </div>

        {/* ── Footer ── */}
        <footer style={styles.footer}>
          <span>🖱️ Rotar</span>
          <span>⚙️ Zoom</span>
          <span>Shift+🖱️ Desplazar</span>
          <span style={{ marginLeft: 'auto', opacity: 0.5 }}>geotwin.es/visor/{tid}</span>
        </footer>
      </div>
    </>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  shell: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    background: '#0f0f14',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    background: 'rgba(15, 15, 20, 0.95)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    zIndex: 10,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  headerCenter: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  brand: {
    color: '#10B981',
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  twinLabel: {
    color: '#9ca3af',
    fontSize: 12,
    fontFamily: 'monospace',
    background: 'rgba(255,255,255,0.05)',
    padding: '2px 8px',
    borderRadius: 4,
  },
  areaLabel: {
    color: '#6b7280',
    fontSize: 11,
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 12px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    background: 'transparent',
    color: '#e4e4e7',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnActive: {
    background: 'rgba(16,185,129,0.15)',
    borderColor: 'rgba(16,185,129,0.4)',
  },
  btnWire: {
    background: 'rgba(59,130,246,0.15)',
    borderColor: 'rgba(59,130,246,0.4)',
  },
  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    background: 'transparent',
    color: '#e4e4e7',
    fontSize: 14,
    cursor: 'pointer',
  },
  studioBtn: {
    padding: '5px 12px',
    border: '1px solid rgba(16,185,129,0.3)',
    borderRadius: 6,
    background: 'rgba(16,185,129,0.1)',
    color: '#10B981',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  viewport: {
    flex: 1,
    position: 'relative',
  },
  noModel: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  infoPanel: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    zIndex: 10,
    background: 'rgba(10, 10, 14, 0.9)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#9ca3af',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 1.8,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '6px 16px',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    color: '#6b7280',
    fontSize: 11,
  },
};
