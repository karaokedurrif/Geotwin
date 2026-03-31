import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, ContactShadows, Html } from '@react-three/drei';
import TerrainModel from './TerrainModel';
import StudioPostProcessing from './effects/StudioPostProcessing';
import WireframeOverlay from './WireframeOverlay';
import ParcelOutline3D from './ParcelOutline3D';
import MeasureTool from './tools/MeasureTool';
import AnnotationTool from './tools/AnnotationTool';
import { useStudioStore } from './store';

function LoadingFallback() {
  return (
    <Html center>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        color: '#e4e4e7', fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{
          width: 40, height: 40,
          border: '3px solid rgba(16,185,129,0.2)',
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

interface TerrainCanvasProps {
  glbUrl: string;
  geojson?: Record<string, unknown> | null;
}

export default function TerrainCanvas({ glbUrl, geojson }: TerrainCanvasProps) {
  const lightPreset = useStudioStore((s) => s.lightPreset);
  const lightRotation = useStudioStore((s) => s.lightRotation);
  const showGrid = useStudioStore((s) => s.showGrid);
  const viewMode = useStudioStore((s) => s.viewMode);
  const glbOverrideUrl = useStudioStore((s) => s.glbOverrideUrl);
  const effectiveUrl = glbOverrideUrl || glbUrl;

  return (
    <Canvas
      gl={{ antialias: true, toneMapping: 3, toneMappingExposure: 1.0, alpha: true }}
      camera={{ fov: 45, near: 0.01, far: 5000 }}
      dpr={[1, 2]}
      style={{ background: '#0a0a14' }}
    >
      <Suspense fallback={<LoadingFallback />}>
        <TerrainModel key={effectiveUrl} url={effectiveUrl} geojson={geojson} />
        {viewMode === 'wire_texture' && <WireframeOverlay url={effectiveUrl} />}
        {geojson && <ParcelOutline3D geojson={geojson} />}
      </Suspense>

      <Environment
        preset={lightPreset}
        background={false}
        environmentRotation={[0, (lightRotation * Math.PI) / 180, 0]}
      />

      <ambientLight intensity={0.15} />
      <directionalLight position={[5, 8, 3]} intensity={0.6} castShadow />

      {showGrid && (
        <Grid
          args={[20, 20]}
          position={[0, -0.01, 0]}
          cellSize={0.2}
          cellThickness={0.5}
          cellColor="#333"
          sectionSize={1}
          sectionThickness={1}
          sectionColor="#555"
          fadeDistance={15}
          infiniteGrid
        />
      )}

      <ContactShadows
        position={[0, -0.01, 0]}
        opacity={0.3}
        scale={10}
        blur={2}
        far={4}
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={0.1}
        maxDistance={50}
        maxPolarAngle={Math.PI * 0.85}
      />

      <MeasureTool />
      <AnnotationTool />

      <StudioPostProcessing />
    </Canvas>
  );
}
