import type { EstadoAcuifero } from '@/lib/hydrotwin/barbo-types';
import { HT_COLORS } from '@/lib/hydrotwin/barbo-constants';
import { Thermometer, TrendingDown, TrendingUp, Minus, CloudRain } from 'lucide-react';

interface HtAcuiferoWidgetProps {
  acuifero: EstadoAcuifero;
}

const TENDENCIA_ICON = {
  subiendo: TrendingUp,
  estable: Minus,
  bajando: TrendingDown,
} as const;

const ESTADO_BADGE = {
  buen_estado: { label: 'Buen estado', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  riesgo: { label: 'En riesgo', className: 'bg-red-500/10 text-red-400 border-red-500/20' },
  mal_estado: { label: 'Mal estado', className: 'bg-red-600/20 text-red-300 border-red-500/30' },
} as const;

export function HtAcuiferoWidget({ acuifero }: HtAcuiferoWidgetProps) {
  const TendenciaIcon = TENDENCIA_ICON[acuifero.tendencia];
  const badge = ESTADO_BADGE[acuifero.estadoRegulatorio];

  // Gauge: piezometric level relative to a reference range (400–450 m.s.n.m.)
  const gaugeMin = 400;
  const gaugeMax = 450;
  const gaugePercent = Math.max(0, Math.min(100, ((acuifero.nivelPiezometrico - gaugeMin) / (gaugeMax - gaugeMin)) * 100));

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Thermometer className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-200">Acuífero Sierra Espuña</h3>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      {/* Semi-circular gauge */}
      <div className="flex justify-center mb-4">
        <div className="relative w-36 h-[72px]">
          <svg viewBox="0 0 120 65" className="w-full h-full">
            {/* Background arc */}
            <path
              d="M 10 60 A 50 50 0 0 1 110 60"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            {/* Value arc */}
            <path
              d="M 10 60 A 50 50 0 0 1 110 60"
              fill="none"
              stroke={acuifero.tendencia === 'bajando' ? HT_COLORS.alarma : HT_COLORS.ok}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${gaugePercent * 1.57} 200`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
            <span className="text-lg font-bold text-slate-100" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {acuifero.nivelPiezometrico}
            </span>
            <span className="text-[9px] text-slate-500">m.s.n.m.</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2 rounded-lg bg-white/[0.02] p-2">
          <TendenciaIcon className="h-3.5 w-3.5 text-slate-400" />
          <div>
            <span className="text-[10px] text-slate-500 block">Tendencia</span>
            <span className="text-xs font-medium text-slate-300 capitalize">{acuifero.tendencia}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-white/[0.02] p-2">
          <CloudRain className="h-3.5 w-3.5 text-slate-400" />
          <div>
            <span className="text-[10px] text-slate-500 block">Precipitación 12m</span>
            <span className="text-xs font-medium text-slate-300" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {acuifero.precipitacionAcumulada} mm
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
