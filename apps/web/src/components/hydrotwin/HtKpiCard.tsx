import { HT_COLORS } from '@/lib/hydrotwin/barbo-constants';
import type { KpiCard as KpiCardType } from '@/lib/hydrotwin/barbo-types';

interface HtKpiCardProps {
  kpi: KpiCardType;
}

const COLOR_MAP = {
  ok: HT_COLORS.ok,
  aviso: HT_COLORS.aviso,
  alarma: HT_COLORS.alarma,
} as const;

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 60;
  const h = 20;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.6}
      />
    </svg>
  );
}

function formatValue(value: number, unit: string): string {
  if (unit === 'm³' && value >= 100_000) {
    return `${(value / 1_000).toFixed(0)}k`;
  }
  if (unit === 'm³') {
    return value.toLocaleString('es-ES');
  }
  if (unit === '%') {
    return value.toFixed(1);
  }
  if (unit === 'kWh/m³') {
    return value.toFixed(3);
  }
  return String(value);
}

export function HtKpiCard({ kpi }: HtKpiCardProps) {
  const borderColor = COLOR_MAP[kpi.colorEstado];
  const trendPositive = kpi.tendencia >= 0;
  // For "pérdidas" and "kWh/m³", positive trend is bad
  const isInverse = kpi.id === 'perdidas' || kpi.id === 'kwhm3';
  const trendGood = isInverse ? !trendPositive : trendPositive;

  return (
    <div
      className="rounded-xl border border-white/[0.06] bg-[#111118] p-4 transition-colors hover:border-white/[0.1]"
      style={{ borderLeftWidth: 3, borderLeftColor: borderColor }}
    >
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {kpi.label}
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-2xl font-bold text-slate-100"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {formatValue(kpi.valor, kpi.unidad)}
          </span>
          <span className="text-xs text-slate-500">{kpi.unidad}</span>
        </div>

        <Sparkline data={kpi.sparkline} color={borderColor} />
      </div>

      <div className="mt-2 flex items-center gap-1">
        <span
          className={`text-[11px] font-medium ${
            trendGood ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {trendPositive ? '▲' : '▼'} {Math.abs(kpi.tendencia).toFixed(1)}%
        </span>
        <span className="text-[10px] text-slate-600">vs mes anterior</span>
      </div>
    </div>
  );
}
