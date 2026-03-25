/**
 * MeshGeneratorOverlay — Tripo3D-style mesh generation visual effect.
 *
 * Stages:
 *  1. Idle: floating "Generar Mallado 3D" CTA button
 *  2. Scanning: particle point-cloud swirl + progress ring
 *  3. Meshing: wireframe grid morphing into terrain
 *  4. Texturing: color fill sweeps across wireframe
 *  5. Done: mesh dissolves, reveals real 3D Tiles underneath
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Mountain, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import type { TileProcessingState } from '@/hooks/useTileProcessing';

interface MeshGeneratorOverlayProps {
  tileProcessing: TileProcessingState;
  viewerRef?: any;        // Cesium.Viewer — for real terrain elevation
  parcelBounds?: {        // lon/lat bbox of parcel for terrain sampling
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

// ── Stage mapping from job status + progress ─────────────────────────────────
type VisualStage = 'idle' | 'scanning' | 'meshing' | 'texturing' | 'done' | 'error';

function resolveStage(status: string, progress: number): VisualStage {
  if (status === 'failed') return 'error';
  if (status === 'completed' || status === 'available') return 'done';
  if (status === 'idle' || status === 'checking') return 'idle';
  // running / queued
  if (progress < 30) return 'scanning';
  if (progress < 70) return 'meshing';
  return 'texturing';
}

const STAGE_LABELS: Record<VisualStage, string> = {
  idle: '',
  scanning: 'Escaneando terreno...',
  meshing: 'Generando malla 3D...',
  texturing: 'Aplicando textura ortofoto...',
  done: 'Mallado completado',
  error: 'Error en procesamiento',
};

// ── Canvas animation — particles + wireframe + fill ──────────────────────────

const GRID_COLS = 28;
const GRID_ROWS = 16;

/** Sample real terrain elevation from Cesium's terrain provider */
function useTerrainElevation(
  gridRef: React.MutableRefObject<Array<{
    x: number; y: number; baseY: number;
    targetY: number; currentY: number;
  }>>,
  viewerRef: any | undefined,
  parcelBounds: { west: number; south: number; east: number; north: number } | undefined,
) {
  const sampledRef = useRef(false);

  useEffect(() => {
    if (sampledRef.current || !viewerRef || !parcelBounds || gridRef.current.length === 0) return;
    const Cesium = (window as any).Cesium;
    if (!Cesium || !viewerRef.terrainProvider) return;

    const { west, south, east, north } = parcelBounds;
    const positions: any[] = [];

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const lon = west + (c / (GRID_COLS - 1)) * (east - west);
        const lat = south + (r / (GRID_ROWS - 1)) * (north - south);
        positions.push(Cesium.Cartographic.fromDegrees(lon, lat));
      }
    }

    Cesium.sampleTerrainMostDetailed(viewerRef.terrainProvider, positions)
      .then((sampled: any[]) => {
        if (sampledRef.current) return;
        sampledRef.current = true;

        // Find min/max height to normalize to -0.15..0.15 range for the canvas
        let minH = Infinity, maxH = -Infinity;
        for (const p of sampled) {
          const h = p.height ?? 0;
          if (h < minH) minH = h;
          if (h > maxH) maxH = h;
        }
        const range = maxH - minH || 1;

        for (let i = 0; i < sampled.length && i < gridRef.current.length; i++) {
          const normalized = ((sampled[i].height ?? 0) - minH) / range;
          // Map to canvas y offset (-0.15 to +0.15) from baseY
          gridRef.current[i].targetY = gridRef.current[i].baseY + (normalized - 0.5) * 0.3;
        }
      })
      .catch(() => {
        // Fallback to sine wave elevation already set
      });
  }, [viewerRef, parcelBounds, gridRef]);
}

