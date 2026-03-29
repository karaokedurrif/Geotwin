'use client';

import { useState, useMemo } from 'react';
import type { LecturaMensual } from '@/lib/hydrotwin/barbo-types';
import { compararCampanias } from '@/lib/hydrotwin/barbo-demo-data';
import { HT_COLORS } from '@/lib/hydrotwin/barbo-constants';

interface HtComparadorProps {
  lecturas: LecturaMensual[];
}

// Hydrological years available (Oct–Sep)
function getAvailableCampanias(lecturas: LecturaMensual[]): string[] {
  const years = new Set<number>();
  for (const l of lecturas) {
    const [y, m] = l.fecha.split('-').map(Number);
    // Hydrological year starting in October
    const hy = m >= 10 ? y : y - 1;
    years.add(hy);
  }
  return Array.from(years)
    .sort()
    .filter(y => y >= 2014 && y <= 2025)
    .map(y => `${y}/${y + 1}`);
}

function campaignToPeriodo(label: string) {
  const startYear = parseInt(label.split('/')[0]);
  return {
    desde: `${startYear}-10`,
    hasta: `${startYear + 1}-09`,
  };
}

function formatDelta(value: number, suffix: string, inverse = false): { text: string; className: string } {
  const positive = value > 0;
  const good = inverse ? !positive : positive;
  const sign = positive ? '+' : '';
  return {
    text: `${sign}${typeof value === 'number' && Math.abs(value) < 1 ? value.toFixed(3) : value.toLocaleString('es-ES')}${suffix}`,
    className: good ? 'text-emerald-400' : 'text-red-400',
  };
}

export function HtComparador({ lecturas }: HtComparadorProps) {
  const campanias = useMemo(() => getAvailableCampanias(lecturas), [lecturas]);
  const [selA, setSelA] = useState(campanias[campanias.length - 2] || campanias[0]);
  const [selB, setSelB] = useState(campanias[campanias.length - 1] || campanias[1]);

  const comparison = useMemo(() => {
    if (!selA || !selB) return null;
    return compararCampanias(lecturas, campaignToPeriodo(selA), campaignToPeriodo(selB));
  }, [lecturas, selA, selB]);

  if (!comparison) return null;

  const { campaniaA, campaniaB, deltas } = comparison;

  const rows = [
    { label: 'Volumen total', a: `${(campaniaA.volumenTotal / 1_000_000).toFixed(2)}M m³`, b: `${(campaniaB.volumenTotal / 1_000_000).toFixed(2)}M m³`, delta: formatDelta(deltas.volumenTotal, ' m³') },
    { label: 'Eficiencia media', a: `${(campaniaA.eficienciaMedia * 100).toFixed(1)}%`, b: `${(campaniaB.eficienciaMedia * 100).toFixed(1)}%`, delta: formatDelta(deltas.eficienciaMedia * 100, '%') },
    { label: 'kWh/m³ medio', a: campaniaA.kwhPorM3Medio.toFixed(3), b: campaniaB.kwhPorM3Medio.toFixed(3), delta: formatDelta(deltas.kwhPorM3Medio, '', true) },
    { label: 'Pérdidas totales', a: `${(campaniaA.perdidasTotales / 1000).toFixed(0)}k m³`, b: `${(campaniaB.perdidasTotales / 1000).toFixed(0)}k m³`, delta: formatDelta(deltas.perdidasTotales, ' m³', true) },
    { label: 'Pérdidas (€)', a: `${(campaniaA.perdidasEuros / 1000).toFixed(1)}k€`, b: `${(campaniaB.perdidasEuros / 1000).toFixed(1)}k€`, delta: formatDelta(deltas.perdidasEuros, '€', true) },
    { label: 'Reparto Pliego', a: `${campaniaA.repartoPliegoPct}%`, b: `${campaniaB.repartoPliegoPct}%`, delta: formatDelta(deltas.repartoPliegoPct, '%') },
    { label: 'Pico mensual', a: `${(campaniaA.picoMensual.volumen / 1000).toFixed(0)}k (${campaniaA.picoMensual.fecha})`, b: `${(campaniaB.picoMensual.volumen / 1000).toFixed(0)}k (${campaniaB.picoMensual.fecha})`, delta: null },
  ];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Comparador de campañas</h3>
          <p className="text-[11px] text-slate-500">Año hidrológico (Oct–Sep)</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <select
            value={selA}
            onChange={e => setSelA(e.target.value)}
            className="rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-slate-300 outline-none focus:border-cyan-500/50"
          >
            {campanias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="text-slate-500">vs</span>
          <select
            value={selB}
            onChange={e => setSelB(e.target.value)}
            className="rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-slate-300 outline-none focus:border-cyan-500/50"
          >
            {campanias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="pb-2 text-left font-medium text-slate-500">Métrica</th>
              <th className="pb-2 text-right font-medium text-cyan-400/60">{selA}</th>
              <th className="pb-2 text-right font-medium text-cyan-400">{selB}</th>
              <th className="pb-2 text-right font-medium text-slate-500">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.label} className="border-b border-white/[0.03]">
                <td className="py-2 text-slate-400">{row.label}</td>
                <td className="py-2 text-right text-slate-400" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{row.a}</td>
                <td className="py-2 text-right text-slate-200" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{row.b}</td>
                <td className="py-2 text-right" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  {row.delta ? (
                    <span className={row.delta.className}>{row.delta.text}</span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
