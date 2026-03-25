import React from 'react';
import { Mountain, Loader2, CheckCircle2, AlertCircle, Play } from 'lucide-react';
import type { TileJobStatus } from '@/hooks/useTileProcessing';
import styles from '@/styles/studio.module.css';

interface TileProcessingCardProps {
  status: TileJobStatus;
  progress: number;
  currentStep: string;
  error: string | null;
  onStart: () => void;
  onLoadTileset?: () => void;
}

const STATUS_CONFIG: Record<TileJobStatus, { label: string; color: string }> = {
  idle: { label: 'Sin procesar', color: '#6B6B73' },
  checking: { label: 'Comprobando...', color: '#6B6B73' },
  queued: { label: 'En cola', color: '#f59e0b' },
  running: { label: 'Procesando', color: '#3b82f6' },
  completed: { label: 'Completado', color: '#10B981' },
  failed: { label: 'Error', color: '#ef4444' },
  available: { label: 'Disponible', color: '#10B981' },
};

export default function TileProcessingCard({
  status,
  progress,
  currentStep,
  error,
  onStart,
  onLoadTileset,
}: TileProcessingCardProps): React.JSX.Element {
  const cfg = STATUS_CONFIG[status];
  const isProcessing = status === 'queued' || status === 'running';
  const canStart = status === 'idle' || status === 'failed';

  return (
    <div style={{
      background: '#1e1e22',
      border: `1px solid ${isProcessing ? '#3b82f640' : '#3a3a42'}`,
      borderRadius: 8,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Mountain size={13} style={{ color: cfg.color }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#e4e4e7', letterSpacing: '0.02em' }}>
            Mallado 3D
          </span>
        </div>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          color: cfg.color,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {cfg.label}
        </span>
      </div>

      {/* Progress bar (during processing) */}
      {isProcessing && (
        <div>
          <div style={{
            height: 4,
            background: '#2a2a30',
            borderRadius: 2,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.max(progress, 5)}%`,
              background: 'linear-gradient(90deg, #3b82f6, #10B981)',
              borderRadius: 2,
              transition: 'width 0.5s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 9, color: '#6B6B73' }}>
              {currentStep || 'Iniciando...'}
            </span>
            <span style={{ fontSize: 9, color: '#6B6B73', fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(progress)}%
            </span>
          </div>
        </div>
      )}

      {/* Completed */}
      {(status === 'completed' || status === 'available') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CheckCircle2 size={12} style={{ color: '#10B981' }} />
          <span style={{ fontSize: 10, color: '#10B981' }}>
            Mallado listo — visible en el visor
          </span>
        </div>
      )}

      {/* Error */}
      {status === 'failed' && error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertCircle size={12} style={{ color: '#ef4444' }} />
          <span style={{ fontSize: 10, color: '#ef4444', wordBreak: 'break-word' }}>
            {error}
          </span>
        </div>
      )}

      {/* Action button */}
      {canStart && (
        <button
          onClick={onStart}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '7px 12px',
            background: 'linear-gradient(135deg, #10B981, #059669)',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseOver={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseOut={e => (e.currentTarget.style.opacity = '1')}
        >
          <Play size={12} />
          {status === 'failed' ? 'Reintentar' : 'Generar mallado 3D'}
        </button>
      )}

      {/* Loading spinner */}
      {isProcessing && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Loader2 size={14} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 10, color: '#6B6B73' }}>
            Procesando terreno...
          </span>
        </div>
      )}
    </div>
  );
}
