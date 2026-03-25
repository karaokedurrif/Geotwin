import { useState, useEffect, useCallback, useRef } from 'react';

export type TileJobStatus = 'idle' | 'checking' | 'queued' | 'running' | 'completed' | 'failed' | 'available';

interface TileJobResult {
  twin_id: string;
  area_ha: number;
  centroid: [number, number];
  vertex_count: number;
  face_count: number;
  lod_count: number;
  processing_time_s: number;
}

interface UseTileProcessingReturn {
  status: TileJobStatus;
  progress: number;
  currentStep: string;
  result: TileJobResult | null;
  error: string | null;
  startProcessing: () => void;
  tilesAvailable: boolean;
}

export type TileProcessingState = UseTileProcessingReturn;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
const POLL_INTERVAL = 2000;

export function useTileProcessing(twinId: string | undefined): UseTileProcessingReturn {
  const [status, setStatus] = useState<TileJobStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [result, setResult] = useState<TileJobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tilesAvailable, setTilesAvailable] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const jobIdRef = useRef<string | null>(null);

  // Check if tiles already exist on mount
  useEffect(() => {
    if (!twinId) return;

    setStatus('checking');
    fetch(`${API_BASE}/api/tiles/${encodeURIComponent(twinId)}/status`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.available) {
          setStatus('available');
          setTilesAvailable(true);
        } else {
          setStatus('idle');
        }
      })
      .catch(() => setStatus('idle'));

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [twinId]);

  // Poll job status
  const pollJob = useCallback((jobId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tiles/${encodeURIComponent(twinId!)}/job/${jobId}`);
        if (!res.ok) return;

        const job = await res.json();
        setProgress(job.progress ?? 0);
        setCurrentStep(job.current_step ?? '');

        if (job.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus('completed');
          setResult(job.result);
          setTilesAvailable(true);
          setProgress(100);
        } else if (job.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus('failed');
          setError(job.error ?? 'Error desconocido');
        } else {
          setStatus('running');
        }
      } catch {
        // Network error, keep polling
      }
    }, POLL_INTERVAL);
  }, [twinId]);

  const startProcessing = useCallback(async () => {
    if (!twinId) return;

    setStatus('queued');
    setProgress(0);
    setCurrentStep('Iniciando...');
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/tiles/${encodeURIComponent(twinId)}/process`, {
        method: 'POST',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Error de red' }));
        setStatus('failed');
        setError(err.error || err.detail || 'Error al iniciar procesamiento');
        return;
      }

      const data = await res.json();
      jobIdRef.current = data.jobId;
      setStatus('queued');
      pollJob(data.jobId);
    } catch (err) {
      setStatus('failed');
      setError('No se pudo conectar con el servidor');
    }
  }, [twinId, pollJob]);

  return { status, progress, currentStep, result, error, startProcessing, tilesAvailable };
}
