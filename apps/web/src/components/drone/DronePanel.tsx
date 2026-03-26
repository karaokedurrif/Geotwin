/**
 * DronePanel — Full drone management panel for the right sidebar.
 * Replaces the DronModeContent stub.
 *
 * Features:
 *   - Drone fleet management
 *   - Mission creation & listing
 *   - Flight plan generation with preview
 *   - Image upload
 *   - Processing trigger (ortho + NDVI)
 *   - DJI KMZ export
 */
import { useState, useCallback, useEffect } from 'react';
import {
  Navigation,
  Upload,
  Download,
  Play,
  Plane,
  Camera,
  MapPin,
  Plus,
  ChevronRight,
  ChevronDown,
  Loader2,
  Check,
  AlertCircle,
} from 'lucide-react';
import type { TwinSnapshot } from '@/lib/twinStore';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

// ─── Types ──────────────────────────────────────────────────────

interface Drone {
  id: string;
  name: string;
  model: string;
  type: string;
  status: string;
}

interface Mission {
  id: string;
  name: string;
  type: string;
  status: string;
  drone_id?: string;
  image_count?: number;
  job_id?: string;
  created_at: string;
  plan?: FlightPlan | null;
}

interface FlightPlan {
  type: string;
  altitude_agl: number;
  overlap: number;
  sidelap: number;
  speed: number;
  gsd: number;
  estimated_duration_min: number;
  estimated_photos: number;
  waypoints: number[][];
}

// ─── Main Component ─────────────────────────────────────────────

