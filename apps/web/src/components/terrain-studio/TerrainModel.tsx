import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useStudioStore } from './store';

// Matcap texture generated procedurally
function createMatcapTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 2 - 1;
      const ny = (y / size) * 2 - 1;
      const d = Math.sqrt(nx * nx + ny * ny);
      const nz = Math.sqrt(Math.max(0, 1 - d * d));
      const light = Math.max(0, nx * 0.3 + ny * 0.5 + nz * 0.8);
      const i = (y * size + x) * 4;
      const base = Math.floor(180 * light + 40);
      data[i] = Math.min(255, base + 20);
      data[i + 1] = Math.min(255, base + 10);
      data[i + 2] = Math.min(255, base);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

interface TerrainModelProps {
  url: string;
  geojson?: Record<string, unknown> | null;
}

export default function TerrainModel({ url }: TerrainModelProps) {
  const { scene } = useGLTF(url);
  const { camera, invalidate } = useThree();
  const meshRef = useRef<THREE.Group>(null);
  const originalMaterials = useRef<Map<string, THREE.Material>>(new Map());
  const matcapTex = useMemo(() => createMatcapTexture(), []);
  const fpsRef = useRef({ frames: 0, lastTime: performance.now(), fps: 60 });

  const viewMode = useStudioStore((s) => s.viewMode);
  const roughness = useStudioStore((s) => s.roughness);
  const metalness = useStudioStore((s) => s.metalness);
  const envMapIntensity = useStudioStore((s) => s.envMapIntensity);
  const setModelInfo = useStudioStore((s) => s.setModelInfo);
  const activeTool = useStudioStore((s) => s.activeTool);
  const addMeasurement = useStudioStore((s) => s.addMeasurement);
  const addAnnotation = useStudioStore((s) => s.addAnnotation);
  const pendingMeasurePoint = useStudioStore((s) => s.pendingMeasurePoint);
  const setPendingMeasurePoint = useStudioStore((s) => s.setPendingMeasurePoint);

  // Handle clicks on the terrain mesh for tools
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (activeTool === 'orbit') return;
    e.stopPropagation();
    const pt: [number, number, number] = [e.point.x, e.point.y, e.point.z];

    if (activeTool === 'measure') {
      if (!pendingMeasurePoint) {
        setPendingMeasurePoint(pt);
      } else {
        const a = pendingMeasurePoint;
        const dist = Math.sqrt(
          (pt[0] - a[0]) ** 2 + (pt[1] - a[1]) ** 2 + (pt[2] - a[2]) ** 2
        );
        addMeasurement({ id: `m_${Date.now()}`, a, b: pt, meters: dist });
        setPendingMeasurePoint(null);
      }
    } else if (activeTool === 'annotate') {
      const text = prompt('Nota:');
      if (text) {
        addAnnotation({ id: `a_${Date.now()}`, position: pt, text });
      }
    }
  }, [activeTool, pendingMeasurePoint, setPendingMeasurePoint, addMeasurement, addAnnotation]);

  // Center, scale, fit camera on first load
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const center = new THREE.Vector3();
    box.getCenter(center);
    scene.position.sub(center);

    const size = new THREE.Vector3();
    box.getSize(size);
    // Y-up GLB: X=east, Y=elevation, Z=north
    const hzMax = Math.max(size.x, size.z) || 1;
    const scale = 2 / hzMax;
    scene.scale.set(scale, scale, scale);

    // Exaggerate Y (elevation) if very flat — subtle exaggeration to reveal relief
    const yRange = size.y || 0.001;
    const flatRatio = hzMax / yRange;
    if (flatRatio > 10) {
      const yExag = Math.min(flatRatio / 10, 3);
      scene.scale.y = scale * yExag;
    }

    // Recalculate after scaling
    const finalBox = new THREE.Box3().setFromObject(scene);
    const finalCenter = new THREE.Vector3();
    finalBox.getCenter(finalCenter);
    const finalSize = new THREE.Vector3();
    finalBox.getSize(finalSize);
    const maxDim = Math.max(finalSize.x, finalSize.y, finalSize.z);
    const dist = Math.max(maxDim * 2.2, 2);
    camera.position.set(dist * 0.6, dist * 0.5, dist * 0.6);
    camera.lookAt(finalCenter);
    camera.updateProjectionMatrix();

    // Store original materials, enable shadows, optimize textures
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        // Enable shadow casting/receiving for terrain and buildings
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        originalMaterials.current.set(mesh.uuid, mesh.material as THREE.Material);

        // Pro material settings for agronomic terrain
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat) {
          mat.roughness = 0.8;   // Matte finish for terrain
          mat.metalness = 0.1;   // Avoid metallic shine on crops/soil

          // Max anisotropy + LinearFilter for 5cm/px sharpness at close zoom (RTX 5080)
          if (mat.map) {
            mat.map.anisotropy = 16;
            mat.map.minFilter = THREE.LinearFilter;
            mat.map.magFilter = THREE.LinearFilter;
            mat.map.generateMipmaps = false;
            mat.map.needsUpdate = true;
          }
        }
      }
    });

    // Collect model info
    let verts = 0, tris = 0;
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const geo = (child as THREE.Mesh).geometry;
        verts += geo.attributes.position?.count ?? 0;
        tris += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3;
      }
    });
    setModelInfo({ vertices: verts, faces: Math.round(tris) });

    invalidate();
  }, [scene, camera, invalidate, setModelInfo]);

  // Apply view mode changes
  useEffect(() => {
    scene.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      const orig = originalMaterials.current.get(mesh.uuid) as THREE.MeshStandardMaterial | undefined;

      switch (viewMode) {
        case 'textured':
          if (orig) {
            mesh.material = orig.clone();
            (mesh.material as THREE.MeshStandardMaterial).roughness = roughness;
            (mesh.material as THREE.MeshStandardMaterial).metalness = metalness;
            (mesh.material as THREE.MeshStandardMaterial).envMapIntensity = envMapIntensity;
          }
          break;

        case 'wireframe':
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0x10B981,
            wireframe: true,
            roughness: 0.8,
            metalness: 0,
          });
          break;

        case 'wire_texture':
          if (orig) {
            mesh.material = orig.clone();
            (mesh.material as THREE.MeshStandardMaterial).roughness = roughness;
            (mesh.material as THREE.MeshStandardMaterial).wireframe = true;
          }
          break;

        case 'clay':
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0xb8a088,
            roughness: 0.92,
            metalness: 0,
          });
          break;

        case 'elevation': {
          const geo = mesh.geometry;
          const pos = geo.attributes.position;
          if (!pos) break;
          const colors = new Float32Array(pos.count * 3);
          let minY = Infinity, maxY = -Infinity;
          for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
          const range = maxY - minY || 1;
          for (let i = 0; i < pos.count; i++) {
            const t = (pos.getY(i) - minY) / range;
            colors[i * 3] = t * 0.5;
            colors[i * 3 + 1] = t * 0.6 + 0.2;
            colors[i * 3 + 2] = 1.0 - t * 0.5;
          }
          geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          mesh.material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            metalness: 0,
          });
          break;
        }

        case 'slope': {
          const geo = mesh.geometry;
          const pos = geo.attributes.position;
          const norm = geo.attributes.normal;
          if (!pos || !norm) break;
          const colors = new Float32Array(pos.count * 3);
          for (let i = 0; i < pos.count; i++) {
            const ny = Math.abs(norm.getY(i));
            const slopeAngle = Math.acos(Math.min(ny, 1.0)) * (180 / Math.PI);
            const t = Math.min(slopeAngle / 45, 1.0);
            colors[i * 3] = t;
            colors[i * 3 + 1] = 1.0 - t;
            colors[i * 3 + 2] = 0.1;
          }
          geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          mesh.material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            metalness: 0,
          });
          break;
        }

        case 'ndvi': {
          const geo = mesh.geometry;
          const pos = geo.attributes.position;
          if (!pos) break;
          // Fake NDVI colormap based on height (will be replaced with real NDVI data)
          const colors = new Float32Array(pos.count * 3);
          let minY = Infinity, maxY = -Infinity;
          for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
          const range = maxY - minY || 1;
          for (let i = 0; i < pos.count; i++) {
            const t = (pos.getY(i) - minY) / range;
            // NDVI colormap: brown → yellow → green
            if (t < 0.3) {
              colors[i * 3] = 0.6;
              colors[i * 3 + 1] = 0.3;
              colors[i * 3 + 2] = 0.1;
            } else if (t < 0.6) {
              const s = (t - 0.3) / 0.3;
              colors[i * 3] = 0.6 + s * 0.4;
              colors[i * 3 + 1] = 0.3 + s * 0.5;
              colors[i * 3 + 2] = 0.1;
            } else {
              const s = (t - 0.6) / 0.4;
              colors[i * 3] = 0.2 - s * 0.15;
              colors[i * 3 + 1] = 0.5 + s * 0.4;
              colors[i * 3 + 2] = 0.1;
            }
          }
          geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          mesh.material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.9,
            metalness: 0,
          });
          break;
        }

        case 'matcap':
          mesh.material = new THREE.MeshMatcapMaterial({ matcap: matcapTex });
          break;
      }

      (mesh.material as THREE.Material).needsUpdate = true;
    });
    invalidate();
  }, [viewMode, roughness, metalness, envMapIntensity, scene, invalidate, matcapTex]);

  // FPS counter — exposed via store for status bar
  useFrame(() => {
    const now = performance.now();
    fpsRef.current.frames++;
    if (now - fpsRef.current.lastTime >= 1000) {
      fpsRef.current.fps = fpsRef.current.frames;
      fpsRef.current.frames = 0;
      fpsRef.current.lastTime = now;
      setModelInfo({ fps: fpsRef.current.fps });
    }
  });

  return <primitive ref={meshRef} object={scene} onClick={handleClick} />;
}
