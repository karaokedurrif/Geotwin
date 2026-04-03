/**
 * HyperrealResult — Before/After comparison slider modal.
 *
 * Shows the original Three.js capture alongside the AI-generated render
 * with a draggable divider slider, like real-estate photo retouching tools.
 */
import { useCallback, useRef, useState } from 'react';

interface HyperrealResultProps {
  /** Data URL or object URL of the original RGB capture */
  originalUrl: string;
  /** URL of the AI-generated render */
  renderUrl: string;
  /** Style preset that was used */
  style: string;
  /** Resolution (e.g. 2048) */
  resolution: number;
  /** Close handler */
  onClose: () => void;
}

export default function HyperrealResult({
  originalUrl,
  renderUrl,
  style,
  resolution,
  onClose,
}: HyperrealResultProps) {
  const [sliderPos, setSliderPos] = useState(50); // percentage 0-100
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleMove = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((clientX - rect.left) / rect.width) * 100;
      setSliderPos(Math.max(0, Math.min(100, pct)));
    },
    []
  );

  const onPointerDown = () => {
    dragging.current = true;
  };
  const onPointerUp = () => {
    dragging.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) handleMove(e.clientX);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '90vw',
          maxWidth: 900,
          marginBottom: 12,
          color: '#fff',
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700 }}>
          ✨ Render Hiperrealista —{' '}
          <span style={{ textTransform: 'capitalize' }}>{style}</span>{' '}
          <span style={{ opacity: 0.5, fontSize: 13 }}>
            ({resolution}×{resolution})
          </span>
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href={renderUrl}
            download={`hyperreal_${style}_${resolution}.png`}
            style={{
              padding: '6px 14px',
              background: '#10B981',
              color: '#fff',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            ⬇ Descargar {resolution >= 4096 ? '4K' : resolution >= 2048 ? '2K' : '1K'}
          </a>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
              background: '#374151',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ✕ Cerrar
          </button>
        </div>
      </div>

      {/* Comparison slider */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerMove={onPointerMove}
        style={{
          position: 'relative',
          width: '90vw',
          maxWidth: 900,
          aspectRatio: '1 / 1',
          maxHeight: '75vh',
          overflow: 'hidden',
          borderRadius: 8,
          border: '2px solid #3a3a40',
          cursor: 'ew-resize',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        {/* Render (background, full width) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={renderUrl}
          alt="Render hiperrealista"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          draggable={false}
        />

        {/* Original (clipped from left to slider position) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={originalUrl}
            alt="Modelo original"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
            draggable={false}
          />
        </div>

        {/* Slider line */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${sliderPos}%`,
            width: 3,
            background: '#fff',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
          }}
        />

        {/* Slider handle */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: `${sliderPos}%`,
            transform: 'translate(-50%, -50%)',
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: '#fff',
            border: '3px solid #8B5CF6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
            color: '#8B5CF6',
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}
        >
          ↔
        </div>

        {/* Labels */}
        <span
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            padding: '3px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            pointerEvents: 'none',
          }}
        >
          Original
        </span>
        <span
          style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            background: 'rgba(139,92,246,0.7)',
            color: '#fff',
            padding: '3px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            pointerEvents: 'none',
          }}
        >
          ✨ Hyperreal
        </span>
      </div>
    </div>
  );
}
