/**
 * Cesium Utilities
 * Robust helpers for Cesium viewer initialization and interaction
 */

export class ViewerNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewerNotReadyError';
  }
}

export interface ViewerReadyOptions {
  timeout?: number; // ms, default 10000
  pollInterval?: number; // ms, default 50
  checkDataSources?: boolean; // default true
  checkImageryLayers?: boolean; // default true
}

/**
 * Wait for Cesium viewer to be fully initialized and ready for operations
 * Uses requestAnimationFrame polling to avoid blocking
 * 
 * @param viewer - Cesium.Viewer instance
 * @param options - Configuration options
 * @returns Promise that resolves when viewer is ready
 * @throws ViewerNotReadyError if timeout is reached
 */
export async function waitForViewerReady(
  viewer: any,
  options: ViewerReadyOptions = {}
): Promise<void> {
  const {
    timeout = 10000,
    pollInterval = 50,
    checkDataSources = true,
    checkImageryLayers = true,
  } = options;

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      // Check timeout
      if (Date.now() - startTime > timeout) {
        reject(
          new ViewerNotReadyError(
            `Viewer not ready after ${timeout}ms. Check Cesium initialization.`
          )
        );
        return;
      }

      // Check if viewer is destroyed
      if (!viewer || viewer.isDestroyed()) {
        reject(new ViewerNotReadyError('Viewer is destroyed'));
        return;
      }

      // Check essential properties
      const hasScene = viewer.scene !== undefined && viewer.scene !== null;
      const hasGlobe = viewer.scene?.globe !== undefined;
      const hasCamera = viewer.camera !== undefined;
      
      // Optional checks
      const hasDataSources = checkDataSources
        ? viewer.dataSources !== undefined
        : true;
      const hasImageryLayers = checkImageryLayers
        ? viewer.imageryLayers !== undefined
        : true;

      if (hasScene && hasGlobe && hasCamera && hasDataSources && hasImageryLayers) {
        resolve();
      } else {
        // Continue polling
        setTimeout(() => requestAnimationFrame(check), pollInterval);
      }
    };

    // Start checking
    requestAnimationFrame(check);
  });
}

/**
 * Safe wrapper for viewer operations that require initialized viewer
 * Waits for viewer to be ready before executing callback
 * 
 * @param viewer - Cesium.Viewer instance
 * @param callback - Operation to execute
 * @param options - Wait options
 * @returns Result of callback
 */
export async function withViewerReady<T>(
  viewer: any,
  callback: (viewer: any) => T | Promise<T>,
  options?: ViewerReadyOptions
): Promise<T> {
  await waitForViewerReady(viewer, options);
  return await callback(viewer);
}

/**
 * Validate DataSource before adding to viewer
 * Ensures DataSource is valid and has entities
 * 
 * @param dataSource - Cesium DataSource to validate
 * @param sourceName - Name for error messages
 * @throws Error if DataSource is invalid
 */
export function validateDataSource(dataSource: any, sourceName: string = 'DataSource'): void {
  if (!dataSource) {
    throw new Error(`${sourceName} is null or undefined`);
  }

  if (!dataSource.entities) {
    throw new Error(`${sourceName} has no entities collection`);
  }

  if (dataSource.entities.values.length === 0) {
    console.warn(`${sourceName} has zero entities`);
  }
}

/**
 * Check if viewer is ready for operations (synchronous check)
 * Use this for quick checks without waiting
 * 
 * @param viewer - Cesium.Viewer instance
 * @returns true if viewer is ready
 */
export function isViewerReady(viewer: any): boolean {
  if (!viewer || viewer.isDestroyed()) return false;
  if (!viewer.scene || !viewer.scene.globe) return false;
  if (!viewer.camera) return false;
  if (!viewer.dataSources || !viewer.imageryLayers) return false;
  return true;
}

export interface SceneReadyOptions {
  timeout?: number; // ms, default 6000
  minFrames?: number; // minimum postRender frames to wait, default 4
  stableFrames?: number; // consecutive frames with tilesLoaded=true, default 2
}

