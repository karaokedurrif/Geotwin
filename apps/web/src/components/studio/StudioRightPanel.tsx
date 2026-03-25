import {
  Wifi,
  Thermometer,
  Leaf,
  Gauge,
  Radio,
  MapPin,
  AlertTriangle,
  Navigation,
  Zap,
  Wind,
  Droplets,
  Flame,
  TrendingUp,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import type { TwinSnapshot, VisualStyle } from '@/lib/twinStore';
import type { StudioMode } from './StudioBottomBar';
import type { TileProcessingState } from '@/hooks/useTileProcessing';
import TileProcessingCard from './TileProcessingCard';
import styles from '@/styles/studio.module.css';

interface StudioRightPanelProps {
  activeMode: StudioMode;
  visualStyle: VisualStyle;
  layerState: Record<string, boolean>;
  snapshot: TwinSnapshot;
  tileProcessing?: TileProcessingState;
  onVisualStyleChange: (update: Partial<VisualStyle>) => void;
  onLayerToggle: (id: string) => void;
}

const MODO_LABELS: Record<StudioMode, string> = {
  terrain: 'Terreno',
  iot: 'Red IoT LoRa',
  ganado: 'Ganado',
  bim: 'Infraestructura BIM',
  dron: 'Control Dron',
  sim: 'Simulaciones',
  xr: 'XR / Holográfico',
};

export default function StudioRightPanel({
  activeMode,
  visualStyle,
  layerState,
  snapshot,
  tileProcessing,
  onVisualStyleChange,
  onLayerToggle,
}: StudioRightPanelProps) {
  return (
    <aside className={styles.studioRightPanel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>{MODO_LABELS[activeMode]}</div>
      </div>

      <div className={styles.panelContent}>
        {activeMode === 'terrain' && (
          <>
            {tileProcessing && (
              <TileProcessingCard
                status={tileProcessing.status}
                progress={tileProcessing.progress}
                currentStep={tileProcessing.currentStep}
                error={tileProcessing.error}
                onStart={tileProcessing.startProcessing}
              />
            )}
            <TerrainModeContent
              style={visualStyle}
              layers={layerState}
              onChange={onVisualStyleChange}
              onLayerToggle={onLayerToggle}
            />
          </>
        )}
        {activeMode === 'iot' && <IoTModeContent snapshot={snapshot} />}
        {activeMode === 'ganado' && <GanadoModeContent snapshot={snapshot} />}
        {activeMode === 'dron' && <DronModeContent snapshot={snapshot} />}
        {activeMode === 'sim' && <SimModeContent snapshot={snapshot} />}
        {activeMode === 'bim' && (
          <PanelProximo icono={<Zap size={14} />} titulo="Infraestructura BIM" fase={3} />
        )}
        {activeMode === 'xr' && (
          <PanelProximo icono={<Navigation size={14} />} titulo="Mesa Holográfica + AR" fase={4} />
        )}
      </div>
    </aside>
  );
}

// ── Placeholder para capas próximas ──────────────────────────────────────────

function PanelProximo({
  icono,
  titulo,
  fase,
}: {
  icono: React.ReactNode;
  titulo: string;
  fase: number;
}) {
  return (
    <div className={styles.comingSoon}>
      <span style={{ color: '#45454D' }}>{icono}</span>
      <span style={{ color: '#6B6B73', fontSize: '11px', fontWeight: 600 }}>{titulo}</span>
      <span className={styles.comingSoonSubtext}>Disponible en Fase {fase}</span>
    </div>
  );
}

// ── Panel TERRENO ─────────────────────────────────────────────────────────────

function TerrainModeContent({
  style,
  layers,
  onChange,
  onLayerToggle,
}: {
  style: VisualStyle;
  layers: Record<string, boolean>;
  onChange: (update: Partial<VisualStyle>) => void;
  onLayerToggle: (id: string) => void;
}) {
  const PRESETS = [
    { id: 'natural', label: 'Natural', color: '#00d4ff', changes: { fillColor: '#00d4ff', fillOpacity: 0.09, boundaryColor: '#f0c040', terrainExaggeration: 2.0, enableLighting: true, timeOfDay: '2026-06-15T09:30:00Z' } },
    { id: 'topo', label: 'Topográfico', color: '#f59e0b', changes: { fillColor: '#f59e0b', fillOpacity: 0.14, boundaryColor: '#dc2626', terrainExaggeration: 3.0, enableLighting: true, timeOfDay: '2026-06-15T14:00:00Z' } },
    { id: 'ndvi', label: 'NDVI', color: '#22c55e', changes: { fillColor: '#22c55e', fillOpacity: 0.16, boundaryColor: '#ffffff', terrainExaggeration: 2.0, enableLighting: true, timeOfDay: '2026-06-15T12:00:00Z' } },
    { id: 'night', label: 'Nocturno', color: '#818cf8', changes: { fillColor: '#818cf8', fillOpacity: 0.22, boundaryColor: '#38bdf8', terrainExaggeration: 2.5, enableLighting: true, timeOfDay: '2026-06-15T22:30:00Z' } },
    { id: 'minimal', label: 'Minimal', color: '#e8e8ec', changes: { fillColor: '#ffffff', fillOpacity: 0.05, boundaryColor: '#1a5e35', terrainExaggeration: 2.0, enableLighting: false, timeOfDay: '2026-06-15T12:00:00Z' } },
    { id: 'pendientes', label: 'Pendientes', color: '#ef4444', changes: { fillColor: '#ef4444', fillOpacity: 0.22, boundaryColor: '#f97316', terrainExaggeration: 4.0, enableLighting: true, timeOfDay: '2026-06-15T10:00:00Z' } },
  ];

  const SUN_TIMES = [
    { label: 'Alba', time: '2026-06-15T06:00:00Z' },
    { label: 'Mañana', time: '2026-06-15T09:30:00Z' },
    { label: 'Mediodía', time: '2026-06-15T12:00:00Z' },
    { label: 'Tarde', time: '2026-06-15T18:00:00Z' },
    { label: 'Noche', time: '2026-06-15T22:30:00Z' },
  ];

  const FILL_COLORS = ['#00d4ff', '#22c55e', '#f59e0b', '#818cf8', '#ef4444', '#ffffff', '#f0c040', '#a78bfa'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Section label="Apariencia">
        <div className={styles.presetGrid}>
          {PRESETS.map((p) => {
            const activo = style.fillColor === p.changes.fillColor;
            return (
              <button
                key={p.id}
                className={`${styles.presetBtn} ${activo ? styles.presetBtnActive : ''}`}
                onClick={() => onChange(p.changes)}
              >
                <span
                  className={styles.presetBtnIcon}
                  style={{ display: 'block', width: 18, height: 18, borderRadius: '50%', background: p.color, margin: '0 auto' }}
                />
                <span className={`${styles.presetBtnLabel} ${activo ? styles.presetBtnLabelActive : ''}`}>
                  {p.label}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="Hora solar">
        <div style={{ display: 'flex', gap: 3 }}>
          {SUN_TIMES.map((s) => {
            const activo = style.timeOfDay === s.time;
            return (
              <button
                key={s.time}
                title={s.label}
                onClick={() => onChange({ timeOfDay: s.time })}
                style={{
                  flex: 1,
                  padding: '5px 2px',
                  border: `1px solid ${activo ? '#10B981' : '#3a3a42'}`,
                  borderRadius: 4,
                  background: activo ? '#10B98115' : '#2a2a2e',
                  fontSize: 8,
                  fontWeight: 700,
                  color: activo ? '#10B981' : '#6B6B73',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.12s',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="Relieve del terreno">
        <SliderRow
          label="Exageración"
          value={style.terrainExaggeration}
          min={1.0}
          max={6.0}
          step={0.25}
          unit="×"
          onChange={(v) => onChange({ terrainExaggeration: v })}
        />
      </Section>

      <Section label="Iluminación">
        <ToggleRow
          label="Sombras solares"
          on={style.enableLighting}
          onChange={(v) => onChange({ enableLighting: v })}
        />
      </Section>

      <Section label="Capas">
        {[
          { id: 'parcel-fill', label: 'Relleno catastral' },
          { id: 'parcel-boundary-line', label: 'Contorno dorado' },
          { id: 'parcel-plinth', label: 'Corte geológico' },
          { id: 'ndvi', label: 'NDVI Real (Sentinel-2)' },
        ].map((layer) => (
          <ToggleRow
            key={layer.id}
            label={layer.label}
            on={layers[layer.id] ?? layer.id !== 'parcel-plinth'}
            onChange={() => onLayerToggle(layer.id)}
          />
        ))}
      </Section>

      <Section label="Color del polígono">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
          {FILL_COLORS.map((hex) => (
            <button
              key={hex}
              onClick={() => onChange({ fillColor: hex })}
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                background: hex,
                border: style.fillColor === hex ? '2px solid #10B981' : '1.5px solid #3a3a42',
                cursor: 'pointer',
                boxShadow: style.fillColor === hex ? '0 0 6px #10B98160' : 'none',
                transition: 'all 0.1s',
              }}
            />
          ))}
        </div>
        <SliderRow
          label="Opacidad"
          value={style.fillOpacity}
          min={0.02}
          max={0.4}
          step={0.01}
          unit="%"
          display={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => onChange({ fillOpacity: v })}
        />
        <SliderRow
          label="Contorno"
          value={style.boundaryWidth ?? 2}
          min={1}
          max={6}
          step={0.5}
          unit="px"
          onChange={(v) => onChange({ boundaryWidth: v })}
        />
      </Section>
    </div>
  );
}

// ── Panel IoT ─────────────────────────────────────────────────────────────────

function IoTModeContent({ snapshot }: { snapshot: TwinSnapshot }) {
  const areaHa = snapshot.parcel?.area_ha ?? 0;
  // Recomendación de gateways basada en el área
  const gatewaysRecomendados = Math.max(1, Math.ceil(areaHa / 300));
  const bridgesRecomendados = gatewaysRecomendados > 1 ? gatewaysRecomendados - 1 : 0;

  const DISPOSITIVOS: Array<{ Icon: LucideIcon; nombre: string; desc: string; color: string }> = [
    { Icon: Radio, nombre: 'Gateway LoRaWAN', desc: `${gatewaysRecomendados} unid. recomendadas`, color: '#10B981' },
    { Icon: Wifi, nombre: 'Bridge relay', desc: `${bridgesRecomendados} unid. según relieve`, color: '#3B82F6' },
    { Icon: Thermometer, nombre: 'Sensor T° / HR', desc: 'Ambiente y suelo', color: '#F59E0B' },
    { Icon: Gauge, nombre: 'Collar GPS+LoRa', desc: 'Por animal', color: '#A78BFA' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Section label="Resumen de cobertura">
        <StatRow label="Área a cubrir" value={`${areaHa.toFixed(0)} ha`} />
        <StatRow label="Gateways recomendados" value={String(gatewaysRecomendados)} />
        <StatRow label="Bridges relay" value={String(bridgesRecomendados)} />
        <StatRow label="Coste estimado" value={`${(gatewaysRecomendados * 280 + bridgesRecomendados * 15).toLocaleString('es-ES')} €`} />
      </Section>

      <Section label="Dispositivos disponibles">
        {DISPOSITIVOS.map((d) => (
          <div
            key={d.nombre}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 0',
              borderBottom: '1px solid #2e2e34',
            }}
          >
            <div style={{ color: d.color, flexShrink: 0 }}>
              <d.Icon size={12} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: '#A0A0A8', fontWeight: 600 }}>{d.nombre}</div>
              <div style={{ fontSize: 10, color: '#6B6B73' }}>{d.desc}</div>
            </div>
          </div>
        ))}
      </Section>

      <Section label="Tipo de explotación">
        {['Extensivo (bovino)', 'Intensivo (porcino)', 'Mixto'].map((tipo) => (
          <button
            key={tipo}
            style={{
              width: '100%',
              padding: '6px 10px',
              marginBottom: 4,
              background: '#2a2a2e',
              border: '1px solid #3a3a42',
              borderRadius: 4,
              color: '#A0A0A8',
              fontSize: 11,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.12s',
            }}
          >
            {tipo}
          </button>
        ))}
      </Section>

      <div style={{ padding: '8px 12px' }}>
        <button
          style={{
            width: '100%',
            padding: '8px',
            background: '#10B981',
            border: 'none',
            borderRadius: 6,
            color: '#1a1a1e',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          Iniciar configurador
        </button>
      </div>
    </div>
  );
}

// ── Panel GANADO ──────────────────────────────────────────────────────────────

function GanadoModeContent({ snapshot }: { snapshot: TwinSnapshot }) {
  const areaHa = snapshot.parcel?.area_ha ?? 0;
  // Carga ganadera estimada: 1 UGM/ha para bovino extensivo
  const ugmMaximo = Math.floor(areaHa * 0.8);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Section label="Capacidad de la finca">
        <StatRow label="Superfície" value={`${areaHa.toFixed(1)} ha`} />
        <StatRow label="Carga máx. (bovino)" value={`${ugmMaximo} UGM`} />
        <StatRow label="Animales simulados" value="25" color="#10B981" />
        <StatRow label="Fuera de polígono" value="1" color="#EF4444" />
      </Section>

      <Section label="Estado del rebaño">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            { label: 'Bien', valor: 23, color: '#10B981', pct: 92 },
            { label: 'Atención', valor: 1, color: '#F59E0B', pct: 4 },
            { label: 'Alerta', valor: 1, color: '#EF4444', pct: 4 },
          ].map((estado) => (
            <div key={estado.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 48, fontSize: 10, color: '#6B6B73' }}>{estado.label}</span>
              <div style={{ flex: 1, height: 4, background: '#2a2a2e', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${estado.pct}%`, height: '100%', background: estado.color, borderRadius: 2 }} />
              </div>
              <span style={{ width: 20, fontSize: 10, color: estado.color, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{estado.valor}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Sensores de collar">
        {[
          { Icon: Thermometer, label: 'Temperatura', valor: '38.4°C', ok: true },
          { Icon: MapPin, label: 'GPS', valor: 'Activo', ok: true },
          { Icon: AlertTriangle, label: 'Geofence', valor: '1 alerta', ok: false },
        ].map(({ Icon, label, valor, ok }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 0',
              borderBottom: '1px solid #2e2e34',
            }}
          >
            <Icon size={11} color={ok ? '#6B6B73' : '#EF4444'} />
            <span style={{ flex: 1, fontSize: 11, color: '#A0A0A8' }}>{label}</span>
            <span style={{ fontSize: 11, color: ok ? '#10B981' : '#EF4444', fontFamily: 'JetBrains Mono, monospace' }}>{valor}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}

// ── Panel DRON ────────────────────────────────────────────────────────────────

function DronModeContent({ snapshot }: { snapshot: TwinSnapshot }) {
  const areaHa = snapshot.parcel?.area_ha ?? 0;
  const tiempoOrto = Math.ceil((areaHa / 100) * 18); // ~18 min/100ha

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Section label="Estado del dron">
        <StatRow label="Altitud" value="-- m" />
        <StatRow label="Velocidad" value="-- km/h" />
        <StatRow label="Batería" value="--%" />
        <StatRow label="Modo" value="En tierra" color="#F59E0B" />
      </Section>

      <Section label="Misiones disponibles">
        {[
          { id: 'explorar', label: 'Exploración libre', desc: 'Control WASD / joystick' },
          { id: 'orto', label: `Ortofoto completa (~${tiempoOrto} min)`, desc: 'Grid automático sobre la finca' },
          { id: 'sector', label: 'Por sector', desc: 'Dividir finca en secciones' },
          { id: 'alerta', label: 'Seguir alerta', desc: 'Volar al collar en alerta' },
        ].map((mision) => (
          <button
            key={mision.id}
            style={{
              width: '100%',
              padding: '6px 10px',
              marginBottom: 4,
              background: '#2a2a2e',
              border: '1px solid #3a3a42',
              borderRadius: 4,
              color: '#A0A0A8',
              fontSize: 11,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.12s',
            }}
          >
            <div style={{ fontWeight: 600 }}>{mision.label}</div>
            <div style={{ fontSize: 10, color: '#6B6B73', marginTop: 1 }}>{mision.desc}</div>
          </button>
        ))}
      </Section>

      <div style={{ padding: '8px 12px' }}>
        <button
          style={{
            width: '100%',
            padding: '8px',
            background: '#3B82F6',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <Navigation size={12} />
          Activar control dron
        </button>
      </div>
    </div>
  );
}

// ── Panel SIMULACIONES ────────────────────────────────────────────────────────

function SimModeContent({ snapshot }: { snapshot: TwinSnapshot }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Section label="Módulos disponibles">
        {[
          { Icon: Flame, label: 'Incendio forestal', desc: 'Modelo Rothermel + EFFIS', color: '#EF4444', disponible: true },
          { Icon: TrendingUp, label: 'Financiera', desc: 'Monte Carlo 10.000 iter.', color: '#10B981', disponible: true },
          { Icon: Wind, label: 'Climática', desc: 'Sequía, nevadas, ola calor', color: '#3B82F6', disponible: true },
          { Icon: Droplets, label: 'Hidrológica', desc: 'Flujo e inundaciones', color: '#06B6D4', disponible: false },
          { Icon: Leaf, label: 'NDVI dinámico', desc: 'Evolución vegetación', color: '#22C55E', disponible: false },
          { Icon: Sun, label: 'Energía solar', desc: 'Irradiación sobre parcela', color: '#F59E0B', disponible: false },
        ].map(({ Icon, label, desc, color, disponible }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 0',
              borderBottom: '1px solid #2e2e34',
              opacity: disponible ? 1 : 0.4,
              cursor: disponible ? 'pointer' : 'not-allowed',
            }}
          >
            <div style={{ color, flexShrink: 0 }}>
              <Icon size={12} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: '#A0A0A8', fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 10, color: '#6B6B73' }}>{desc}</div>
            </div>
            {disponible && (
              <span style={{ fontSize: 9, color: '#10B981', fontWeight: 700 }}>INICIAR</span>
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}

// ── Sub-componentes reutilizables ─────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid #2e2e34' }}>
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: '#45454D',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: 8,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid #2e2e34' }}>
      <span style={{ fontSize: 11, color: '#6B6B73' }}>{label}</span>
      <span style={{ fontSize: 11, color: color ?? '#A0A0A8', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  display?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 6,
        fontSize: 11,
        color: '#6B6B73',
      }}
    >
      <label style={{ width: 64, flexShrink: 0, fontSize: 11 }}>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: '#10B981', cursor: 'pointer' }}
      />
      <code
        style={{
          width: 36,
          textAlign: 'right',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          color: '#10B981',
          flexShrink: 0,
        }}
      >
        {display ? display(value) : `${value}${unit}`}
      </code>
    </div>
  );
}

function ToggleRow({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '5px 0',
        cursor: 'pointer',
        borderTop: '1px solid #2e2e34',
      }}
    >
      <span style={{ fontSize: 11, color: '#A0A0A8' }}>{label}</span>
      <div
        style={{
          width: 28,
          height: 14,
          borderRadius: 7,
          position: 'relative',
          background: on ? '#10B98130' : '#3a3a42',
          transition: 'background 0.18s',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: on ? '#10B981' : '#6B6B73',
            top: 2,
            left: on ? 16 : 2,
            transition: 'all 0.18s',
          }}
        />
      </div>
    </div>
  );
}