export default function DronePanel({ snapshot }: { snapshot: TwinSnapshot }) {
  const twinId = snapshot.twinId;
  const [drones, setDrones] = useState<Drone[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedMission, setSelectedMission] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sections state
  const [showFleet, setShowFleet] = useState(false);
  const [showMissions, setShowMissions] = useState(true);
  const [showNewMission, setShowNewMission] = useState(false);

  // Load data
  const fetchData = useCallback(async () => {
    try {
      const [dronesRes, missionsRes] = await Promise.all([
        fetch(`${API_BASE}/api/drones/${encodeURIComponent(twinId)}`),
        fetch(`${API_BASE}/api/drones/${encodeURIComponent(twinId)}/missions`),
      ]);
      if (dronesRes.ok) {
        const d = await dronesRes.json();
        setDrones(d.drones || []);
      }
      if (missionsRes.ok) {
        const m = await missionsRes.json();
        setMissions(m.missions || []);
      }
    } catch {
      // ignore on initial load
    }
  }, [twinId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Register drone
  const handleAddDrone = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/drones/${encodeURIComponent(twinId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Dron ${drones.length + 1}`,
          model: 'DJI Mini 4 Pro',
          type: 'dji',
          payload: { camera_model: '1/1.3" 48MP', sensor_type: 'rgb' },
        }),
      });
      if (!res.ok) throw new Error('Error registrando dron');
      await fetchData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [twinId, drones.length, fetchData]);

  // Create mission
  const handleCreateMission = useCallback(
    async (type: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/drones/${encodeURIComponent(twinId)}/missions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: type === 'orthophoto' ? 'Ortofoto completa' : type === 'ndvi' ? 'NDVI multiespectral' : 'Inspección',
            type,
            aoi_geojson: snapshot.parcel?.geojson || null,
          }),
        });
        if (!res.ok) throw new Error('Error creando misión');
        const mission = await res.json();
        setSelectedMission(mission.id);
        setShowNewMission(false);
        await fetchData();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [twinId, snapshot.parcel?.geojson, fetchData],
  );

  // Generate flight plan
  const handleGeneratePlan = useCallback(
    async (missionId: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/drones/${encodeURIComponent(twinId)}/missions/${encodeURIComponent(missionId)}/plan`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ altitude: 60, overlap: 80, sidelap: 70, speed: 5, type: 'crosshatch', drone_model: 'dji_mini4pro' }),
          },
        );
        if (!res.ok) throw new Error('Error generando plan de vuelo');
        await fetchData();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [twinId, fetchData],
  );

  // Download KMZ
  const handleDownloadKmz = useCallback(
    async (missionId: string) => {
      try {
        const res = await fetch(
          `${API_BASE}/api/drones/${encodeURIComponent(twinId)}/missions/${encodeURIComponent(missionId)}/plan/kmz`,
        );
        if (!res.ok) throw new Error('Error descargando KMZ');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mission_${missionId}.kmz`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e: any) {
        setError(e.message);
      }
    },
    [twinId],
  );

  // Upload images
  const handleUploadImages = useCallback(
    async (missionId: string) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'image/jpeg,image/tiff,.dng';
      input.onchange = async () => {
        if (!input.files?.length) return;
        setLoading(true);
        setError(null);

        const formData = new FormData();
        for (let i = 0; i < input.files.length; i++) {
          formData.append('images', input.files[i]);
        }

        try {
          const res = await fetch(
            `${API_BASE}/api/drones/${encodeURIComponent(twinId)}/missions/${encodeURIComponent(missionId)}/upload`,
            { method: 'POST', body: formData },
          );
          if (!res.ok) throw new Error('Error subiendo imágenes');
          await fetchData();
        } catch (e: any) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      };
      input.click();
    },
    [twinId, fetchData],
  );

  // Trigger processing
  const handleProcess = useCallback(
    async (missionId: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/drones/${encodeURIComponent(twinId)}/missions/${encodeURIComponent(missionId)}/process`,
          { method: 'POST' },
        );
        if (!res.ok) throw new Error('Error lanzando procesamiento');
        await fetchData();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [twinId, fetchData],
  );

  const areaHa = snapshot.parcel?.area_ha ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: '6px 12px',
            background: '#2d1216',
            borderBottom: '1px solid #7f1d1d',
            fontSize: 11,
            color: '#fca5a5',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <AlertCircle size={12} />
          {error}
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 10 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Flota ────────────────────────────────────────────── */}
      <SectionHeader title="Flota de drones" open={showFleet} onToggle={() => setShowFleet(!showFleet)} count={drones.length} />
      {showFleet && (
        <div style={{ padding: '4px 12px 8px' }}>
          {drones.length === 0 && (
            <div style={{ fontSize: 11, color: '#6B6B73', padding: '8px 0' }}>Sin drones registrados</div>
          )}
          {drones.map((d) => (
            <div
              key={d.id}
              style={{
                padding: '6px 8px',
                marginBottom: 4,
                background: '#1e1e22',
                borderRadius: 4,
                border: '1px solid #2e2e34',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Plane size={12} color="#3B82F6" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#E0E0E4', fontWeight: 600 }}>{d.name}</div>
                <div style={{ fontSize: 10, color: '#6B6B73' }}>{d.model}</div>
              </div>
              <span
                style={{
                  fontSize: 9,
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: d.status === 'ready' ? '#052e16' : '#422006',
                  color: d.status === 'ready' ? '#4ade80' : '#fbbf24',
                }}
              >
                {d.status === 'ready' ? 'Listo' : d.status}
              </span>
            </div>
          ))}
          <button onClick={handleAddDrone} disabled={loading} style={addBtnStyle}>
            <Plus size={11} /> Registrar dron
          </button>
        </div>
      )}

      {/* ── Misiones ─────────────────────────────────────────── */}
      <SectionHeader
        title="Misiones"
        open={showMissions}
        onToggle={() => setShowMissions(!showMissions)}
        count={missions.length}
      />
      {showMissions && (
        <div style={{ padding: '4px 12px 8px' }}>
          {missions.map((m) => (
            <MissionCard
              key={m.id}
              mission={m}
              isSelected={selectedMission === m.id}
              onSelect={() => setSelectedMission(selectedMission === m.id ? null : m.id)}
              onGeneratePlan={() => handleGeneratePlan(m.id)}
              onDownloadKmz={() => handleDownloadKmz(m.id)}
              onUpload={() => handleUploadImages(m.id)}
              onProcess={() => handleProcess(m.id)}
              loading={loading}
            />
          ))}

          {!showNewMission ? (
            <button onClick={() => setShowNewMission(true)} style={addBtnStyle}>
              <Plus size={11} /> Nueva misión
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' }}>
              {[
                { type: 'orthophoto', label: 'Ortofoto completa', desc: `Grid automático · ~${Math.ceil((areaHa / 100) * 18)} min` },
                { type: 'ndvi', label: 'NDVI multiespectral', desc: 'Requiere cámara multiespectral' },
                { type: 'inspection', label: 'Inspección visual', desc: 'Ruta libre o por sector' },
              ].map((opt) => (
                <button
                  key={opt.type}
                  onClick={() => handleCreateMission(opt.type)}
                  disabled={loading}
                  style={missionTypeBtnStyle}
                >
                  <div style={{ fontWeight: 600 }}>{opt.label}</div>
                  <div style={{ fontSize: 10, color: '#6B6B73', marginTop: 1 }}>{opt.desc}</div>
                </button>
              ))}
              <button
                onClick={() => setShowNewMission(false)}
                style={{ ...addBtnStyle, color: '#6B6B73' }}
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Quick stats ──────────────────────────────────────── */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #2e2e34' }}>
        <div style={{ fontSize: 10, color: '#6B6B73', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          Resumen
        </div>
        <StatRow label="Área parcela" value={`${areaHa.toFixed(1)} ha`} />
        <StatRow label="Drones registrados" value={String(drones.length)} />
        <StatRow label="Misiones" value={String(missions.length)} />
        <StatRow
          label="Imágenes subidas"
          value={String(missions.reduce((sum, m) => sum + (m.image_count || 0), 0))}
        />
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────

function SectionHeader({
  title,
  open,
  onToggle,
  count,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  count?: number;
}) {
  const Arrow = open ? ChevronDown : ChevronRight;
  return (
    <button
      onClick={onToggle}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 12px',
        background: 'none',
        border: 'none',
        borderBottom: '1px solid #2e2e34',
        color: '#A0A0A8',
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        cursor: 'pointer',
      }}
    >
      <Arrow size={12} />
      {title}
      {count !== undefined && (
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 9,
            background: '#2a2a2e',
            padding: '1px 6px',
            borderRadius: 8,
            color: '#6B6B73',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function MissionCard({
  mission,
  isSelected,
  onSelect,
  onGeneratePlan,
  onDownloadKmz,
  onUpload,
  onProcess,
  loading,
}: {
  mission: Mission;
  isSelected: boolean;
  onSelect: () => void;
  onGeneratePlan: () => void;
  onDownloadKmz: () => void;
  onUpload: () => void;
  onProcess: () => void;
  loading: boolean;
}) {
  const statusColors: Record<string, { bg: string; fg: string; label: string }> = {
    planned: { bg: '#1e293b', fg: '#60a5fa', label: 'Planificada' },
    images_uploaded: { bg: '#1c2333', fg: '#a78bfa', label: 'Imágenes subidas' },
    processing: { bg: '#422006', fg: '#fbbf24', label: 'Procesando' },
    completed: { bg: '#052e16', fg: '#4ade80', label: 'Completada' },
    failed: { bg: '#2d1216', fg: '#f87171', label: 'Error' },
  };
  const st = statusColors[mission.status] || statusColors.planned;

  return (
    <div
      style={{
        marginBottom: 4,
        background: '#1e1e22',
        borderRadius: 4,
        border: `1px solid ${isSelected ? '#3B82F6' : '#2e2e34'}`,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={onSelect}
        style={{
          width: '100%',
          padding: '6px 8px',
          background: 'none',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          color: '#E0E0E4',
        }}
      >
        <Camera size={12} color="#3B82F6" />
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 11, fontWeight: 600 }}>{mission.name}</div>
          <div style={{ fontSize: 10, color: '#6B6B73' }}>{mission.type}</div>
        </div>
        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: st.bg, color: st.fg }}>
          {st.label}
        </span>
      </button>

      {isSelected && (
        <div style={{ padding: '4px 8px 8px', borderTop: '1px solid #2a2a2e' }}>
          {/* Plan info */}
          {mission.plan && (
            <div style={{ marginBottom: 6, padding: '4px 6px', background: '#16161a', borderRadius: 3, fontSize: 10 }}>
              <div style={{ color: '#A0A0A8', marginBottom: 2 }}>
                Plan de vuelo: {mission.plan.type} · {mission.plan.altitude_agl}m AGL
              </div>
              <div style={{ color: '#6B6B73' }}>
                GSD: {mission.plan.gsd} cm/px · ~{mission.plan.estimated_photos} fotos · ~{mission.plan.estimated_duration_min} min
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {mission.status === 'planned' && !mission.plan && (
              <ActionBtn icon={<MapPin size={10} />} label="Generar plan" onClick={onGeneratePlan} loading={loading} />
            )}
            {mission.plan && (
              <ActionBtn icon={<Download size={10} />} label="KMZ DJI" onClick={onDownloadKmz} />
            )}
            {(mission.status === 'planned' || mission.status === 'images_uploaded') && (
              <ActionBtn icon={<Upload size={10} />} label="Subir imágenes" onClick={onUpload} loading={loading} />
            )}
            {mission.status === 'images_uploaded' && (
              <ActionBtn
                icon={<Play size={10} />}
                label="Procesar"
                onClick={onProcess}
                loading={loading}
                primary
              />
            )}
            {mission.status === 'processing' && (
              <div style={{ fontSize: 10, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
                Procesando...
              </div>
            )}
            {mission.status === 'completed' && (
              <div style={{ fontSize: 10, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Check size={10} />
                Productos disponibles
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  loading,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  loading?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        padding: '4px 8px',
        background: primary ? '#3B82F6' : '#2a2a2e',
        border: `1px solid ${primary ? '#3B82F6' : '#3a3a42'}`,
        borderRadius: 3,
        color: primary ? '#fff' : '#A0A0A8',
        fontSize: 10,
        cursor: loading ? 'wait' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        opacity: loading ? 0.6 : 1,
      }}
    >
      {loading ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : icon}
      {label}
    </button>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '2px 0', fontSize: 11 }}>
      <span style={{ flex: 1, color: '#6B6B73' }}>{label}</span>
      <span style={{ color: '#A0A0A8', fontFamily: 'JetBrains Mono, monospace' }}>{value}</span>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const addBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  background: 'none',
  border: '1px dashed #3a3a42',
  borderRadius: 4,
  color: '#A0A0A8',
  fontSize: 11,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  marginTop: 4,
};

const missionTypeBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: '#2a2a2e',
  border: '1px solid #3a3a42',
  borderRadius: 4,
  color: '#A0A0A8',
  fontSize: 11,
  cursor: 'pointer',
  textAlign: 'left',
};
