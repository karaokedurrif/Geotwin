/**
 * IoTLivePanel — Real IoT dashboard with live sensor data, 
 * time-series mini chart, and alert list.
 */
import React, { useState, useEffect } from 'react';
import {
  Thermometer,
  Droplets,
  Wind,
  Gauge,
  AlertTriangle,
  Radio,
  RefreshCw,
  Database,
  Activity,
  CloudRain,
  Flame,
  type LucideIcon,
} from 'lucide-react';
import type { SensorReading, IoTStats, IoTAlert, TimeSeriesPoint } from '@/hooks/useIoTData';

const SENSOR_ICONS: Record<string, LucideIcon> = {
  TEMPERATURE: Thermometer,
  HUMIDITY: Droplets,
  NH3: Flame,
  CO2: Gauge,
  MOISTURE: Droplets,
  RAIN: CloudRain,
  WIND: Wind,
  WEIGHT: Gauge,
};

const SENSOR_COLORS: Record<string, string> = {
  TEMPERATURE: '#F59E0B',
  HUMIDITY: '#3B82F6',
  NH3: '#EF4444',
  CO2: '#8B5CF6',
  MOISTURE: '#06B6D4',
  RAIN: '#64748B',
  WIND: '#10B981',
  WEIGHT: '#A78BFA',
};

const STATUS_COLORS: Record<string, string> = {
  ok: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  offline: '#6B7280',
};

interface IoTLivePanelProps {
  sensors: SensorReading[];
  stats: IoTStats | null;
  alerts: IoTAlert[];
  timeSeries: TimeSeriesPoint[];
  loading: boolean;
  hasData: boolean;
  onSeed: (days?: number) => Promise<any>;
  onRefresh: () => void;
  onFetchTimeSeries: (sensorId?: string) => void;
  selectedSensor: string | null;
  onSelectSensor: (id: string | null) => void;
}

