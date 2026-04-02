import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { useStudioStore } from './store';

/* ------------------------------------------------------------------ */
/* BuildingChild — loads a single building_*.glb, adds debug helpers  */
/* ------------------------------------------------------------------ */
function BuildingChild({ url, debug }: { url: string; debug?: boolean }) {
  const { scene } = useGLTF(url);
  const { invalidate } = useThree();

  useEffect(() => {
    if (!scene) return;

    // Mark every mesh as building so view-mode traversals skip it
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.userData._isBuilding = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat) {
          // Technical wireframe — light gray solid
          mat.color = new THREE.Color(0xE0E0E0);
          mat.roughness = 0.95;
          mat.metalness = 0.0;
          mat.envMapIntensity = 0.6;
          mat.side = THREE.DoubleSide;
          mat.normalMap = null;
          mat.map = null;
          mat.needsUpdate = true;
        }

        // Add thick EdgesGeometry overlay (Line2 for GPU-based wide lines)
        const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
        const positions = edges.attributes.position.array as Float32Array;
        const lineGeo = new LineSegmentsGeometry();
        lineGeo.setPositions(positions);
        const lineMat = new LineMaterial({
          color: 0x1a1a1a,
          linewidth: 3,       // pixels — works via Line2 shader
          worldUnits: false,
          resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
        });
        const wireframe = new LineSegments2(lineGeo, lineMat);
        wireframe.name = '_edge_overlay';
        wireframe.raycast = () => {};
        mesh.add(wireframe);
      }
    });

    // Debug helpers
    if (debug) {
      const box = new THREE.Box3().setFromObject(scene);
      const boxHelper = new THREE.Box3Helper(box, new THREE.Color(0xff0000));
      boxHelper.name = '_bldg_debug_box';
      scene.add(boxHelper);

      const center = new THREE.Vector3();
      box.getCenter(center);
      // scale-aware size: helper length = max building dimension
      const sz = new THREE.Vector3();
      box.getSize(sz);
      const axes = new THREE.AxesHelper(Math.max(sz.x, sz.y, sz.z) * 0.6);
      axes.position.copy(center);
      axes.name = '_bldg_debug_axes';
      scene.add(axes);

      console.log(
        `[Building] ${url.split('/').pop()} bbox: X=[${box.min.x.toFixed(1)}..${box.max.x.toFixed(1)}] Y=[${box.min.y.toFixed(1)}..${box.max.y.toFixed(1)}] Z=[${box.min.z.toFixed(1)}..${box.max.z.toFixed(1)}]`
      );
    }

    invalidate();

    return () => {
      // Clean up debug helpers and edge overlays on unmount
      const toRemove: THREE.Object3D[] = [];
      scene.traverse((c) => {
        if (c.name.startsWith('_bldg_debug_') || c.name === '_edge_overlay') toRemove.push(c);
      });
      toRemove.forEach((c) => c.parent?.remove(c));
    };
  }, [scene, url, debug, invalidate]);

  return <primitive object={scene} />;
}

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
  const [buildingUrls, setBuildingUrls] = useState<string[]>([]);

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

    // Rotate 180° around Y to fix mirrored orientation
    scene.rotation.y = Math.PI;

    const size = new THREE.Vector3();
    box.getSize(size);
    // Y-up GLB: X=east, Y=elevation, Z=north
    const hzMax = Math.max(size.x, size.z) || 1;
    const scale = 2 / hzMax;
    scene.scale.set(scale, scale, scale);

    // Y-exaggeration disabled — terrain is flattened in the pipeline.
    // Any exaggeration would amplify floating-point noise on the flat plane.

    // Recalculate after scaling
    const finalBox = new THREE.Box3().setFromObject(scene);
    const finalCenter = new THREE.Vector3();
    finalBox.getCenter(finalCenter);
    const finalSize = new THREE.Vector3();
    finalBox.getSize(finalSize);
    const maxDim = Math.max(finalSize.x, finalSize.y, finalSize.z);
    const dist = Math.max(maxDim * 2.2, 2);
    // Camera at NW (+X=East, +Y=Up, -Z=North): view from South looking North
    // This matches standard map orientation (North = top of screen)
    camera.position.set(finalCenter.x - dist * 0.3, finalCenter.y + dist * 0.7, finalCenter.z + dist * 0.6);
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

        // Detect special scene elements by node name (from GLB node_name)
        const n = (mesh.name || '').toLowerCase();
        const pn = (mesh.parent?.name || '').toLowerCase();
        const isGallinero = n.includes('gallinero') || pn.includes('gallinero');
        const isGCP = n.includes('gcp') || pn.includes('gcp');
        const isWall = n.includes('perimeter') || pn.includes('perimeter');

        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (isGallinero && mat) {
          // Gallinero zone: cyan emissive rectangle
          mat.color = new THREE.Color(0x00CCCC);
          mat.emissive = new THREE.Color(0x003333);
          mat.roughness = 0.6;
          mat.metalness = 0.0;
          mat.transparent = true;
          mat.opacity = 0.75;
          mat.side = THREE.DoubleSide;
          mat.map = null;
          mat.normalMap = null;
          mat.needsUpdate = true;
          mesh.userData._isGallinero = true;
        } else if (isGCP && mat) {
          // GCP markers: bright red emissive
          mat.color = new THREE.Color(0xDC2828);
          mat.emissive = new THREE.Color(0x661010);
          mat.roughness = 0.7;
          mat.metalness = 0.0;
          mat.map = null;
          mat.normalMap = null;
          mat.needsUpdate = true;
          mesh.userData._isGCP = true;
        } else if (isWall && mat) {
          // Perimeter wall: white blueprint line
          mat.color = new THREE.Color(0xFFFFFF);
          mat.emissive = new THREE.Color(0x444444);
          mat.roughness = 1.0;
          mat.metalness = 0.0;
          mat.map = null;
          mat.normalMap = null;
          mat.needsUpdate = true;
          mesh.userData._isWall = true;
        } else if (mat) {
          // Default: Technical wireframe mode — dark gray neutral ground
          mat.color = new THREE.Color(0x2C2C2C);
          mat.roughness = 0.95;
          mat.metalness = 0.0;
          mat.map = null;          // strip satellite ortho
          mat.normalMap = null;
          mat.needsUpdate = true;
        }
      }
    });

    // Collect model info
    let verts = 0, tris = 0;
    const buildingBox = new THREE.Box3();
    let hasBuildingGeometry = false;
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const geo = mesh.geometry;
        verts += geo.attributes.position?.count ?? 0;
        tris += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3;

        // Detect building meshes: small vertex count + _isBuilding flag or name hint
        const vertCount = geo.attributes.position?.count ?? 0;
        const isBuilding =
          mesh.userData._isBuilding ||
          mesh.name.toLowerCase().includes('building') ||
          (vertCount > 0 && vertCount <= 100);
        if (isBuilding && vertCount > 0) {
          mesh.userData._isBuilding = true;
          geo.computeBoundingBox();
          if (geo.boundingBox) {
            buildingBox.expandByObject(mesh);
            hasBuildingGeometry = true;
          }
        }
      }
    });
    setModelInfo({ vertices: verts, faces: Math.round(tris) });

    // If buildings exist, re-target camera closer to building complex
    if (hasBuildingGeometry && !buildingBox.isEmpty()) {
      const bCenter = new THREE.Vector3();
      buildingBox.getCenter(bCenter);
      const bSize = new THREE.Vector3();
      buildingBox.getSize(bSize);
      const bMaxDim = Math.max(bSize.x, bSize.y, bSize.z);
      // Only refocus if buildings are significantly smaller than terrain
      if (bMaxDim < maxDim * 0.5 && bMaxDim > 0.001) {
        const bDist = Math.max(bMaxDim * 4, 0.3);
        camera.position.set(
          bCenter.x - bDist * 0.3,
          bCenter.y + bDist * 0.8,
          bCenter.z + bDist * 0.5
        );
        camera.lookAt(bCenter);
        camera.updateProjectionMatrix();
        console.log(
          `[TerrainModel] Camera re-targeted to building complex: ` +
            `center=(${bCenter.x.toFixed(2)}, ${bCenter.y.toFixed(2)}, ${bCenter.z.toFixed(2)}), ` +
            `size=(${bSize.x.toFixed(1)}×${bSize.y.toFixed(1)}×${bSize.z.toFixed(1)})`
        );
      }
    }

    invalidate();
  }, [scene, camera, invalidate, setModelInfo]);

  // Discover and load building GLBs that sit alongside the terrain GLB
  useEffect(() => {
    const basePath = url.substring(0, url.lastIndexOf('/'));
    const probes = Array.from({ length: 10 }, (_, i) => `${basePath}/building_${i}.glb`);

    Promise.all(
      probes.map((bUrl) =>
        fetch(bUrl, { method: 'HEAD' })
          .then((r) => (r.ok ? bUrl : null))
          .catch(() => null)
      )
    ).then((results) => {
      const valid = results.filter((u): u is string => u !== null);
      if (valid.length > 0) {
        console.log(`[TerrainModel] Found ${valid.length} building GLB(s):`, valid);
      }
      setBuildingUrls(valid);
    });
  }, [url]);

  // Apply view mode changes
  useEffect(() => {
    scene.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      // Skip building meshes — they keep their own material
      if (child.userData._isBuilding) return;
      // Skip special blueprint elements (gallinero, GCPs, perimeter wall)
      if (child.userData._isGallinero || child.userData._isGCP || child.userData._isWall) return;
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

  return (
    <primitive ref={meshRef} object={scene} onClick={handleClick}>
      {/* Buildings are children of the terrain scene → inherit position/scale */}
      {buildingUrls.map((bUrl) => (
        <BuildingChild key={bUrl} url={bUrl} debug />
      ))}
    </primitive>
  );
}
