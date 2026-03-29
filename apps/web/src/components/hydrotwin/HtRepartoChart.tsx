'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import type { LecturaMensual } from '@/lib/hydrotwin/barbo-types';
import { HT_COLORS } from '@/lib/hydrotwin/barbo-constants';

interface HtRepartoChartProps {
  lecturas: LecturaMensual[];
}

function isAnomalia(fecha: string): boolean {
  const [y, m] = fecha.split('-').map(Number);
  return y === 2022 && m >= 1 && m <= 6;
}

export function HtRepartoChart({ lecturas }: HtRepartoChartProps) {
  const data = lecturas.map(l => ({
    fecha: l.fecha,
    pliego: l.repartoPliego,
    librilla: l.repartoLibrilla,
    anomalia: isAnomalia(l.fecha),
  }));

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Reparto Pliego / Librilla</h3>
          <p className="text-[11px] text-slate-500">Distribución mensual por zona de riego</p>
        </div>
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: HT_COLORS.pliego }} />Pliego</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: HT_COLORS.librilla }} />Librilla</span>
          <span className="flex items-center gap-1 text-amber-400">⚠ Anomalía 2022</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="fecha"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            interval={11}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
            width={45}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#111118',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
            }}
            labelStyle={{ color: '#94a3b8' }}
            formatter={(value, name) => [
              `${Number(value).toLocaleString('es-ES')} m³`,
              name === 'pliego' ? 'Pliego' : 'Librilla',
            ]}
          />
          <Bar dataKey="pliego" stackId="reparto" fill={HT_COLORS.pliego} radius={[0, 0, 0, 0]} />
          <Bar dataKey="librilla" stackId="reparto" radius={[2, 2, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.anomalia ? HT_COLORS.aviso : HT_COLORS.librilla}
                fillOpacity={entry.anomalia ? 0.8 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
