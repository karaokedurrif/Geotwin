/**
 * hq_capture.ts — GeoTwin HQ Canvas Capture
 * ==========================================
 * Captura PNG de alta resolución del viewer de Cesium con MDT02 y PNOA reales.
 * NO usa IA ni renderizado externo - captura directamente el canvas 3D.
 */

export interface HQCaptureOptions {
  viewer: any;  // Cesium.Viewer
  snapshot: any;  // TwinSnapshot con parcel.centroid
  viewAngle?: 'helicopter' | 'isometric' | 'lateral' | 'current' | 'top';
  pixelRatio?: number;  // 1=normal, 2=2x, 3=3x, 4=4K, 5=5K para Photoshop
  style?: 'natural' | 'topo' | 'ndvi' | 'night';
  boundaryOnly?: boolean;  // Solo mostrar área dentro del contorno (fondo transparente)
}

/**
 * Captura una imagen PNG de alta resolución del visor Cesium.
 * Requiere que el viewer tenga `preserveDrawingBuffer: true`.
 */
export async function captureHQIllustration(
  opts: HQCaptureOptions
): Promise<Blob> {
  const { 
    viewer, 
    snapshot, 
    viewAngle = 'helicopter', 
    pixelRatio = 3,  // 3x es buen balance calidad/tamaño
    style = 'natural',
    boundaryOnly = false,  // Por defecto, captura completa
  } = opts;

  const Cesium = window.Cesium;
  if (!Cesium) throw new Error('Cesium not loaded');
  
  const [lon, lat] = snapshot.parcel?.centroid ?? [0, 0];
  const areaHa = snapshot.parcel?.area_ha ?? 100;
  
  console.log('[HQ Capture] 🎬 Iniciando captura', { viewAngle, pixelRatio, style, boundaryOnly });

  // ── PASO 1: Configurar vistas con lookAt (siempre centrado en parcela) ────
  const distanceM = Math.max(1500, Math.min(5000, Math.sqrt(areaHa) * 160));
  const center3D = Cesium.Cartesian3.fromDegrees(lon, lat, 1100); // altura real terreno

  type LookAtConfig = { center: any; hpr: any } | null;
  const viewConfigs: Record<string, LookAtConfig> = {
    helicopter: {
      center: center3D,
      hpr: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(315),  // NW→SE, montañas al fondo
        Cesium.Math.toRadians(-32),  // 32° abajo — relieve visible
        distanceM,
      ),
    },
    isometric: {
      center: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      hpr: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(-90),  // cenital puro
        distanceM * 1.5,
      ),
    },
    lateral: {
      center: center3D,
      hpr: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(315),
        Cesium.Math.toRadians(-20),  // casi horizontal — relieve dramático
        distanceM,
      ),
    },
    top: {
      center: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      hpr: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(-90),  // cenital puro
        distanceM * 1.8,
      ),
    },
    current: null,  // Usar la vista actual sin cambiar cámara
  };

  // ── PASO 2: Escalar resolución del canvas ──────────────────────────
  const originalScale = viewer.resolutionScale;
  viewer.resolutionScale = pixelRatio;
  console.log('[HQ Capture] 📐 Resolution scale:', pixelRatio + 'x');

  try {
    // ── PASO 3: Posicionar cámara ──────────────────────────────────────────
    const config = viewConfigs[viewAngle];
    if (config) {
      console.log('[HQ Capture] 🚁 Positioning to', viewAngle, 'view...');
      
      // lookAt garantiza que la parcela está centrada en pantalla
      viewer.camera.lookAt(config.center, config.hpr);
      
      // Esperar a que Cesium cargue los tiles de la nueva vista
      await new Promise<void>(resolve => {
        let done = false;
        const unsub = viewer.scene.globe.tileLoadProgressEvent.addEventListener((n: number) => {
          if (n === 0 && !done) {
            done = true;
            unsub();
            resolve();
          }
        });
        // Timeout 8s
        setTimeout(() => { if (!done) { done = true; unsub(); resolve(); } }, 8000);
        viewer.scene.requestRender();
      });
      
      // Liberar el lookAt lock para que el viewer siga siendo interactivo
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      console.log('[HQ Capture] ✅ Camera positioned');
    }
    // Si viewAngle === 'current': no mover cámara, capturar lo que hay en pantalla

    // ── PASO 4: Configurar para máxima calidad ───────────────────────
    const originalSSE = viewer.scene.globe.maximumScreenSpaceError;
    viewer.scene.globe.maximumScreenSpaceError = 0.5;  // Máxima calidad de tiles
    console.log('[HQ Capture] 🎨 Max quality enabled (SSE=0.5)');

    // Aplicar estilo visual si es necesario
    if (style !== 'natural') {
      // Puedes modificar saturación, contraste, etc. aquí según el estilo
      console.log('[HQ Capture] 🎨 Style:', style);
    }

    // ── PASO 5: Esperar terrain + imagery completamente cargados ────────────
    console.log('[HQ Capture] ⏳ Waiting for terrain + imagery tiles...');
    viewer.scene.requestRender();
    
    await new Promise<void>(resolve => {
      let done = false;
      
      const unsub = viewer.scene.globe.tileLoadProgressEvent.addEventListener(
        (n: number) => {
          console.log(`[HQ Capture] 🗺️ Tiles remaining: ${n}`);
          if (n === 0 && !done) {
            done = true;
            unsub();
            console.log('[HQ Capture] ✅ Terrain tiles fully loaded');
            resolve();
          }
        }
      );
      
      // Fallback 30s
      setTimeout(() => {
        if (!done) {
          done = true;
          unsub();
          console.warn('[HQ Capture] ⚠️ Tile loading timeout (30s), proceeding anyway');
          resolve();
        }
      }, 30000);
      
      viewer.scene.requestRender();
    });
    
    // Esperar 2s adicionales para que la imagery (PNOA proxy) termine de pintar
    // Sin esto el canvas se captura con tiles grises/negros parciales
    console.log('[HQ Capture] ⏳ Waiting for imagery to stabilize (2s)...');
    viewer.render();
    await new Promise(r => setTimeout(r, 1000));
    viewer.render();
    await new Promise(r => setTimeout(r, 1000));

    // ── PASO 6: Renders adicionales para máxima calidad ────────────────────────
    console.log('[HQ Capture] 🎬 Rendering final frames...');
    for (let i = 0; i < 5; i++) {
      viewer.render();
      await new Promise(r => setTimeout(r, 150));
    }

    // ── PASO 7: Capturar canvas como PNG ─────────────────────────────
    console.log('[HQ Capture] 📸 Capturing canvas...');
    const canvas = viewer.scene.canvas;
    
    let finalBlob: Blob;
    
    if (boundaryOnly) {
      // Recortar a solo la geometría de la parcela con fondo transparente
      console.log('[HQ Capture] ✂️ Applying boundary mask...');
      finalBlob = await applyBoundaryMask(viewer, canvas, snapshot);
    } else {
      // Captura completa del canvas
      finalBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b: Blob | null) => {
            if (b) {
              resolve(b);
            } else {
              reject(new Error('Canvas capture failed - check preserveDrawingBuffer'));
            }
          },
          'image/png',
          1.0  // Máxima calidad PNG
        );
      });
    }

    // ── PASO 8: Restaurar configuración original ─────────────────────
    viewer.resolutionScale = originalScale;
    viewer.scene.globe.maximumScreenSpaceError = originalSSE;
    
    const sizeMB = (finalBlob.size / 1024 / 1024).toFixed(2);
    console.log('[HQ Capture] ✅ Captured', sizeMB + 'MB PNG', canvas.width + 'x' + canvas.height + 'px');
    
    return finalBlob;
    
  } catch (error) {
    // Restaurar en caso de error
    viewer.resolutionScale = originalScale;
    console.error('[HQ Capture] ❌ Capture failed:', error);
    throw error;
  }
}


