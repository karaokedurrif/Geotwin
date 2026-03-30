import { useRef } from 'react';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useStudioStore } from '../store';

export default function MeasureTool() {
  const activeTool = useStudioStore((s) => s.activeTool);
  const measurements = useStudioStore((s) => s.measurements);
  const pendingPoint = useStudioStore((s) => s.pendingMeasurePoint);

  if (activeTool !== 'measure' && measurements.length === 0) return null;

  return (
    <group>
      {/* Pending point A marker */}
      {pendingPoint && (
        <mesh position={pendingPoint}>
          <sphereGeometry args={[0.02, 16, 16]} />
          <meshStandardMaterial color="#ef4444" roughness={0.5} metalness={0} />
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
              <meshStandardMaterial color="#ef4444" roughness={0.5} metalness={0} />
            </mesh>
            <mesh position={b}>
              <sphereGeometry args={[0.015, 12, 12]} />
              <meshStandardMaterial color="#ef4444" roughness={0.5} metalness={0} />
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
