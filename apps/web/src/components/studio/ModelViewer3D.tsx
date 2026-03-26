/**
 * ModelViewer3D — Three.js mesh inspector (Sketchfab/Tripo3D style).
 *
 * Shows the terrain GLB in a dedicated Three.js viewer with:
 *  - Orbit controls (rotate, zoom, pan)
 *  - Wireframe / Textured / NDVI overlay toggle
 *  - Dark gradient background
 *  - Reference grid underneath
 *  - Close button to dismiss
 *
 * Used as a modal overlay when:
 *  - Mesh processing completes (auto-show)
 *  - User clicks "Mallado 3D" in TopBar
 */
import React, { Suspense, useEffect, useMemo, useState, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Grid, Html } from '@react-three/drei';
import { X, Box, Eye, Grid3x3, Download, Info } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

type ViewMode = 'textured' | 'wireframe';

interface MeshStats {
  vertices: number;
  triangles: number;
}

interface ModelViewer3DProps {
  twinId: string;
  visible: boolean;
  onClose: () => void;
}

function TerrainMesh({ url, viewMode, onStats }: { url: string; viewMode: ViewMode; onStats?: (s: MeshStats) => void }) {
  const { scene } = useGLTF(url);

  // Center and scale
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
      scene.scale.setScalar(2 / maxDim);
    }

    // Collect stats
    let verts = 0;
    let tris = 0;
    scene.traverse((child: any) => {
      if (child.isMesh && child.geometry) {
        const geo = child.geometry;
        verts += geo.attributes.position ? geo.attributes.position.count : 0;
        tris += geo.index ? geo.index.count / 3 : (geo.attributes.position ? geo.attributes.position.count / 3 : 0);
      }
    });
    onStats?.({ vertices: verts, triangles: Math.round(tris) });
  }, [scene, onStats]);

  // Toggle wireframe on all materials
  useEffect(() => {
    scene.traverse((child: any) => {
      if (child.isMesh && child.material) {
        child.material.wireframe = viewMode === 'wireframe';
      }
    });
  }, [scene, viewMode]);

  return <primitive object={scene} />;
}

function LoadingSpinner() {
  return (
    <Html center>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        color: '#e4e4e7', fontFamily: 'system-ui',
      }}>
        <div style={{
          width: 36, height: 36,
          border: '3px solid rgba(16,185,129,0.2)',
          borderTop: '3px solid #10B981',
          borderRadius: '50%',
          animation: 'mv3d-spin 1s linear infinite',
        }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Cargando modelo...</span>
        <style>{`@keyframes mv3d-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </Html>
  );
}

export default function ModelViewer3D({ twinId, visible, onClose }: ModelViewer3DProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('textured');
  const [glbReady, setGlbReady] = useState(false);
  const [meshStats, setMeshStats] = useState<MeshStats | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const glbUrl = useMemo(
    () => `${API_BASE}/api/tiles/${encodeURIComponent(twinId)}/lod0.glb`,
    [twinId],
  );

  // Check if GLB exists
  useEffect(() => {
    if (!visible) return;
    fetch(glbUrl, { method: 'HEAD' })
      .then(r => setGlbReady(r.ok))
      .catch(() => setGlbReady(false));
  }, [visible, glbUrl]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 2000,
      background: 'rgba(10, 10, 14, 0.95)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Box size={16} style={{ color: '#10B981' }} />
          <span style={{ color: '#e4e4e7', fontSize: 14, fontWeight: 700 }}>
            Modelo 3D — {twinId}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setViewMode('textured')}
            style={{
              ...modeBtn,
              background: viewMode === 'textured' ? 'rgba(16,185,129,0.2)' : 'transparent',
              borderColor: viewMode === 'textured' ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.1)',
            }}
            title="Texturizado"
          >
            <Eye size={14} /> Textura
          </button>
          <button
            onClick={() => setViewMode('wireframe')}
            style={{
              ...modeBtn,
              background: viewMode === 'wireframe' ? 'rgba(59,130,246,0.2)' : 'transparent',
              borderColor: viewMode === 'wireframe' ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)',
            }}
            title="Wireframe"
          >
            <Grid3x3 size={14} /> Wireframe
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setShowInfo(!showInfo)}
            style={{
              ...modeBtn,
              background: showInfo ? 'rgba(168,85,247,0.2)' : 'transparent',
              borderColor: showInfo ? 'rgba(168,85,247,0.5)' : 'rgba(255,255,255,0.1)',
            }}
            title="Info del modelo"
          >
            <Info size={14} />
          </button>
          <a
            href={glbUrl}
            download={`${twinId}.glb`}
            style={{
              ...modeBtn,
              textDecoration: 'none',
            }}
            title="Descargar GLB"
          >
            <Download size={14} /> GLB
          </a>
          <button onClick={onClose} style={closeBtn} title="Cerrar">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 3D Canvas */}
      <div style={{ flex: 1, position: 'relative' }}>
        {/* Info overlay */}
        {showInfo && meshStats && (
          <div style={{
            position: 'absolute', bottom: 16, left: 16, zIndex: 10,
            background: 'rgba(10, 10, 14, 0.85)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8, padding: '10px 14px',
            color: '#9ca3af', fontSize: 12, fontFamily: 'monospace',
          }}>
            <div>Vértices: <span style={{ color: '#e4e4e7' }}>{meshStats.vertices.toLocaleString()}</span></div>
            <div>Triángulos: <span style={{ color: '#e4e4e7' }}>{meshStats.triangles.toLocaleString()}</span></div>
          </div>
        )}
        {!glbReady ? (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#9ca3af', fontSize: 14,
          }}>
            Modelo 3D no disponible. Genera el mallado primero.
          </div>
        ) : (
          <Canvas
            style={{ width: '100%', height: '100%' }}
            camera={{ position: [3, 2, 3], fov: 50 }}
            gl={{ antialias: true, alpha: false }}
          >
            <color attach="background" args={['#0a0a0e']} />
            <ambientLight intensity={0.5} />
            <directionalLight position={[5, 8, 5]} intensity={1.0} castShadow />
            <directionalLight position={[-3, 4, -2]} intensity={0.3} />

            <Suspense fallback={<LoadingSpinner />}>
              <TerrainMesh url={glbUrl} viewMode={viewMode} onStats={setMeshStats} />
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
              fadeDistance={12}
              infiniteGrid
            />

            <Environment preset="studio" />
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              minDistance={0.5}
              maxDistance={15}
              maxPolarAngle={Math.PI / 1.8}
            />
          </Canvas>
        )}
      </div>
    </div>
  );
}

const modeBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 10px',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#e4e4e7',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
};

const closeBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  border: 'none',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.06)',
  color: '#9ca3af',
  cursor: 'pointer',
};