/**
 * Aplica máscara de contorno de parcela - Recorta la imagen a solo la geometría.
 * Retorna PNG con fondo transparente mostrando solo el interior de la parcela.
 */
async function applyBoundaryMask(
  viewer: any,
  sourceCanvas: HTMLCanvasElement,
  snapshot: any
): Promise<Blob> {
  const Cesium = window.Cesium;
  
  // Obtener geometría de la parcela — soportar ambas estructuras
  const geojson = snapshot.parcel?.geojson;
  
  // Estructura 1: geojson.geometry directamente
  // Estructura 2: geojson.features[0].geometry (FeatureCollection)
  const geometry = geojson?.geometry 
    ?? geojson?.features?.[0]?.geometry
    ?? null;
    
  if (!geometry) {
    throw new Error('No parcel geometry found for boundary mask');
  }
  
  const coordinates = geometry.type === 'Polygon' 
    ? geometry.coordinates[0]
    : geometry.coordinates[0][0];  // MultiPolygon
  
  console.log('[Boundary Mask] 📐 Processing', coordinates.length, 'vertices');
  
  // Proyectar coordenadas geográficas a píxeles de pantalla
  const screenPoints: Array<{x: number, y: number}> = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // wgs84ToWindowCoordinates returns CSS-pixel coords.
  // When resolutionScale > 1 the canvas backing store is larger by that factor,
  // so we must multiply screen coords by the scale to match canvas device pixels.
  const scale = viewer.resolutionScale ?? 1;

  for (const coord of coordinates) {
    const [lon, lat] = coord;
    const cartesian = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    const screenPos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
      viewer.scene,
      cartesian
    );

    if (screenPos) {
      const sx = screenPos.x * scale;
      const sy = screenPos.y * scale;
      screenPoints.push({ x: sx, y: sy });
      minX = Math.min(minX, sx);
      minY = Math.min(minY, sy);
      maxX = Math.max(maxX, sx);
      maxY = Math.max(maxY, sy);
    }
  }
  
  if (screenPoints.length === 0) {
    throw new Error('No screen points - parcel may be out of view');
  }
  
  console.log('[Boundary Mask] 🎯 Bounding box:', {
    minX: Math.round(minX),
    minY: Math.round(minY),
    maxX: Math.round(maxX),
    maxY: Math.round(maxY),
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY),
  });
  
  // Crear canvas temporal para aplicar máscara
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = sourceCanvas.width;
  tempCanvas.height = sourceCanvas.height;
  const ctx = tempCanvas.getContext('2d', { willReadFrequently: false });
  
  if (!ctx) {
    throw new Error('Failed to get 2D context for masking');
  }
  
  // Paso 1: Dibujar el canvas original
  ctx.drawImage(sourceCanvas, 0, 0);
  
  // Paso 2: Crear máscara de clip con la geometría de la parcela
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';  // Solo mantener donde hay máscara
  
  // Dibujar polígono de la parcela
  ctx.fillStyle = 'white';
  ctx.beginPath();
  screenPoints.forEach((pt, i) => {
    if (i === 0) {
      ctx.moveTo(pt.x, pt.y);
    } else {
      ctx.lineTo(pt.x, pt.y);
    }
  });
  ctx.closePath();
  ctx.fill();
  
  ctx.restore();
  
  // Paso 3: Recortar al bounding box de la parcela (con margen)
  const margin = 50;  // Píxeles de margen alrededor de la parcela
  const cropX = Math.max(0, Math.floor(minX - margin));
  const cropY = Math.max(0, Math.floor(minY - margin));
  const cropW = Math.min(tempCanvas.width - cropX, Math.ceil(maxX - minX + 2 * margin));
  const cropH = Math.min(tempCanvas.height - cropY, Math.ceil(maxY - minY + 2 * margin));
  
  console.log('[Boundary Mask] ✂️ Cropping to:', { cropX, cropY, cropW, cropH });
  
  // Canvas final recortado
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = cropW;
  finalCanvas.height = cropH;
  const finalCtx = finalCanvas.getContext('2d');
  
  if (!finalCtx) {
    throw new Error('Failed to get final context');
  }
  
  // Copiar región recortada
  finalCtx.drawImage(
    tempCanvas,
    cropX, cropY, cropW, cropH,  // source
    0, 0, cropW, cropH            // destination
  );
  
  // Convertir a blob
  const blob = await new Promise<Blob>((resolve, reject) => {
    finalCanvas.toBlob(
      (b: Blob | null) => {
        if (b) {
          resolve(b);
        } else {
          reject(new Error('Boundary mask blob creation failed'));
        }
      },
      'image/png',
      1.0
    );
  });
  
  console.log('[Boundary Mask] ✅ Masked image created:', finalCanvas.width + 'x' + finalCanvas.height + 'px');
  
  return blob;
}


/**
 * Descarga directa de un blob como archivo.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.log('[HQ Capture] 💾 Downloaded:', filename);
}
