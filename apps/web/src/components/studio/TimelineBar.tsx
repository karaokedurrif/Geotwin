/**
 * TimelineBar — Temporal playback bar for IoT time-series data.
 * 
 * Shows a time range scrubber in the bottom bar area. 
 * Controls which moment of the time-series is being visualized.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Clock } from 'lucide-react';

interface TimelineBarProps {
  /** Start of the visible time range */
  startTime: Date;
  /** End of the visible time range */
  endTime: Date;
  /** Currently selected time cursor */
  currentTime: Date;
  /** Called when user moves cursor */
  onTimeChange: (time: Date) => void;
  /** Whether timeline is playing */
  playing: boolean;
  onTogglePlay: () => void;
  /** Playback speed multiplier (1x, 2x, 4x) */
  speed: number;
  onSpeedChange: (speed: number) => void;
}

export default function TimelineBar({
  startTime,
  endTime,
  currentTime,
  onTimeChange,
  playing,
  onTogglePlay,
  speed,
  onSpeedChange,
}: TimelineBarProps): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const totalMs = endTime.getTime() - startTime.getTime();
  const progress = totalMs > 0
    ? (currentTime.getTime() - startTime.getTime()) / totalMs
    : 0;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateFromPointer(e.clientX);
  }, [startTime, endTime]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    updateFromPointer(e.clientX);
  }, [dragging, startTime, endTime]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  const updateFromPointer = (clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ms = startTime.getTime() + ratio * totalMs;
    onTimeChange(new Date(ms));
  };

  const skipStep = totalMs / 24; // 1/24th of range per skip

  const SPEEDS = [1, 2, 4, 8];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 16px',
      background: '#1a1a1e',
      borderTop: '1px solid #2e2e34',
      height: 36,
    }}>
      {/* Time display */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        color: '#6B6B73', fontSize: 10, minWidth: 120, flexShrink: 0,
      }}>
        <Clock size={10} />
        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#A0A0A8', fontWeight: 600 }}>
          {formatDateTime(currentTime)}
        </span>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconBtn onClick={() => onTimeChange(new Date(currentTime.getTime() - skipStep))}>
          <SkipBack size={10} />
        </IconBtn>
        <IconBtn onClick={onTogglePlay} accent>
          {playing ? <Pause size={10} /> : <Play size={10} />}
        </IconBtn>
        <IconBtn onClick={() => onTimeChange(new Date(currentTime.getTime() + skipStep))}>
          <SkipForward size={10} />
        </IconBtn>
      </div>

      {/* Speed selector */}
      <button
        onClick={() => {
          const idx = SPEEDS.indexOf(speed);
          onSpeedChange(SPEEDS[(idx + 1) % SPEEDS.length]);
        }}
        style={{
          padding: '2px 6px', border: '1px solid #3a3a42', borderRadius: 3,
          background: '#2a2a2e', color: '#A0A0A8', fontSize: 9, fontWeight: 700,
          cursor: 'pointer', minWidth: 28, textAlign: 'center',
        }}
      >
        {speed}×
      </button>

      {/* Scrubber track */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          flex: 1,
          height: 12,
          background: '#2a2a2e',
          borderRadius: 6,
          position: 'relative',
          cursor: 'pointer',
          overflow: 'hidden',
        }}
      >
        {/* Fill */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${progress * 100}%`,
          background: 'linear-gradient(90deg, #10B98140, #10B98180)',
          borderRadius: 6,
          transition: dragging ? 'none' : 'width 0.3s',
        }} />
        {/* Cursor */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `calc(${progress * 100}% - 6px)`,
          width: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: dragging ? 'none' : 'left 0.3s',
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#10B981', boxShadow: '0 0 6px #10B98160',
          }} />
        </div>
        {/* Time labels */}
        <div style={{
          position: 'absolute', bottom: -12, left: 0, right: 0,
          display: 'flex', justifyContent: 'space-between',
          fontSize: 7, color: '#45454D',
        }}>
          <span>{formatShort(startTime)}</span>
          <span>{formatShort(endTime)}</span>
        </div>
      </div>

      {/* End time */}
      <div style={{
        display: 'flex', alignItems: 'center',
        color: '#45454D', fontSize: 9, minWidth: 50, flexShrink: 0, textAlign: 'right',
      }}>
        {formatDate(endTime)}
      </div>
    </div>
  );
}

// ── useTimeline hook ─────────────────────────────────────────────────────────

export function useTimeline(daysBack: number = 7) {
  const [endTime] = useState(() => new Date());
  const [startTime] = useState(() => new Date(endTime.getTime() - daysBack * 24 * 3600 * 1000));
  const [currentTime, setCurrentTime] = useState(() => new Date(endTime));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing) {
      if (animRef.current) clearInterval(animRef.current);
      return;
    }

    // Advance 15 minutes of simulation time per 1s real-time * speed
    const intervalMs = 1000;
    const stepMs = 15 * 60 * 1000 * speed;

    animRef.current = setInterval(() => {
      setCurrentTime(prev => {
        const next = new Date(prev.getTime() + stepMs);
        if (next >= endTime) {
          setPlaying(false);
          return endTime;
        }
        return next;
      });
    }, intervalMs);

    return () => {
      if (animRef.current) clearInterval(animRef.current);
    };
  }, [playing, speed, endTime]);

  return {
    startTime,
    endTime,
    currentTime,
    setCurrentTime,
    playing,
    togglePlay: () => setPlaying(p => !p),
    speed,
    setSpeed,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function IconBtn({ children, onClick, accent }: {
  children: React.ReactNode; onClick: () => void; accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: 4, border: 'none',
        background: accent ? '#10B981' : '#2a2a2e',
        color: accent ? '#1a1a1e' : '#A0A0A8',
        cursor: 'pointer', transition: 'all 0.1s',
      }}
    >
      {children}
    </button>
  );
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

function formatShort(d: Date): string {
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
}
