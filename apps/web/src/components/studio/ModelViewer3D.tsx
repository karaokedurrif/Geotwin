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
import { X, Box, Eye, Grid3x3, Download, Info, RotateCcw, Compass } from 'lucide-react';

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
  onOpenStudio?: () => void;
}

function TerrainMesh({ url, viewMode, onStats, controlsRef, resetCameraRef, topViewRef }: {
  url: string; viewMode: ViewMode; onStats?: (s: MeshStats) => void;
  controlsRef: React.RefObject<unknown>;
  resetCameraRef?: React.MutableRefObject<(() => void) | null>;
  topViewRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const { scene } = useGLTF(url);
  const { camera, invalidate } = useThree();

  // Center, scale, and auto-fit camera + OrbitControls target
  useEffect(() => {
    const THREE = require('three');
    const box = new THREE.Box3().setFromObject(scene);
    const center = new THREE.Vector3();
    box.getCenter(center);
    scene.position.sub(center);
    const size = new THREE.Vector3();
    box.getSize(size);

    // GLB is Y-up: X=east, Y=elevation, Z=north. Exaggerate Y to see relief.
    const hzMax = Math.max(size.x, size.z) || 1;
    const yRange = size.y || 0.001;
    const flatRatio = hzMax / yRange;

    const baseScale = 2 / hzMax;
    scene.scale.set(baseScale, baseScale, baseScale);

    // If terrain is very flat, exaggerate Y (elevation) so relief is visible
    if (flatRatio > 10) {
      const yExag = Math.min(flatRatio / 5, 8);
      scene.scale.y = baseScale * yExag;
    }

    // Auto-fit camera to see the full model
    const finalBox = new THREE.Box3().setFromObject(scene);
    const finalCenter = new THREE.Vector3();
    finalBox.getCenter(finalCenter);
    const finalSize = new THREE.Vector3();
    finalBox.getSize(finalSize);
    const maxDim = Math.max(finalSize.x, finalSize.y, finalSize.z);
    const dist = Math.max(maxDim * 1.8, 2);
    camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
    camera.updateProjectionMatrix();

    // Update OrbitControls target so it orbits around the mesh center
    // OrbitControls ref is set by the parent Canvas via controlsRef
    const ctrl = controlsRef.current as { target?: { copy(v: unknown): void }; update?(): void } | null;
    if (ctrl?.target) {
      ctrl.target.copy(finalCenter);
      ctrl.update?.();
    } else {
      camera.lookAt(finalCenter);
    }

    invalidate();

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

    // Expose reset callbacks via refs for toolbar buttons
    if (resetCameraRef) {
      resetCameraRef.current = () => {
        camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
        camera.updateProjectionMatrix();
        const c = controlsRef.current as { target?: { copy(v: unknown): void }; update?(): void } | null;
        if (c?.target) { c.target.copy(finalCenter); c.update?.(); }
        invalidate();
      };
    }
    if (topViewRef) {
      topViewRef.current = () => {
        camera.position.set(finalCenter.x, dist * 1.2, finalCenter.z);
        camera.updateProjectionMatrix();
        const c = controlsRef.current as { target?: { copy(v: unknown): void }; update?(): void } | null;
        if (c?.target) { c.target.copy(finalCenter); c.update?.(); }
        invalidate();
      };
    }
  }, [scene, camera, invalidate, onStats, controlsRef, resetCameraRef, topViewRef]);

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

export default function ModelViewer3D({ twinId, visible, onClose, onOpenStudio }: ModelViewer3DProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('textured');
  const [glbReady, setGlbReady] = useState(false);
  const [meshStats, setMeshStats] = useState<MeshStats | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const controlsRef = useRef<unknown>(null);
  const cameraResetRef = useRef<(() => void) | null>(null);
  const cameraTopRef = useRef<(() => void) | null>(null);

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
          <button
            onClick={() => cameraResetRef.current?.()}
            style={{ ...modeBtn }}
            title="Reset vista isométrica"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={() => cameraTopRef.current?.()}
            style={{ ...modeBtn }}
            title="Vista cenital (planta)"
          >
            <Compass size={14} />
          </button>
          <button onClick={onClose} style={closeBtn} title="Cerrar">
            <X size={18} />
          </button>
          {onOpenStudio && (
            <button
              onClick={onOpenStudio}
              title="Abrir Terrain Studio"
              style={{
                ...modeBtn,
                background: 'rgba(16,185,129,0.15)',
                border: '1px solid rgba(16,185,129,0.4)',
                color: '#10B981',
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Studio
            </button>
          )}
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
              <TerrainMesh url={glbUrl} viewMode={viewMode} onStats={setMeshStats} controlsRef={controlsRef} resetCameraRef={cameraResetRef} topViewRef={cameraTopRef} />
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
              ref={controlsRef as React.Ref<never>}
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
