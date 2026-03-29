'use client';

import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceArea, ComposedChart, Bar,
} from 'recharts';
import type { LecturaMensual } from '@/lib/hydrotwin/barbo-types';
import { HT_COLORS } from '@/lib/hydrotwin/barbo-constants';

interface HtEnergiaChartProps {
  lecturas: LecturaMensual[];
}

export function HtEnergiaChart({ lecturas }: HtEnergiaChartProps) {
  const data = lecturas.map(l => ({
    fecha: l.fecha,
    kwhPorM3: l.kwhPorM3,
    kwhTotal: l.kwhTotal,
  }));

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Energía</h3>
          <p className="text-[11px] text-slate-500">Coste energético unitario y consumo total</p>
        </div>
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />kWh/m³</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-400/40" />kWh total</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradKwh" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={HT_COLORS.primary} stopOpacity={0.15} />
              <stop offset="100%" stopColor={HT_COLORS.primary} stopOpacity={0.02} />
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
            yAxisId="kwh"
            orientation="right"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
            width={40}
          />
          <YAxis
            yAxisId="ratio"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            domain={[0.3, 0.85]}
            width={35}
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
            formatter={(value, name) => {
              const v = Number(value);
              if (name === 'kwhPorM3') return [`${v.toFixed(3)} kWh/m³`, 'Ratio'];
              return [`${v.toLocaleString('es-ES')} kWh`, 'Total'];
            }}
          />
          {/* Acceptable range band for kWh/m³ */}
          <ReferenceArea
            yAxisId="ratio"
            y1={0.45}
            y2={0.58}
            fill={HT_COLORS.ok}
            fillOpacity={0.05}
            label={{ value: 'Rango aceptable', position: 'insideTopLeft', fill: '#10b981', fontSize: 9, opacity: 0.5 }}
          />
          <Area
            yAxisId="kwh"
            type="monotone"
            dataKey="kwhTotal"
            stroke={HT_COLORS.primary}
            fill="url(#gradKwh)"
            strokeWidth={1}
            strokeOpacity={0.4}
          />
          <Line
            yAxisId="ratio"
            type="monotone"
            dataKey="kwhPorM3"
            stroke={HT_COLORS.aviso}
            strokeWidth={1.5}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
