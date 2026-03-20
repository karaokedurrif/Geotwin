// StatusBar — barra inferior de estado estilo Blender
// Muestra: FPS, coordenadas, altitud, zoom y versión
import { useEffect, useRef, useState } from 'react';
import styles from '@/styles/studio.module.css';

interface StatusBarProps {
  // Referencia al viewer Cesium para leer coords en tiempo real
  viewerRef: unknown | null;
  version: string;
}

interface CesiumViewer {
  scene: {
    globe: {
      ellipsoid: unknown;
      pick: (ray: unknown) => unknown;
    };
    camera: {
      positionCartographic: { latitude: number; longitude: number; height: number };
      getPickRay?: (position: unknown) => unknown;
      heading: number;
      pitch: number;
      roll: number;
    };
    canvas: HTMLCanvasElement;
    pick: (position: unknown) => unknown;
  };
  clock: {
    currentTime: unknown;
    clockStep: number;
  };
  destroy?: () => void;
}

interface CoordState {
  lat: number | null;
  lon: number | null;
  alt: number | null;
  fps: number;
}

export default function StatusBar({ viewerRef, version }: StatusBarProps) {
  const [coords, setCoords] = useState<CoordState>({
    lat: null,
    lon: null,
    alt: null,
    fps: 0,
  });
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);

  useEffect(() => {
    if (!viewerRef) return;
    const viewer = viewerRef as CesiumViewer;

    let running = true;

    const loop = (timestamp: number) => {
      if (!running) return;

      frameCountRef.current += 1;
      const elapsed = timestamp - lastTimeRef.current;

      if (elapsed >= 1000) {
        const fps = Math.round((frameCountRef.current * 1000) / elapsed);
        frameCountRef.current = 0;
        lastTimeRef.current = timestamp;

        try {
          const cam = viewer.scene.camera;
          const pos = cam.positionCartographic;
          const lat = (pos.latitude * 180) / Math.PI;
          const lon = (pos.longitude * 180) / Math.PI;
          const alt = Math.round(pos.height);
          setCoords({ lat, lon, alt, fps });
        } catch {
          setCoords((prev) => ({ ...prev, fps }));
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [viewerRef]);

  const fpsColor =
    coords.fps >= 50 ? '#10B981' : coords.fps >= 30 ? '#F59E0B' : '#EF4444';

  return (
    <div className={styles.statusBar}>
      {/* FPS */}
      <div className={styles.statusItem}>
        <span className={styles.statusLabel}>FPS</span>
        <span className={styles.statusValue} style={{ color: fpsColor }}>
          {coords.fps || '--'}
        </span>
      </div>

      {/* Separador */}
      <span style={{ color: '#2e2e34' }}>|</span>

      {/* Coordenadas */}
      {coords.lat !== null && coords.lon !== null ? (
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>Lat</span>
          <span className={styles.statusValue}>{coords.lat.toFixed(4)}</span>
          <span className={styles.statusLabel} style={{ marginLeft: 8 }}>Lon</span>
          <span className={styles.statusValue}>{coords.lon.toFixed(4)}</span>
        </div>
      ) : (
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>Lat/Lon</span>
          <span className={styles.statusValue}>--</span>
        </div>
      )}

      {/* Separador */}
      <span style={{ color: '#2e2e34' }}>|</span>

      {/* Altitud */}
      <div className={styles.statusItem}>
        <span className={styles.statusLabel}>Alt</span>
        <span className={styles.statusValue}>
          {coords.alt !== null ? `${coords.alt.toLocaleString('es-ES')} m` : '--'}
        </span>
      </div>

      {/* Versión */}
      <span className={styles.statusVersion}>GeoTwin v{version}</span>
    </div>
  );
}
