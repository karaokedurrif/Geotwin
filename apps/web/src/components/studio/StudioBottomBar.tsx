import {
  Mountain,
  Radio,
  CircleDot,
  Building2,
  Navigation,
  Flame,
  Glasses,
  type LucideIcon,
} from 'lucide-react';
import type { TwinSnapshot } from '@/lib/twinStore';
import styles from '@/styles/studio.module.css';

export type StudioMode = 'terrain' | 'iot' | 'ganado' | 'bim' | 'dron' | 'sim' | 'xr';

interface ModeDefinition {
  id: StudioMode;
  // Etiqueta en español para la UI
  label: string;
  Icon: LucideIcon;
  desc: string;
  available: boolean;
  phase?: number;
}

const MODOS: ModeDefinition[] = [
  {
    id: 'terrain',
    label: 'Terreno',
    Icon: Mountain,
    desc: 'Relieve, ortofoto MDT02+PNOA, estilos visuales',
    available: true,
  },
  {
    id: 'iot',
    label: 'IoT',
    Icon: Radio,
    desc: 'Red de sensores LoRa, gateways, cobertura',
    available: true,
  },
  {
    id: 'ganado',
    label: 'Ganado',
    Icon: CircleDot,
    desc: 'Tracking GPS collares, alertas geofence',
    available: true,
  },
  {
    id: 'bim',
    label: 'BIM',
    Icon: Building2,
    desc: 'Infraestructura 3D: naves, silos, fosas',
    available: false,
    phase: 3,
  },
  {
    id: 'dron',
    label: 'Dron',
    Icon: Navigation,
    desc: 'Control virtual, ortofoto por sectores, misiones',
    available: true,
  },
  {
    id: 'sim',
    label: 'Sim',
    Icon: Flame,
    desc: 'Simulación incendio, financiera, climática',
    available: true,
  },
  {
    id: 'xr',
    label: 'XR',
    Icon: Glasses,
    desc: 'Mesa holográfica virtual + AR',
    available: false,
    phase: 4,
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
      {MODOS.map((modo) => {
        const { Icon } = modo;
        return (
          <button
            key={modo.id}
            className={[
              styles.modeTab,
              activeMode === modo.id ? styles.modeTabActive : '',
              !modo.available ? styles.modeTabLocked : '',
            ].join(' ')}
            onClick={() => modo.available && onModeChange(modo.id)}
            title={modo.desc}
            disabled={!modo.available}
          >
            <span className={styles.modeIcon}>
              <Icon size={13} />
            </span>
            <span className={styles.modeLabel}>{modo.label}</span>
            {!modo.available && (
              <span className={styles.modePhaseBadge}>F{modo.phase}</span>
            )}
          </button>
        );
      })}

      <div className={styles.bottomRight}>
        <div className={styles.twinStats}>
          <span className={styles.statLabel}>v{snapshot.version}</span>
        </div>
      </div>
    </nav>
  );
}
