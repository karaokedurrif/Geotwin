import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useStudioStore } from '../store';

export default function AnnotationTool() {
  const annotations = useStudioStore((s) => s.annotations);

  if (annotations.length === 0) return null;

  return (
    <group>
      {annotations.map((ann) => {
        const pos = new THREE.Vector3(...ann.position);
        return (
          <group key={ann.id}>
            <mesh position={pos}>
              <sphereGeometry args={[0.015, 12, 12]} />
              <meshStandardMaterial color="#10B981" roughness={0.5} metalness={0} />
            </mesh>
            <Html position={[pos.x, pos.y + 0.04, pos.z]} center style={{ pointerEvents: 'none' }}>
              <div style={{
                background: 'rgba(16,185,129,0.9)', color: '#fff',
                padding: '3px 8px', borderRadius: 4, fontSize: 11,
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontWeight: 600, whiteSpace: 'nowrap',
                maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {ann.text}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