export default function IoTLivePanel({
  sensors,
  stats,
  alerts,
  timeSeries,
  loading,
  hasData,
  onSeed,
  onRefresh,
  onFetchTimeSeries,
  selectedSensor,
  onSelectSensor,
}: IoTLivePanelProps): React.JSX.Element {
  const [seeding, setSeeding] = useState(false);

  // If no data, show seed button
  if (!hasData && !loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0' }}>
        <div style={{ textAlign: 'center', padding: '16px 8px' }}>
          <Database size={28} style={{ color: '#3a3a42', margin: '0 auto 8px' }} />
          <div style={{ fontSize: 12, color: '#6B6B73', marginBottom: 4 }}>
            Sin datos IoT
          </div>
          <div style={{ fontSize: 10, color: '#45454D', marginBottom: 12 }}>
            Genera sensores simulados con datos realistas de 7 días
          </div>
          <button
            disabled={seeding}
            onClick={async () => {
              setSeeding(true);
              try { await onSeed(7); } finally { setSeeding(false); }
            }}
            style={{
              width: '100%',
              padding: '8px',
              background: seeding ? '#2a2a2e' : '#10B981',
              border: 'none',
              borderRadius: 6,
              color: seeding ? '#6B6B73' : '#1a1a1e',
              fontSize: 11,
              fontWeight: 700,
              cursor: seeding ? 'wait' : 'pointer',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {seeding ? 'Generando datos...' : 'Generar datos IoT demo'}
          </button>
        </div>
      </div>
    );
  }

  // Group sensors by type
  const byType = sensors.reduce<Record<string, SensorReading[]>>((acc, s) => {
    (acc[s.type] = acc[s.type] || []).push(s);
    return acc;
  }, {});

  const totalReadings = stats?.last24h?.total_readings || '0';
  const activeSensors = stats?.last24h?.active_sensors || '0';
  const activeAlerts = alerts.filter(a => !a.acknowledged);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Header stats */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4,
        padding: '8px 12px', borderBottom: '1px solid #2e2e34',
      }}>
        <MiniStat label="Sensores" value={String(sensors.length)} color="#10B981" />
        <MiniStat label="Lecturas 24h" value={formatNum(totalReadings)} color="#3B82F6" />
        <MiniStat label="Alertas" value={String(activeAlerts.length)} color={activeAlerts.length > 0 ? '#EF4444' : '#6B6B73'} />
      </div>

      {/* Refresh */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 12px 0' }}>
        <button
          onClick={onRefresh}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'none', border: 'none', color: '#6B6B73',
            fontSize: 9, cursor: 'pointer',
          }}
        >
          <RefreshCw size={10} className={loading ? 'spin' : ''} />
          Actualizar
        </button>
      </div>

      {/* Sensor list by type */}
      {Object.entries(byType).map(([type, typeSensors]) => {
        const Icon = SENSOR_ICONS[type] || Radio;
        const color = SENSOR_COLORS[type] || '#6B6B73';

        return (
          <div key={type}>
            <div style={{
              padding: '6px 12px 2px', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Icon size={10} style={{ color }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: '#A0A0A8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {type} ({typeSensors.length})
              </span>
            </div>
            {typeSensors.map(sensor => (
              <SensorRow
                key={sensor.id}
                sensor={sensor}
                color={color}
                selected={selectedSensor === sensor.id}
                onClick={() => {
                  onSelectSensor(selectedSensor === sensor.id ? null : sensor.id);
                  if (selectedSensor !== sensor.id) onFetchTimeSeries(sensor.id);
                }}
              />
            ))}
          </div>
        );
      })}

      {/* Mini chart for selected sensor */}
      {selectedSensor && timeSeries.length > 0 && (
        <MiniChart data={timeSeries} sensorId={selectedSensor} />
      )}

      {/* Alerts */}
      {activeAlerts.length > 0 && (
        <div style={{ padding: '8px 12px 4px' }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#A0A0A8', textTransform: 'uppercase',
            letterSpacing: '0.06em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <AlertTriangle size={10} style={{ color: '#EF4444' }} />
            Alertas activas
          </div>
          {activeAlerts.slice(0, 5).map(alert => (
            <div key={alert.id} style={{
              padding: '4px 8px', marginBottom: 2,
              background: alert.severity === 'critical' ? '#EF444410' : '#F59E0B08',
              borderLeft: `2px solid ${alert.severity === 'critical' ? '#EF4444' : '#F59E0B'}`,
              borderRadius: '0 4px 4px 0', fontSize: 10, color: '#A0A0A8',
            }}>
              <div>{alert.message}</div>
              <div style={{ fontSize: 9, color: '#6B6B73', marginTop: 1 }}>
                {new Date(alert.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 8, color: '#6B6B73', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  );
}

function SensorRow({
  sensor, color, selected, onClick,
}: {
  sensor: SensorReading; color: string; selected: boolean; onClick: () => void;
}) {
  const statusColor = STATUS_COLORS[sensor.status] || '#6B6B73';

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '5px 12px', border: 'none',
        background: selected ? '#10B98108' : 'transparent',
        borderLeft: selected ? '2px solid #10B981' : '2px solid transparent',
        cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s',
      }}
    >
      <div style={{
        width: 5, height: 5, borderRadius: '50%',
        background: statusColor, flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: '#A0A0A8', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sensor.name || sensor.id}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>
          {sensor.value != null ? formatValue(sensor.value) : '—'}
        </span>
        <span style={{ fontSize: 9, color: '#6B6B73', marginLeft: 2 }}>{sensor.unit}</span>
      </div>
    </button>
  );
}

function MiniChart({ data, sensorId }: { data: TimeSeriesPoint[]; sensorId: string }) {
  const filtered = data.filter(d => d.sensor_id === sensorId).reverse();
  if (filtered.length < 2) return null;

  const values = filtered.map(d => d.avg_value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const W = 200;
  const H = 40;
  const points = filtered.map((d, i) => {
    const x = (i / (filtered.length - 1)) * W;
    const y = H - ((d.avg_value - min) / range) * (H - 4) - 2;
    return `${x},${y}`;
  });

  const firstTime = new Date(filtered[0].bucket);
  const lastTime = new Date(filtered[filtered.length - 1].bucket);

  return (
    <div style={{ padding: '6px 12px' }}>
      <div style={{ fontSize: 9, color: '#6B6B73', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
        <span>{firstTime.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</span>
        <span>
          <Activity size={8} style={{ marginRight: 2 }} />
          Promedio por hora
        </span>
        <span>{lastTime.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 40, display: 'block' }}
      >
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="#10B981"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Min/Max labels */}
        <text x={W - 2} y={6} textAnchor="end" fill="#6B6B73" fontSize="6">
          {formatValue(max)}
        </text>
        <text x={W - 2} y={H - 1} textAnchor="end" fill="#6B6B73" fontSize="6">
          {formatValue(min)}
        </text>
      </svg>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatValue(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function formatNum(v: string | number): string {
  const n = typeof v === 'string' ? parseInt(v) : v;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
