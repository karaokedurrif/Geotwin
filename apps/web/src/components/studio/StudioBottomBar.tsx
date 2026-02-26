import type { TwinSnapshot } from '@/lib/twinStore';
import styles from '@/styles/studio.module.css';

type StudioMode = 'terrain' | 'iot' | 'cattle' | 'bim' | 'simulate';

interface ModeDefinition {
  id: StudioMode;
  label: string;
  icon: string;
  desc: string;
  available: boolean;
  phase?: number;
}

const MODES: ModeDefinition[] = [
  {
    id: 'terrain',
    label: 'Terreno',
    icon: '⛰',
    desc: 'Relieve, ortofoto, estilos visuales',
    available: true,
  },
  {
    id: 'iot',
    label: 'Sensores IoT',
    icon: '📡',
    desc: 'Red de sensores y telemetría',
    available: false,
    phase: 2,
  },
  {
    id: 'cattle',
    label: 'Ganado',
    icon: '🐄',
    desc: 'Tracking GPS y salud animal',
    available: false,
    phase: 2,
  },
  {
    id: 'bim',
    label: 'BIM',
    icon: '🏗',
    desc: 'Infraestructura 3D: naves, silos, fosas',
    available: false,
    phase: 3,
  },
  {
    id: 'simulate',
    label: 'Simulador',
    icon: '🎮',
    desc: 'Vuelo helicóptero, estaciones, clima, ganado animado',
    available: true,  // ✅ ACTIVADO: Simulador de finca con dinámicas
  },
];

interface StudioBottomBarProps {
  activeMode: StudioMode;
  snapshot: TwinSnapshot;
  onModeChange: (mode: StudioMode) => void;
}

export default function StudioBottomBar({
  activeMode,
  snapshot,
  onModeChange,
}: StudioBottomBarProps) {
  return (
    <nav className={styles.studioBottomBar}>
      {/* Mode tabs */}
      {MODES.map((mode) => (
        <button
          key={mode.id}
          className={`${styles.modeTab} ${
            activeMode === mode.id ? styles.modeTabActive : ''
          } ${!mode.available ? styles.modeTabLocked : ''}`}
          onClick={() => mode.available && onModeChange(mode.id)}
          title={mode.desc}
          disabled={!mode.available}
        >
          <span className={styles.modeIcon}>{mode.icon}</span>
          <span className={styles.modeLabel}>{mode.label}</span>
          {!mode.available && (
            <span className={styles.modePhaseBadge}>F{mode.phase}</span>
          )}
        </button>
      ))}

      {/* Right side: camera controls (future) */}
      <div className={styles.bottomRight}>
        <div className={styles.twinStats}>
          <span className={styles.statLabel}>
            v{snapshot.version}
          </span>
        </div>
      </div>
    </nav>
  );
}