function useCanvasAnimation(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  stage: VisualStage,
  progress: number,
  externalGridRef?: React.MutableRefObject<Array<{
    x: number; y: number; baseY: number;
    targetY: number; currentY: number;
  }>>,
) {
  const frameRef = useRef(0);
  const particlesRef = useRef<Array<{
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    life: number; maxLife: number;
    size: number;
  }>>([]);

  // Grid vertices for wireframe — use external ref if provided
  const internalGridRef = useRef<Array<{
    x: number; y: number; baseY: number;
    targetY: number; currentY: number;
  }>>([]);
  const gridRef = externalGridRef || internalGridRef;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let t = 0;

    // Initialize particles
    if (particlesRef.current.length === 0) {
      for (let i = 0; i < 200; i++) {
        particlesRef.current.push({
          x: Math.random() * 2 - 1,
          y: Math.random() * 2 - 1,
          z: Math.random(),
          vx: (Math.random() - 0.5) * 0.008,
          vy: (Math.random() - 0.5) * 0.008,
          vz: Math.random() * 0.005,
          life: Math.random() * 100,
          maxLife: 80 + Math.random() * 120,
          size: 1 + Math.random() * 2,
        });
      }
    }

    // Initialize terrain grid
    if (gridRef.current.length === 0) {
      const cols = GRID_COLS;
      const rows = GRID_ROWS;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = (c / (cols - 1)) * 2 - 1;
          const baseY = (r / (rows - 1)) * 2 - 1;
          // Simulate elevation: hills + valleys
          const elev =
            Math.sin(x * 3.2) * 0.12 +
            Math.cos(baseY * 2.8 + x) * 0.08 +
            Math.sin(x * 5 + baseY * 3) * 0.04;
          gridRef.current.push({
            x,
            y: baseY,
            baseY,
            targetY: baseY + elev,
            currentY: baseY,
          });
        }
      }
    }

    const cols = GRID_COLS;
    const rows = GRID_ROWS;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = canvas!.offsetWidth * dpr;
      canvas!.height = canvas!.offsetHeight * dpr;
      ctx!.scale(dpr, dpr);
    }
    resize();

    function draw() {
      const W = canvas!.offsetWidth;
      const H = canvas!.offsetHeight;
      ctx!.clearRect(0, 0, W, H);

      t += 0.016;
      const particles = particlesRef.current;
      const grid = gridRef.current;

      // ── Stage: SCANNING — particle swirl ──
      if (stage === 'scanning') {
        const scanLine = ((t * 0.3) % 1.2) - 0.1; // vertical scan beam

        for (const p of particles) {
          p.x += p.vx;
          p.y += p.vy;
          p.life++;
          if (p.life > p.maxLife || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) {
            p.x = Math.random() * 2 - 1;
            p.y = -1.1;
            p.life = 0;
            p.vx = (Math.random() - 0.5) * 0.008;
            p.vy = 0.005 + Math.random() * 0.01;
          }

          const sx = (p.x + 1) / 2 * W;
          const sy = (p.y + 1) / 2 * H;
          const distToScan = Math.abs((p.y + 1) / 2 - scanLine);
          const brightness = distToScan < 0.06 ? 1 : 0.3 + p.z * 0.4;

          ctx!.beginPath();
          ctx!.arc(sx, sy, p.size * (distToScan < 0.06 ? 2 : 1), 0, Math.PI * 2);
          ctx!.fillStyle = distToScan < 0.06
            ? `rgba(16, 185, 129, ${brightness})`
            : `rgba(59, 130, 246, ${brightness * 0.6})`;
          ctx!.fill();
        }

        // Scan beam line
        const beamY = scanLine * H;
        const grad = ctx!.createLinearGradient(0, beamY - 20, 0, beamY + 20);
        grad.addColorStop(0, 'rgba(16, 185, 129, 0)');
        grad.addColorStop(0.5, 'rgba(16, 185, 129, 0.4)');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        ctx!.fillStyle = grad;
        ctx!.fillRect(0, beamY - 20, W, 40);
      }

      // ── Stage: MESHING — wireframe grid rises ──
      if (stage === 'meshing' || stage === 'texturing') {
        const morphProgress = stage === 'meshing'
          ? Math.min((progress - 30) / 40, 1)
          : 1;

        // Animate grid vertices toward target elevation
        for (const v of grid) {
          v.currentY = v.baseY + (v.targetY - v.baseY) * morphProgress;
        }

        // Perspective transform
        const project = (vx: number, vy: number): [number, number] => {
          const perspective = 1.8;
          const rotX = 0.45; // tilt
          const cosR = Math.cos(rotX);
          const sinR = Math.sin(rotX);
          const y3d = vy * cosR;
          const z3d = vy * sinR + 0.5;
          const scale = perspective / (perspective + z3d);
          return [
            W / 2 + vx * W * 0.38 * scale,
            H / 2 + y3d * H * 0.38 * scale - 30,
          ];
        };

        // Draw triangle fills (texturing stage)
        if (stage === 'texturing') {
          const fillProgress = Math.min((progress - 70) / 30, 1);
          const fillCols = Math.floor(fillProgress * (cols - 1));

          for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < fillCols; c++) {
              const i0 = r * cols + c;
              const i1 = r * cols + c + 1;
              const i2 = (r + 1) * cols + c;
              const i3 = (r + 1) * cols + c + 1;

              const [x0, y0] = project(grid[i0].x, grid[i0].currentY);
              const [x1, y1] = project(grid[i1].x, grid[i1].currentY);
              const [x2, y2] = project(grid[i2].x, grid[i2].currentY);
              const [x3, y3] = project(grid[i3].x, grid[i3].currentY);

              // Color based on elevation
              const elev = (grid[i0].targetY - grid[i0].baseY + 0.15) / 0.3;
              const hue = 120 - elev * 80; // green → brown
              const sat = 50 + elev * 20;

              ctx!.beginPath();
              ctx!.moveTo(x0, y0);
              ctx!.lineTo(x1, y1);
              ctx!.lineTo(x3, y3);
              ctx!.lineTo(x2, y2);
              ctx!.closePath();
              ctx!.fillStyle = `hsla(${hue}, ${sat}%, 35%, 0.7)`;
              ctx!.fill();
            }
          }
        }

        // Draw wireframe
        ctx!.strokeStyle = stage === 'texturing'
          ? `rgba(16, 185, 129, ${0.3 + 0.2 * Math.sin(t * 2)})`
          : `rgba(59, 130, 246, ${0.4 + 0.3 * morphProgress})`;
        ctx!.lineWidth = stage === 'texturing' ? 0.5 : 0.8;

        // Horizontal lines
        for (let r = 0; r < rows; r++) {
          ctx!.beginPath();
          for (let c = 0; c < cols; c++) {
            const v = grid[r * cols + c];
            const [px, py] = project(v.x, v.currentY);
            if (c === 0) ctx!.moveTo(px, py);
            else ctx!.lineTo(px, py);
          }
          ctx!.stroke();
        }

        // Vertical lines
        for (let c = 0; c < cols; c++) {
          ctx!.beginPath();
          for (let r = 0; r < rows; r++) {
            const v = grid[r * cols + c];
            const [px, py] = project(v.x, v.currentY);
            if (r === 0) ctx!.moveTo(px, py);
            else ctx!.lineTo(px, py);
          }
          ctx!.stroke();
        }

        // Vertex dots
        if (stage === 'meshing') {
          for (const v of grid) {
            const [px, py] = project(v.x, v.currentY);
            ctx!.beginPath();
            ctx!.arc(px, py, 1.5, 0, Math.PI * 2);
            ctx!.fillStyle = `rgba(16, 185, 129, ${0.6 + 0.3 * morphProgress})`;
            ctx!.fill();
          }
        }
      }

      // ── Stage: DONE — dissolve particles outward ──
      if (stage === 'done') {
        // Nothing on canvas — overlay fades out via CSS
      }

      animId = requestAnimationFrame(draw);
    }

    draw();
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [canvasRef, stage, progress]);
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function MeshGeneratorOverlay({ tileProcessing, viewerRef, parcelBounds }: MeshGeneratorOverlayProps) {
  const { status, progress, currentStep, error, startProcessing, tilesAvailable } = tileProcessing;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stage = resolveStage(status, progress);
  const [showDone, setShowDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Reference to grid for terrain sampling
  const gridRef = useRef<Array<{
    x: number; y: number; baseY: number;
    targetY: number; currentY: number;
  }>>([]);

  useCanvasAnimation(canvasRef, stage, progress, gridRef);
  useTerrainElevation(gridRef, viewerRef, parcelBounds);

  // Auto-dismiss done state after 3s
  useEffect(() => {
    if (stage === 'done' && !showDone) {
      setShowDone(true);
      const timer = setTimeout(() => setDismissed(true), 3500);
      return () => clearTimeout(timer);
    }
  }, [stage, showDone]);

  // Don't render if tiles are already available (done processing or pre-existing)
  if (tilesAvailable && (status === 'available' || stage === 'done')) return null;
  if (dismissed) return null;

  // Idle/Checking: show floating CTA button
  if (status === 'idle' || status === 'checking') {
    return (
      <div style={{
        position: 'absolute',
        bottom: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        animation: 'meshCTAFloat 3s ease-in-out infinite',
      }}>
        <button
          onClick={startProcessing}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 28px',
            background: 'linear-gradient(135deg, rgba(16,185,129,0.9), rgba(5,150,105,0.95))',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(16,185,129,0.4)',
            borderRadius: 14,
            color: '#fff',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 8px 32px rgba(16,185,129,0.3), 0 0 60px rgba(16,185,129,0.1)',
            transition: 'all 0.25s ease',
            letterSpacing: '0.01em',
          }}
          onMouseOver={e => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.boxShadow = '0 12px 40px rgba(16,185,129,0.45), 0 0 80px rgba(16,185,129,0.15)';
          }}
          onMouseOut={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(16,185,129,0.3), 0 0 60px rgba(16,185,129,0.1)';
          }}
        >
          <Sparkles size={18} />
          Generar Mallado 3D
          <Mountain size={16} />
        </button>

        <style>{`
          @keyframes meshCTAFloat {
            0%, 100% { transform: translateX(-50%) translateY(0px); }
            50% { transform: translateX(-50%) translateY(-6px); }
          }
        `}</style>
      </div>
    );
  }

  // Error state
  if (stage === 'error') {
    return (
      <div style={{
        position: 'absolute',
        bottom: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          padding: '16px 24px',
          background: 'rgba(30, 30, 34, 0.95)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} style={{ color: '#ef4444' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#ef4444' }}>
              Error al generar mallado
            </span>
          </div>
          <span style={{ fontSize: 11, color: '#9ca3af', maxWidth: 300, textAlign: 'center' }}>
            {error || 'Error desconocido'}
          </span>
          <button
            onClick={startProcessing}
            style={{
              padding: '8px 20px',
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  // ── Processing overlay (scanning / meshing / texturing / done) ──
  const isActive = stage === 'scanning' || stage === 'meshing' || stage === 'texturing';
  const fadeOut = stage === 'done';

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 999,
      pointerEvents: isActive ? 'auto' : 'none',
      transition: 'opacity 1.2s ease',
      opacity: fadeOut ? 0 : 1,
    }}>
      {/* Dark scrim */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: isActive
          ? 'radial-gradient(ellipse at center, rgba(10,10,14,0.75) 0%, rgba(10,10,14,0.92) 100%)'
          : 'transparent',
        transition: 'background 1s ease',
      }} />

      {/* Animation canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />

      {/* Center HUD */}
      {isActive && (
        <div style={{
          position: 'absolute',
          bottom: 100,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}>
          {/* Progress ring */}
          <div style={{ position: 'relative', width: 80, height: 80 }}>
            <svg width="80" height="80" viewBox="0 0 80 80">
              {/* Background ring */}
              <circle
                cx="40" cy="40" r="34"
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="4"
              />
              {/* Progress arc */}
              <circle
                cx="40" cy="40" r="34"
                fill="none"
                stroke="url(#meshGrad)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 34}`}
                strokeDashoffset={`${2 * Math.PI * 34 * (1 - progress / 100)}`}
                transform="rotate(-90 40 40)"
                style={{ transition: 'stroke-dashoffset 0.5s ease' }}
              />
              <defs>
                <linearGradient id="meshGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#10B981" />
                </linearGradient>
              </defs>
            </svg>
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <span style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#e4e4e7',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {Math.round(progress)}%
              </span>
            </div>
          </div>

          {/* Stage label */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}>
            <span style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#e4e4e7',
              letterSpacing: '0.03em',
            }}>
              {STAGE_LABELS[stage]}
            </span>
            <span style={{
              fontSize: 11,
              color: '#6B6B73',
              maxWidth: 260,
              textAlign: 'center',
            }}>
              {currentStep || STAGE_LABELS[stage]}
            </span>
          </div>

          {/* Pulsing dot row */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[0, 1, 2].map(i => (
              <div
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: stage === 'scanning'
                    ? '#3b82f6'
                    : stage === 'meshing'
                    ? '#10B981'
                    : '#f59e0b',
                  animation: `meshDot 1.4s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Done flash */}
      {fadeOut && (
        <div style={{
          position: 'absolute',
          bottom: 100,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 24px',
          background: 'rgba(16, 185, 129, 0.15)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(16, 185, 129, 0.4)',
          borderRadius: 12,
          animation: 'meshDoneIn 0.5s ease-out',
        }}>
          <CheckCircle2 size={18} style={{ color: '#10B981' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#10B981' }}>
            Mallado 3D completado
          </span>
        </div>
      )}

      <style>{`
        @keyframes meshDot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.3); }
        }
        @keyframes meshDoneIn {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}
