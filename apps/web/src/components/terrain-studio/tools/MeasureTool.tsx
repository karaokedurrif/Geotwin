import { useState, useCallback, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useStudioStore } from '../store';

export default function MeasureTool() {
  const activeTool = useStudioStore((s) => s.activeTool);
  const addMeasurement = useStudioStore((s) => s.addMeasurement);
  const measurements = useStudioStore((s) => s.measurements);
  const { scene, camera, raycaster } = useThree();
  const [pointA, setPointA] = useState<THREE.Vector3 | null>(null);
  const pointerRef = useRef<THREE.Vector2>(new THREE.Vector2());

  const handleClick = useCallback((event: { point: THREE.Vector3 }) => {
    if (activeTool !== 'measure') return;

    if (!pointA) {
      setPointA(event.point.clone());
    } else {
      const b = event.point.clone();
      const dist = pointA.distanceTo(b);
      addMeasurement({
        id: `m_${Date.now()}`,
        a: [pointA.x, pointA.y, pointA.z],
        b: [b.x, b.y, b.z],
        meters: dist,
      });
      setPointA(null);
    }
  }, [activeTool, pointA, addMeasurement]);

  if (activeTool !== 'measure') return null;

  return (
    <group>
      {/* Invisible click target covering the scene */}
      {/* Point A marker */}
      {pointA && (
        <mesh position={pointA}>
          <sphereGeometry args={[0.02, 16, 16]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
      )}

      {/* Completed measurements */}
      {measurements.map((m) => {
        const a = new THREE.Vector3(...m.a);
        const b = new THREE.Vector3(...m.b);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        return (
          <group key={m.id}>
            <mesh position={a}>
              <sphereGeometry args={[0.015, 12, 12]} />
              <meshBasicMaterial color="#ef4444" />
            </mesh>
            <mesh position={b}>
              <sphereGeometry args={[0.015, 12, 12]} />
              <meshBasicMaterial color="#ef4444" />
            </mesh>
            <Line
              points={[a.toArray(), b.toArray()]}
              color="#facc15"
              lineWidth={1.5}
            />
            <Html position={mid} center style={{ pointerEvents: 'none' }}>
              <div style={{
                background: 'rgba(0,0,0,0.8)', color: '#facc15',
                padding: '2px 6px', borderRadius: 4, fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: 'nowrap',
              }}>
                {m.meters.toFixed(1)} m
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
