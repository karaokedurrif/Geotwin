import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, ContactShadows, Html, Sky, Bvh } from '@react-three/drei';
import * as THREE from 'three';
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
    <div id="terrain-studio-canvas-container" style={{ width: '100%', height: '100%' }}>
      <Canvas
        shadows
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          alpha: true,
        }}
        camera={{ fov: 45, near: 0.01, far: 5000 }}
        dpr={[1, 2]}
        style={{ background: '#0a0a14' }}
      >
      <Bvh firstHitOnly>
      <Suspense fallback={<LoadingFallback />}>
        <TerrainModel key={effectiveUrl} url={effectiveUrl} geojson={geojson} />
        {viewMode === 'wire_texture' && <WireframeOverlay url={effectiveUrl} />}
        {geojson && <ParcelOutline3D geojson={geojson} />}
      </Suspense>

      <Environment
        preset={lightPreset}
        background={false}
        environmentIntensity={1.2}
        environmentRotation={[0, (lightRotation * Math.PI) / 180, 0]}
      />

      {/* Sky for outdoor lighting context — hidden in night mode */}
      {lightPreset !== 'night' && (
        <Sky
          distance={450000}
          sunPosition={[100, 150, 80]}
          inclination={0}
          azimuth={0.25}
        />
      )}

      <ambientLight intensity={0.35} />
      <directionalLight
        castShadow
        position={[-60, 120, -100]}
        intensity={1.8}
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-far={50}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.001}
      />

      {/* Technical grid — always visible, 1m cells */}
      <Grid
        args={[40, 40]}
        position={[0, 0.001, 0]}
        cellSize={0.05}
        cellThickness={0.6}
        cellColor="#555555"
        sectionSize={0.5}
        sectionThickness={1.2}
        sectionColor="#888888"
        fadeDistance={8}
        infiniteGrid
      />

      <ContactShadows
        position={[0, -0.1, 0]}
        opacity={0.4}
        scale={300}
        blur={3}
        far={10}
        resolution={2048}
        color="#000"
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={0.01}
        maxDistance={200}
        maxPolarAngle={Math.PI * 0.85}
        zoomSpeed={1.5}
      />

      <MeasureTool />
      <AnnotationTool />

      <StudioPostProcessing />
      </Bvh>
    </Canvas>
    </div>
  );
}
