import { useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

interface WireframeOverlayProps {
  url: string;
}

export default function WireframeOverlay({ url }: WireframeOverlayProps) {
  const { scene } = useGLTF(url);

  useEffect(() => {
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const wireGeo = mesh.geometry.clone();
        const wireMat = new THREE.MeshBasicMaterial({
          color: 0x10B981,
          wireframe: true,
          transparent: true,
          opacity: 0.3,
          depthTest: true,
        });
        const wireMesh = new THREE.Mesh(wireGeo, wireMat);
        wireMesh.name = '_wireOverlay';
        mesh.add(wireMesh);
      }
    });

    return () => {
      scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const overlay = mesh.getObjectByName('_wireOverlay');
          if (overlay) {
            mesh.remove(overlay);
            (overlay as THREE.Mesh).geometry.dispose();
            ((overlay as THREE.Mesh).material as THREE.Material).dispose();
          }
        }
      });
    };
  }, [scene]);

  return null;
}
