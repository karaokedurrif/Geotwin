'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { LecturaMensual } from '@/lib/hydrotwin/barbo-types';
import { BARBO, HT_COLORS } from '@/lib/hydrotwin/barbo-constants';

interface HtBalanceChartProps {
  lecturas: LecturaMensual[];
}

export function HtBalanceChart({ lecturas }: HtBalanceChartProps) {
  const data = lecturas.map(l => ({
    fecha: l.fecha,
    extraido: l.volumenExtraido,
    distribuido: l.volumenDistribuido,
    perdidas: l.perdidas,
  }));

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Balance hídrico</h3>
          <p className="text-[11px] text-slate-500">Volumen mensual extraído vs distribuido</p>
        </div>
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-400" />Extraído</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" />Distribuido</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400/60" />Pérdidas</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradExtraido" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={HT_COLORS.primary} stopOpacity={0.3} />
              <stop offset="100%" stopColor={HT_COLORS.primary} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradDistribuido" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={HT_COLORS.ok} stopOpacity={0.3} />
              <stop offset="100%" stopColor={HT_COLORS.ok} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradPerdidas" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={HT_COLORS.alarma} stopOpacity={0.2} />
              <stop offset="100%" stopColor={HT_COLORS.alarma} stopOpacity={0.02} />
            </linearGradient>
          </defs>
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
              name === 'extraido' ? 'Extraído' : name === 'distribuido' ? 'Distribuido' : 'Pérdidas',
            ]}
          />
          <ReferenceLine
            y={BARBO.cupoMensualMedio}
            stroke="#f59e0b"
            strokeDasharray="6 4"
            strokeOpacity={0.5}
            label={{ value: 'Cupo medio', position: 'right', fill: '#f59e0b', fontSize: 9 }}
          />
          <Area
            type="monotone"
            dataKey="extraido"
            stroke={HT_COLORS.primary}
            fill="url(#gradExtraido)"
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="distribuido"
            stroke={HT_COLORS.ok}
            fill="url(#gradDistribuido)"
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="perdidas"
            stroke={HT_COLORS.alarma}
            fill="url(#gradPerdidas)"
            strokeWidth={1}
            strokeOpacity={0.6}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
