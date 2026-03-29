import type { TramoCanal } from '@/lib/hydrotwin/barbo-types';
import { HT_COLORS } from '@/lib/hydrotwin/barbo-constants';

interface HtCanalStatusProps {
  tramos: TramoCanal[];
}

const ESTADO_COLORS = {
  ok: HT_COLORS.ok,
  aviso: HT_COLORS.aviso,
  alarma: HT_COLORS.alarma,
} as const;

const TIPO_ICONS = {
  entubado: '║',
  cielo_abierto: '〰',
} as const;

export function HtCanalStatus({ tramos }: HtCanalStatusProps) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-200">Estado del canal</h3>
        <p className="text-[11px] text-slate-500">Diagrama de tramos con pérdidas estimadas</p>
      </div>

      {/* Pipeline diagram */}
      <div className="flex items-center gap-0 overflow-x-auto py-4">
        {/* Source node: Pozo */}
        <div className="flex flex-col items-center gap-1 shrink-0 min-w-[60px]">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-cyan-500/50 bg-cyan-500/10">
            <span className="text-sm">💧</span>
          </div>
          <span className="text-[10px] font-medium text-slate-300">Pozo</span>
        </div>

        {tramos.map((tramo, i) => {
          const color = ESTADO_COLORS[tramo.estado];
          const isBifurcacion = tramo.nombre.includes('Bifurcación');

          return (
            <div key={tramo.id} className="flex items-center shrink-0">
              {/* Segment line */}
              <div className="relative flex flex-col items-center">
                <div
                  className="h-1.5 rounded-full"
                  style={{
                    width: `${Math.max(60, tramo.longitudKm * 16)}px`,
                    background: color,
                    opacity: 0.6,
                  }}
                />
                <div className="mt-1 flex flex-col items-center">
                  <span className="text-[9px] text-slate-500">
                    {TIPO_ICONS[tramo.tipo]} {tramo.longitudKm} km
                  </span>
                  <span
                    className="text-[10px] font-medium"
                    style={{ color }}
                  >
                    -{tramo.perdidasEstimadas}%
                  </span>
                </div>
              </div>

              {/* Node */}
              <div className="flex flex-col items-center gap-1 min-w-[60px]">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full border-2"
                  style={{ borderColor: color, backgroundColor: `${color}15` }}
                >
                  <span className="text-[10px]">
                    {isBifurcacion ? '⑂' : `N${i + 1}`}
                  </span>
                </div>
                <span className="text-[9px] text-slate-400 text-center max-w-[70px] leading-tight">
                  {tramo.nombre.split(' → ')[1] || tramo.nombre}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex gap-4 border-t border-white/[0.04] pt-3">
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="h-2 w-2 rounded-full" style={{ background: HT_COLORS.ok }} />
          <span className="text-slate-500">OK (&lt;3%)</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="h-2 w-2 rounded-full" style={{ background: HT_COLORS.aviso }} />
          <span className="text-slate-500">Aviso (3-5%)</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="h-2 w-2 rounded-full" style={{ background: HT_COLORS.alarma }} />
          <span className="text-slate-500">Alarma (&gt;5%)</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] ml-auto">
          <span className="text-slate-600">║ Entubado</span>
          <span className="text-slate-600">〰 Cielo abierto</span>
        </div>
      </div>
    </div>
  );
}
