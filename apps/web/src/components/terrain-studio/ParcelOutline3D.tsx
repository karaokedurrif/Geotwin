import { useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { useStudioStore } from './store';

interface ParcelOutline3DProps {
  geojson: Record<string, unknown>;
}

/**
 * Renders the cadastral parcel outline as a glowing 3D line on the terrain.
 * Uses the engine's local_origin (from pipeline_result.json) to convert
 * GeoJSON lon/lat to the same local coordinate system as the GLB,
 * guaranteeing perfect alignment (shared RTC_CENTER).
 */
export default function ParcelOutline3D({ geojson }: ParcelOutline3DProps) {
  const { scene } = useThree();
  const localOrigin = useStudioStore((s) => s.localOrigin);

  const points = useMemo(() => {
    const geometry = (geojson as Record<string, unknown>).geometry as
      | { type: string; coordinates: unknown }
      | undefined;
    if (!geometry) return null;

    let ring: number[][] = [];
    if (geometry.type === 'Polygon') {
      ring = (geometry.coordinates as number[][][])[0];
    } else if (geometry.type === 'MultiPolygon') {
      ring = (geometry.coordinates as unknown as number[][][][])[0][0];
    }
    if (!ring || ring.length < 3) return null;

    // Find the terrain mesh to get its transform
    let terrainMesh: THREE.Mesh | null = null;
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && !terrainMesh) {
        terrainMesh = child as THREE.Mesh;
      }
    });

    if (!terrainMesh) return null;

    // Use the engine's local_origin if available (exact match with GLB centroid).
    // Fallback: compute centroid from the ring itself (legacy path).
    let centLon: number, centLat: number, mPerDegLon: number, mPerDegLat: number;
    if (localOrigin) {
      centLon = localOrigin.centroid_lon;
      centLat = localOrigin.centroid_lat;
      mPerDegLon = localOrigin.m_per_deg_lon;
      mPerDegLat = localOrigin.m_per_deg_lat;
    } else {
      const lons = ring.map((p) => p[0]);
      const lats = ring.map((p) => p[1]);
      centLon = lons.reduce((a, b) => a + b, 0) / lons.length;
      centLat = lats.reduce((a, b) => a + b, 0) / lats.length;
      const latRad = (centLat * Math.PI) / 180;
      mPerDegLon = 111320 * Math.cos(latRad);
      mPerDegLat = 111320;
    }

    // Convert to local meters (X=east, Y=0, Z=north) — same system as GLB
    const pts: [number, number, number][] = ring.map((p) => {
      const x = (p[0] - centLon) * mPerDegLon;
      const z = (p[1] - centLat) * mPerDegLat;
      return [x, 0.02, z] as [number, number, number];
    });

    // Scale to match the terrain mesh scale
    const meshParent = (terrainMesh as THREE.Mesh).parent;
    if (meshParent) {
      const s = meshParent.scale;
      pts.forEach((p) => {
        p[0] *= s.x;
        p[1] *= s.y;
        p[2] *= s.z;
      });
    }

    // Close the ring
    if (pts.length > 0) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1] || first[2] !== last[2]) {
        pts.push([...first]);
      }
    }

    return pts;
  }, [geojson, scene, localOrigin]);

  if (!points || points.length < 2) return null;

  return (
    <group>
      {/* Glow pass */}
      <Line points={points} color="#10B981" transparent opacity={0.3} lineWidth={3} />
      {/* Solid pass */}
      <Line points={points} color="#10B981" lineWidth={1.5} />
    </group>
  );
}
