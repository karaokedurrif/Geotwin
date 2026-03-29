import Link from 'next/link';
import { Droplets, Menu, Wifi, WifiOff, AlertTriangle } from 'lucide-react';

interface HtHeaderProps {
  estadoConexion: 'online' | 'offline' | 'degradado';
  onToggleSidebar: () => void;
}

const STATUS_MAP = {
  online: { icon: Wifi, color: 'text-emerald-400', label: 'Online' },
  offline: { icon: WifiOff, color: 'text-red-400', label: 'Offline' },
  degradado: { icon: AlertTriangle, color: 'text-amber-400', label: 'Degradado' },
} as const;

export function HtHeader({ estadoConexion, onToggleSidebar }: HtHeaderProps) {
  const status = STATUS_MAP[estadoConexion];
  const StatusIcon = status.icon;

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-white/[0.06] bg-[#111118]/90 px-4 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>

        <Link href="/hydrotwin/barbo" className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 transition-colors">
          <Droplets className="h-5 w-5" />
          <span className="font-semibold text-sm tracking-tight">HydroTwin</span>
        </Link>

        <span className="text-slate-500 text-sm">·</span>
        <span className="text-slate-300 text-sm font-medium">Aguas del Barbo</span>
      </div>

      <div className="flex items-center gap-4">
        <div className={`flex items-center gap-1.5 text-xs ${status.color}`}>
          <StatusIcon className="h-3.5 w-3.5" />
          <span>{status.label}</span>
        </div>

        <Link
          href="https://geotwin.es"
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          GeoTwin
        </Link>
      </div>
    </header>
  );
}
