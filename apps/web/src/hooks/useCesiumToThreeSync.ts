/**
 * useCesiumToThreeSync — Syncs Cesium camera to a React-Three-Fiber camera.
 *
 * When the Cesium viewer zoom (camera height above ground) drops below a
 * threshold (default 200 m), this hook converts the Cesium camera's East-North-Up
 * orientation into Three.js camera position/lookAt in the GLB's local coordinate
 * system (shared via `localOrigin`).
 *
 * This lets the TerrainStudio R3F overlay show sharp 5 cm/px textures while
 * exactly matching the user's Cesium viewport.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { LocalOrigin } from '@/components/terrain-studio/store';

interface CesiumToThreeSyncOptions {
  /** Cesium Viewer instance (window.Cesium populated). */
  cesiumViewer: any;
  /** Three.js camera from useThree(). */
  threeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
  /** Local-coordinate origin shared by GLB and parcel outline. */
  localOrigin: LocalOrigin | null;
  /** The scale applied to the Three.js scene (from TerrainModel centering). */
  sceneScale: { x: number; y: number; z: number } | null;
  /** Distance threshold in meters below which sync is active (default 200). */
  thresholdM?: number;
  /** Callback fired when entering/leaving the sync zone. */
  onActiveChange?: (active: boolean) => void;
}

import * as THREE from 'three';

export function useCesiumToThreeSync({
  cesiumViewer,
  threeCamera,
  localOrigin,
  sceneScale,
  thresholdM = 200,
  onActiveChange,
}: CesiumToThreeSyncOptions) {
  const activeRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const sync = useCallback(() => {
    if (!cesiumViewer || !threeCamera || !localOrigin || !sceneScale) return;

    const Cesium = (window as any).Cesium;
    if (!Cesium || cesiumViewer.isDestroyed?.()) return;

    const cam = cesiumViewer.camera;
    const cartographic = cam.positionCartographic;
    if (!cartographic) return;

    const heightM = cartographic.height;
    const isClose = heightM < thresholdM;

    if (isClose !== activeRef.current) {
      activeRef.current = isClose;
      onActiveChange?.(isClose);
    }

    if (!isClose) return;

    // Convert Cesium camera position (lon, lat, height) to local meters
    const lonDeg = Cesium.Math.toDegrees(cartographic.longitude);
    const latDeg = Cesium.Math.toDegrees(cartographic.latitude);

    const localX = (lonDeg - localOrigin.centroid_lon) * localOrigin.m_per_deg_lon;
    const localY = heightM - localOrigin.min_elev;
    const zSign = localOrigin.z_sign ?? -1;
    const localZ = zSign * (latDeg - localOrigin.centroid_lat) * localOrigin.m_per_deg_lat;

    // Apply the same scene scale that TerrainModel uses
    threeCamera.position.set(
      localX * sceneScale.x,
      localY * sceneScale.y,
      localZ * sceneScale.z,
    );

    // Compute look-at direction from Cesium heading/pitch
    const heading = cam.heading; // radians, 0=north, CW
    const pitch = cam.pitch;     // radians, -PI/2 = straight down, 0 = horizontal

    // In Three.js local coords: X=east, Y=up, -Z=north (glTF forward)
    // Cesium heading: 0=north=-Z, PI/2=east=+X
    const dir = new THREE.Vector3(
      Math.sin(heading) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(heading) * Math.cos(pitch),  // -Z = north
    );

    const target = new THREE.Vector3().copy(threeCamera.position).add(dir);
    threeCamera.lookAt(target);
    threeCamera.updateProjectionMatrix();
  }, [cesiumViewer, threeCamera, localOrigin, sceneScale, thresholdM, onActiveChange]);

  useEffect(() => {
    if (!cesiumViewer) return;

    const tick = () => {
      sync();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [cesiumViewer, sync]);

  return { isActive: activeRef.current };
}
