import type { TwinSnapshot, VisualStyle } from '@/lib/twinStore';
import styles from '@/styles/studio.module.css';

type StudioMode = 'terrain' | 'iot' | 'cattle' | 'bim' | 'simulate';

interface StudioRightPanelProps {
  activeMode: StudioMode;
  visualStyle: VisualStyle;
  layerState: Record<string, boolean>;
  snapshot: TwinSnapshot;
  onVisualStyleChange: (update: Partial<VisualStyle>) => void;
  onLayerToggle: (id: string) => void;
}

const MODE_LABELS: Record<StudioMode, string> = {
  terrain: 'Terreno',
  iot: 'Sensores IoT',
  cattle: 'Ganado',
  bim: 'Infraestructura BIM',
  simulate: 'Simulación ESG',
};

export default function StudioRightPanel({
  activeMode,
  visualStyle,
  layerState,
  snapshot,
  onVisualStyleChange,
  onLayerToggle,
}: StudioRightPanelProps) {
  return (
    <aside className={styles.studioRightPanel}>
      {/* Panel title matches active mode */}
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>{MODE_LABELS[activeMode]}</div>
      </div>

      <div className={styles.panelContent}>
        {/* Mode-specific content */}
        {activeMode === 'terrain' && (
          <TerrainModeContent
            style={visualStyle}
            layers={layerState}
            onChange={onVisualStyleChange}
            onLayerToggle={onLayerToggle}
          />
        )}

        {activeMode === 'iot' && (
          <div className={styles.comingSoon}>
            <p>📡 Modo Sensores IoT</p>
            <p className={styles.comingSoonSubtext}>Disponible en Fase 2</p>
          </div>
        )}

        {activeMode === 'cattle' && (
          <div className={styles.comingSoon}>
            <p>🐄 Modo Ganado</p>
            <p className={styles.comingSoonSubtext}>Disponible en Fase 2</p>
          </div>
        )}

        {activeMode === 'bim' && (
          <div className={styles.comingSoon}>
            <p>🏗 Modo BIM</p>
            <p className={styles.comingSoonSubtext}>Disponible en Fase 3</p>
          </div>
        )}

        {activeMode === 'simulate' && (
          <div className={styles.comingSoon}>
            <p>🎮 Modo Simulador</p>
            <p className={styles.comingSoonSubtext}>
              Los controles están en el panel flotante sobre el visor 3D.
            </p>
            <p style={{ fontSize: '11px', color: '#999', marginTop: '12px' }}>
              🚁 Vuelo orbital automático<br/>
              🌍 Estaciones del año<br/>
              🌦️ Efectos climáticos<br/>
              🐄 25 animales pastando<br/>
              ⏱️ Velocidad de tiempo
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

// Terrain mode controls
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
    {
      id: 'natural',
      emoji: '🌿',
      label: 'Natural',
      changes: {
        fillColor: '#00d4ff',
        fillOpacity: 0.09,
        boundaryColor: '#f0c040',
        terrainExaggeration: 2.0,
        enableLighting: true,
        timeOfDay: '2026-06-15T09:30:00Z',
      },
    },
    {
      id: 'topo',
      emoji: '🗺',
      label: 'Topográfico',
      changes: {
        fillColor: '#f59e0b',
        fillOpacity: 0.14,
        boundaryColor: '#dc2626',
        terrainExaggeration: 3.0,
        enableLighting: true,
        timeOfDay: '2026-06-15T14:00:00Z',
      },
    },
    {
      id: 'ndvi',
      emoji: '🌱',
      label: 'NDVI',
      changes: {
        fillColor: '#22c55e',
        fillOpacity: 0.16,
        boundaryColor: '#ffffff',
        terrainExaggeration: 2.0,
        enableLighting: true,
        timeOfDay: '2026-06-15T12:00:00Z',
      },
    },
    {
      id: 'night',
      emoji: '🌙',
      label: 'Nocturno',
      changes: {
        fillColor: '#818cf8',
        fillOpacity: 0.22,
        boundaryColor: '#38bdf8',
        terrainExaggeration: 2.5,
        enableLighting: true,
        timeOfDay: '2026-06-15T22:30:00Z',
      },
    },
    {
      id: 'minimal',
      emoji: '◻',
      label: 'Minimal',
      changes: {
        fillColor: '#ffffff',
        fillOpacity: 0.05,
        boundaryColor: '#1a5e35',
        terrainExaggeration: 2.0,
        enableLighting: false,
        timeOfDay: '2026-06-15T12:00:00Z',
      },
    },
    {
      id: 'pendientes',
      emoji: '📐',
      label: 'Pendientes',
      changes: {
        fillColor: '#ef4444',
        fillOpacity: 0.22,
        boundaryColor: '#f97316',
        terrainExaggeration: 4.0,
        enableLighting: true,
        timeOfDay: '2026-06-15T10:00:00Z',
      },
    },
  ];

  const SUN_TIMES = [
    { emoji: '🌅', label: 'Alba', time: '2026-06-15T06:00:00Z' },
    { emoji: '☀️', label: 'Mañana', time: '2026-06-15T09:30:00Z' },
    { emoji: '🔆', label: 'Mediodía', time: '2026-06-15T12:00:00Z' },
    { emoji: '🌇', label: 'Tarde', time: '2026-06-15T18:00:00Z' },
    { emoji: '🌙', label: 'Noche', time: '2026-06-15T22:30:00Z' },
  ];

  const FILL_COLORS = [
    '#00d4ff',
    '#22c55e',
    '#f59e0b',
    '#818cf8',
    '#ef4444',
    '#ffffff',
    '#f0c040',
    '#a78bfa',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* PRESETS */}
      <Section label="Apariencia">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 6,
          }}
        >
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => onChange(p.changes)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '10px 4px',
                border: `1.5px solid ${
                  style.fillColor === p.changes.fillColor ? '#1a5e35' : '#ddd'
                }`,
                borderRadius: 9,
                background:
                  style.fillColor === p.changes.fillColor ? '#e6f7ed' : '#f8f8f8',
                cursor: 'pointer',
                transition: 'all 0.14s',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              <span style={{ fontSize: 20 }}>{p.emoji}</span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color:
                    style.fillColor === p.changes.fillColor ? '#1a5e35' : '#666',
                }}
              >
                {p.label}
              </span>
            </button>
          ))}
        </div>
      </Section>

      {/* HORA SOLAR */}
      <Section label="Hora solar">
        <div style={{ display: 'flex', gap: 4 }}>
          {SUN_TIMES.map((s) => (
            <button
              key={s.time}
              title={s.label}
              onClick={() => onChange({ timeOfDay: s.time })}
              style={{
                flex: 1,
                padding: '7px 2px',
                border: `1px solid ${
                  style.timeOfDay === s.time ? '#1a5e35' : '#ddd'
                }`,
                borderRadius: 6,
                background: style.timeOfDay === s.time ? '#e6f7ed' : '#f8f8f8',
                fontSize: 14,
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.12s',
              }}
            >
              {s.emoji}
            </button>
          ))}
        </div>
      </Section>

      {/* RELIEVE */}
      <Section label="Relieve del terreno">
        <SliderRow
          label="Exageración"
          value={style.terrainExaggeration}
          min={2.0}
          max={5.0}
          step={0.25}
          unit="×"
          onChange={(v) => onChange({ terrainExaggeration: v })}
        />
      </Section>

      {/* ILUMINACIÓN */}
      <Section label="Iluminación">
        <ToggleRow
          label="Sombras solares"
          on={style.enableLighting}
          onChange={(v) => onChange({ enableLighting: v })}
        />
      </Section>

      {/* CAPAS */}
      <Section label="Capas">
        {[
          { id: 'parcel-fill', label: 'Relleno catastral' },
          { id: 'parcel-boundary-line', label: 'Contorno dorado' },
          { id: 'parcel-plinth', label: 'Corte geológico' },
          { id: 'ndvi', label: 'NDVI vegetación' },
        ].map((layer) => (
          <ToggleRow
            key={layer.id}
            label={layer.label}
            on={layers[layer.id] ?? layer.id !== 'parcel-plinth'}
            onChange={() => onLayerToggle(layer.id)}
          />
        ))}
      </Section>

      {/* COLOR */}
      <Section label="Color del polígono">
        <div
          style={{
            display: 'flex',
            gap: 5,
            flexWrap: 'wrap',
            marginBottom: 8,
          }}
        >
          {FILL_COLORS.map((hex) => (
            <button
              key={hex}
              onClick={() => onChange({ fillColor: hex })}
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                background: hex,
                border:
                  style.fillColor === hex
                    ? '2px solid #333'
                    : '1.5px solid rgba(0,0,0,0.12)',
                cursor: 'pointer',
                boxShadow:
                  style.fillColor === hex
                    ? '0 0 0 2px white, 0 0 0 4px #333'
                    : 'none',
                transition: 'transform 0.1s',
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

// ── Sub-componentes ──────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderBottom: '1px solid #ddd',
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontFamily: 'monospace',
          fontWeight: 700,
          color: '#999',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      {children}
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
        marginBottom: 8,
        fontSize: 11,
        color: '#666',
      }}
    >
      <label style={{ width: 64, flexShrink: 0 }}>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: '#1a5e35' }}
      />
      <code
        style={{
          width: 36,
          textAlign: 'right',
          fontFamily: 'monospace',
          fontSize: 10,
          color: '#333',
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
        padding: '6px 0',
        cursor: 'pointer',
        borderTop: '1px solid #ddd',
      }}
    >
      <span style={{ fontSize: 12, color: '#333', fontWeight: 500 }}>
        {label}
      </span>
      {/* Toggle switch */}
      <div
        style={{
          width: 30,
          height: 16,
          borderRadius: 8,
          position: 'relative',
          background: on ? '#1a5e35' : '#ccc',
          transition: 'background 0.18s',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: 'white',
            top: 2,
            left: on ? 16 : 2,
            transition: 'left 0.18s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        />
      </div>
    </div>
  );
}