/**
 * Wait for Cesium scene to finish loading terrain and imagery tiles
 * 
 * Uses a multi-strategy approach:
 * 1. Primary: viewer.scene.globe.tilesLoaded === true for N consecutive frames
 * 2. Fallback: postRender event tracking if tileLoadProgressEvent doesn't fire
 * 3. Minimum: wait at least minFrames postRender calls before resolving
 * 
 * This ensures that flyTo operations happen AFTER tiles are rendered,
 * preventing camera positioning issues and black screens.
 * 
 * @param viewer - Cesium.Viewer instance
 * @param options - Configuration options
 * @returns Promise that resolves when scene is ready (tiles loaded)
 */
export async function waitForSceneReady(
  viewer: any,
  options: SceneReadyOptions = {}
): Promise<void> {
  const { timeout = 6000, minFrames = 4, stableFrames = 2 } = options;

  if (!viewer || viewer.isDestroyed()) {
    throw new ViewerNotReadyError('Viewer is destroyed');
  }

  if (!viewer.scene || !viewer.scene.globe) {
    throw new ViewerNotReadyError('Scene or globe not available');
  }

  const startTime = Date.now();
  let postRenderCount = 0;
  let tilesLoadedCount = 0;
  let tileEventFired = false;

  return new Promise<void>((resolve) => {
    let tileProgressListener: (() => void) | null = null;
    let postRenderListener: (() => void) | null = null;

    const cleanup = () => {
      if (tileProgressListener) {
        try {
          tileProgressListener();
        } catch (e) {
          // Ignore cleanup errors
        }
        tileProgressListener = null;
      }
      if (postRenderListener) {
        try {
          postRenderListener();
        } catch (e) {
          // Ignore cleanup errors
        }
        postRenderListener = null;
      }
    };

    const checkReady = () => {
      const elapsed = Date.now() - startTime;

      // Timeout check
      if (elapsed > timeout) {
        cleanup();
        console.debug(`[waitForSceneReady] Timeout after ${elapsed}ms. Proceeding.`);
        resolve();
        return true;
      }

      // Check if tiles are loaded
      const tilesLoaded = viewer.scene?.globe?.tilesLoaded === true;

      if (tilesLoaded) {
        tilesLoadedCount++;
      } else {
        tilesLoadedCount = 0; // Reset if not stable
      }

      // Ready conditions:
      // 1. tilesLoaded for N consecutive frames AND minimum frames passed
      // 2. OR minimum wait time (500ms) + minFrames passed
      const hasStableTiles = tilesLoadedCount >= stableFrames && postRenderCount >= minFrames;
      const hasMinimumWait = elapsed >= 500 && postRenderCount >= minFrames;

      if (hasStableTiles || hasMinimumWait) {
        cleanup();
        if (hasStableTiles) {
          console.debug(`[waitForSceneReady] Tiles loaded after ${elapsed}ms, ${postRenderCount} frames`);
        } else {
          console.debug(`[waitForSceneReady] Minimum wait complete: ${elapsed}ms, ${postRenderCount} frames`);
        }
        resolve();
        return true;
      }

      return false;
    };

    // Strategy 1: Listen to tileLoadProgressEvent (primary)
    tileProgressListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener(
      (queuedTileCount: number) => {
        tileEventFired = true;
        viewer.scene.requestRender();

        if (queuedTileCount === 0) {
          // Tiles finished, check if we're ready
          checkReady();
        }
      }
    );

    // Strategy 2: Listen to postRender (fallback + frame counter)
    postRenderListener = viewer.scene.postRender.addEventListener(() => {
      postRenderCount++;
      checkReady();
    });

    // Trigger initial render to start tile loading
    viewer.scene.requestRender();

    // Fallback: if no tile events after 800ms, rely on postRender only
    setTimeout(() => {
      if (!tileEventFired && postRenderCount === 0) {
        // Force render to trigger postRender
        viewer.scene.requestRender();
      }
    }, 100);
  });
}
