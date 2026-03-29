'use client';

import { useState } from 'react';
import { Bell, Check, Filter } from 'lucide-react';
import type { AlertaOperativa } from '@/lib/hydrotwin/barbo-types';

interface HtAlertPanelProps {
  alertas: AlertaOperativa[];
}

const TIPO_ICONS: Record<AlertaOperativa['tipo'], string> = {
  perdida: '💧',
  energia: '⚡',
  reparto: '🔀',
  acuifero: '🏔️',
  intrusion: '🧪',
  mantenimiento: '🔧',
};

const SEVERIDAD_COLORS: Record<AlertaOperativa['severidad'], string> = {
  info: 'bg-slate-500/10 border-slate-500/20 text-slate-400',
  aviso: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
  alarma: 'bg-red-500/10 border-red-500/20 text-red-400',
  critica: 'bg-red-600/20 border-red-500/30 text-red-300',
};

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const hours = Math.floor(diff / 3600_000);
  if (hours < 1) return 'hace <1h';
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

type FilterType = 'todas' | 'activas' | 'resueltas';

export function HtAlertPanel({ alertas }: HtAlertPanelProps) {
  const [filter, setFilter] = useState<FilterType>('activas');

  const filtered = alertas.filter(a => {
    if (filter === 'activas') return !a.resuelta;
    if (filter === 'resueltas') return a.resuelta;
    return true;
  });

  const activeCount = alertas.filter(a => !a.resuelta).length;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-200">Alertas</h3>
          {activeCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500/20 px-1.5 text-[10px] font-semibold text-red-400">
              {activeCount}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {(['todas', 'activas', 'resueltas'] as FilterType[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                filter === f
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
        {filtered.length === 0 && (
          <p className="py-4 text-center text-xs text-slate-600">Sin alertas en esta categoría</p>
        )}
        {filtered.map(alerta => (
          <div
            key={alerta.id}
            className={`rounded-lg border p-3 ${SEVERIDAD_COLORS[alerta.severidad]} ${
              alerta.resuelta ? 'opacity-50' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <span className="text-sm">{TIPO_ICONS[alerta.tipo]}</span>
                <div>
                  <p className="text-xs leading-relaxed">{alerta.mensaje}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] opacity-60">
                    <span>{timeAgo(alerta.timestamp)}</span>
                    {alerta.nodoOrigen && <span>· {alerta.nodoOrigen}</span>}
                  </div>
                </div>
              </div>
              {alerta.resuelta && (
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
