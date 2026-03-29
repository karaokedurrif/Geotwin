'use client';

import { useState } from 'react';
import { Calendar } from 'lucide-react';

interface HtTimeSelectorProps {
  value: { desde: string; hasta: string };
  onChange: (periodo: { desde: string; hasta: string }) => void;
}

const PRESETS = [
  { label: 'Último mes', months: 1 },
  { label: '3 meses', months: 3 },
  { label: '6 meses', months: 6 },
  { label: '1 año', months: 12 },
  { label: 'Todo', months: 0 },
] as const;

function subtractMonths(date: string, months: number): string {
  const [y, m] = date.split('-').map(Number);
  const d = new Date(y, m - 1 - months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function HtTimeSelector({ value, onChange }: HtTimeSelectorProps) {
  const [active, setActive] = useState<number | null>(null);
  const now = '2026-03';

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-3.5 w-3.5 text-slate-500" />
      <div className="flex gap-1">
        {PRESETS.map((preset, i) => (
          <button
            key={preset.label}
            onClick={() => {
              setActive(i);
              onChange({
                desde: preset.months === 0 ? '2014-10' : subtractMonths(now, preset.months),
                hasta: now,
              });
            }}
            className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
              active === i
                ? 'bg-cyan-500/20 text-cyan-400'
                : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <span className="ml-2 text-[11px] text-slate-600">
        {value.desde} → {value.hasta}
      </span>
    </div>
  );
}
