/**
 * VR/AR Viewer — WebXR page for viewing terrain GLB models.
 *
 * URL: /vr/{twinId}
 *
 * Features:
 *  - Loads terrain_lod0.glb from the API
 *  - Orbit controls (rotate, zoom, pan)
 *  - "Enter VR" button for WebXR headsets (Quest 3, Vive, etc.)
 *  - Apple AR link via <a rel="ar"> for USDZ Quick Look
 *  - Responsive: works on desktop, mobile, and headsets
 */
import { useRouter } from 'next/router';
import { Suspense, useRef, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Grid, Html } from '@react-three/drei';
import { createXRStore, XR } from '@react-three/xr';
import Head from 'next/head';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

const xrStore = createXRStore();

function TerrainModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);

  // Center and scale the model to table size
  useEffect(() => {
    const THREE = require('three');
    const box = new THREE.Box3().setFromObject(scene);
    const center = new THREE.Vector3();
    box.getCenter(center);
    scene.position.sub(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const scale = 2 / maxDim; // Fit to ~2 unit cube
      scene.scale.setScalar(scale);
    }
  }, [scene]);

  return <primitive object={scene} />;
}

function LoadingFallback() {
  return (
    <Html center>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        color: '#e4e4e7',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{
          width: 40,
          height: 40,
          border: '3px solid rgba(16, 185, 129, 0.2)',
          borderTop: '3px solid #10B981',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>Cargando modelo 3D...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </Html>
  );
}

export default function VRViewerPage() {
  const router = useRouter();
  const { twinId } = router.query;
  const [error, setError] = useState<string | null>(null);
  const [glbExists, setGlbExists] = useState<boolean | null>(null);
  const vrButtonRef = useRef<HTMLDivElement>(null);

  const glbUrl = twinId
    ? `${API_BASE}/api/tiles/${encodeURIComponent(twinId as string)}/terrain_lod0.glb`
    : '';

  // Check if GLB file exists
  useEffect(() => {
    if (!twinId) return;
    fetch(glbUrl, { method: 'HEAD' })
      .then(r => {
        if (r.ok) setGlbExists(true);
        else setError('Modelo 3D no disponible. Genera el mallado primero en Studio.');
      })
      .catch(() => setError('No se pudo conectar con el servidor.'));
  }, [twinId, glbUrl]);

  if (!twinId) {
    return (
      <div style={styles.container}>
        <p style={{ color: '#9ca3af' }}>Cargando...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.errorCard}>
          <h2 style={{ margin: 0, fontSize: 18, color: '#ef4444' }}>Error</h2>
          <p style={{ color: '#9ca3af', fontSize: 14 }}>{error}</p>
          <button
            onClick={() => router.push(`/studio/${twinId}`)}
            style={styles.backBtn}
          >
            ← Volver a Studio
          </button>
        </div>
      </div>
    );
  }

  if (glbExists === null) {
    return (
      <div style={styles.container}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e4e4e7' }}>
          <div style={{
            width: 24,
            height: 24,
            border: '2px solid rgba(16, 185, 129, 0.3)',
            borderTop: '2px solid #10B981',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <span>Verificando modelo...</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Geotwin VR — {twinId}</title>
      </Head>

      <div style={styles.container}>
        {/* VR Button overlay */}
        <div ref={vrButtonRef} style={styles.vrButtonWrap}>
          <button onClick={() => xrStore.enterVR()} style={styles.backBtn}>
            🥽 Entrar en VR
          </button>
        </div>

        {/* Header */}
        <div style={styles.header}>
          <button onClick={() => router.push(`/studio/${twinId}`)} style={styles.backLink}>
            ← Studio
          </button>
          <span style={styles.title}>Geotwin VR — {twinId}</span>
          {/* Apple AR Quick Look link */}
          <a
            rel="ar"
            href={`${API_BASE}/api/tiles/${encodeURIComponent(twinId as string)}/terrain.usdz`}
            style={styles.arLink}
          >
            📱 Ver en AR
          </a>
        </div>

        {/* 3D Canvas */}
        <Canvas
          style={{ width: '100%', height: '100%' }}
          camera={{ position: [3, 2, 3], fov: 50 }}
          gl={{ antialias: true, alpha: false }}
        >
          <XR store={xrStore}>
            <color attach="background" args={['#0a0a0e']} />
            <ambientLight intensity={0.4} />
            <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />

            <Suspense fallback={<LoadingFallback />}>
              <TerrainModel url={glbUrl} />
            </Suspense>

            <Grid
              position={[0, -1.01, 0]}
              args={[20, 20]}
              cellSize={0.5}
              cellThickness={0.6}
              cellColor="#1a1a2e"
              sectionSize={2}
              sectionThickness={1}
              sectionColor="#10B981"
              fadeDistance={15}
              infiniteGrid
            />

            <Environment preset="night" />
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              minDistance={0.5}
              maxDistance={20}
              maxPolarAngle={Math.PI / 1.8}
            />
          </XR>
        </Canvas>

        {/* Controls hint */}
        <div style={styles.controls}>
          <span>🖱️ Rotar | ⚙️ Zoom | Shift+🖱️ Desplazar</span>
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    inset: 0,
    background: '#0a0a0e',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    background: 'rgba(10, 10, 14, 0.85)',
    backdropFilter: 'blur(8px)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    zIndex: 10,
  },
  backLink: {
    background: 'none',
    border: 'none',
    color: '#10B981',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '4px 8px',
  },
  title: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: '0.02em',
  },
  arLink: {
    color: '#e4e4e7',
    fontSize: 12,
    textDecoration: 'none',
    padding: '6px 12px',
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
  },
  vrButtonWrap: {
    position: 'absolute',
    bottom: 60,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10,
  },
  errorCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 12,
    padding: '24px 32px',
    background: 'rgba(30, 30, 34, 0.95)',
    borderRadius: 14,
    border: '1px solid rgba(239, 68, 68, 0.3)',
  },
  backBtn: {
    padding: '8px 20px',
    background: 'linear-gradient(135deg, #10B981, #059669)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  controls: {
    position: 'absolute',
    bottom: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    color: '#6B6B73',
    fontSize: 11,
    zIndex: 10,
  },
};
