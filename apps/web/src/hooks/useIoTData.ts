/**
 * useIoTData — Hook for fetching and managing IoT sensor data.
 * 
 * Provides:
 * - Latest readings per sensor
 * - Time-series data for charts
 * - Auto-refresh every 30s
 * - Seed data generation
 */
import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || '';

export interface SensorReading {
  id: string;
  type: string;
  name: string;
  lon: number;
  lat: number;
  value: number | null;
  unit: string;
  status: string;
  lastReading: string | null;
  quality: number | null;
}

export interface TimeSeriesPoint {
  bucket: string;
  sensor_id: string;
  avg_value: number;
  min_value: number;
  max_value: number;
  samples: number;
}

export interface IoTStats {
  sensorsByType: Array<{ type: string; count: string; online: string; issues: string }>;
  last24h: { total_readings: string; active_sensors: string };
  activeAlerts: Array<{ severity: string; count: string }>;
}

export interface IoTAlert {
  id: number;
  sensor_id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  acknowledged: boolean;
  created_at: string;
}

export interface IoTDataState {
  sensors: SensorReading[];
  stats: IoTStats | null;
  alerts: IoTAlert[];
  timeSeries: TimeSeriesPoint[];
  loading: boolean;
  error: string | null;
  hasData: boolean;
  refresh: () => void;
  seedData: (days?: number) => Promise<{ readingsGenerated: number }>;
  fetchTimeSeries: (sensorId?: string, from?: string, to?: string, interval?: string) => Promise<void>;
}

export function useIoTData(twinId: string | undefined): IoTDataState {
  const [sensors, setSensors] = useState<SensorReading[]>([]);
  const [stats, setStats] = useState<IoTStats | null>(null);
  const [alerts, setAlerts] = useState<IoTAlert[]>([]);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLatest = useCallback(async () => {
    if (!twinId) return;
    try {
      const [sensorsRes, statsRes, alertsRes] = await Promise.all([
        fetch(`${API_BASE}/api/iot/${twinId}/readings/latest`),
        fetch(`${API_BASE}/api/iot/${twinId}/stats`),
        fetch(`${API_BASE}/api/iot/${twinId}/alerts`),
      ]);

      if (sensorsRes.ok) {
        const data = await sensorsRes.json();
        setSensors(data.sensors || []);
      }
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
      if (alertsRes.ok) {
        const data = await alertsRes.json();
        setAlerts(data.alerts || []);
      }
      setError(null);
    } catch (e: any) {
      // DB not available yet is not an error worth showing
      if (!error) setError(null);
    }
  }, [twinId]);

  const fetchTimeSeries = useCallback(async (
    sensorId?: string,
    from?: string,
    to?: string,
    interval: string = '1 hour',
  ) => {
    if (!twinId) return;
    const params = new URLSearchParams({ interval });
    if (sensorId) params.set('sensor_id', sensorId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    try {
      const res = await fetch(`${API_BASE}/api/iot/${twinId}/readings?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTimeSeries(data.data || []);
      }
    } catch { /* ignore */ }
  }, [twinId]);

  const seedData = useCallback(async (days: number = 7) => {
    if (!twinId) return { readingsGenerated: 0 };
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/iot/${twinId}/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, interval_minutes: 15 }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchLatest();
        return data;
      }
      throw new Error(data.error || 'Seed failed');
    } catch (e: any) {
      setError(e.message);
      return { readingsGenerated: 0 };
    } finally {
      setLoading(false);
    }
  }, [twinId, fetchLatest]);

  const refresh = useCallback(() => {
    fetchLatest();
  }, [fetchLatest]);

  // Initial load + polling
  useEffect(() => {
    if (!twinId) return;
    fetchLatest();
    intervalRef.current = setInterval(fetchLatest, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [twinId, fetchLatest]);

  return {
    sensors,
    stats,
    alerts,
    timeSeries,
    loading,
    error,
    hasData: sensors.length > 0,
    refresh,
    seedData,
    fetchTimeSeries,
  };
}
