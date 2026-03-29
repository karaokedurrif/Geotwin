import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import Script from 'next/script';
import Link from 'next/link';
import { ArrowLeft, RotateCcw, Loader2 } from 'lucide-react';

// ── Types ──

interface HydroSimData {
  traces: Record<string, unknown>[];
  layout: Record<string, unknown>;
  frames: Record<string, unknown>[];
  crossSections: Record<string, CrossSection>;
  temporalData: TemporalData;
  piezData: PiezReading[];
  kpis: HydroKpis;
  meta: { well_x_km: number; well_y_km: number };
}

interface CrossSection {
  y: number[];
  topo: number[];
  h: number[];
  layer1_bot: number[];
  layer2_bot: number[];
  base: number[];
}

interface TemporalData {
  months: string[];
  Q_pump: number[];
  max_dd: number[];
  infiltration: number[];
  canal_factor: number[];
}

interface PiezReading {
  name: string;
  h: number;
  dd: number;
  depth: number;
}

interface HydroKpis {
  maxDrawdown: number;
  wellQ_ls: number;
  wellQ_m3d: number;
  infiltration: number;
  concesionAnual: number;
  eficiencia2025: number;
}

// ── Plotly global (loaded via CDN Script) ──

declare const Plotly: {
  newPlot: (el: HTMLElement, data: unknown[], layout: unknown, config?: unknown) => Promise<unknown>;
  addFrames: (el: HTMLElement, frames: unknown[]) => Promise<unknown>;
  Plots: { resize: (el: HTMLElement) => void };
};

// ── Constants ──

const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? '')
  : '';

const MONTHS = ['Oct', 'Nov', 'Dic', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep'];

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function HydroTwin3DPage() {
  const [plotlyReady, setPlotlyReady] = useState(false);
  const [data, setData] = useState<HydroSimData | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMonth, setActiveMonth] = useState('Oct');

  // Slider parameter state
  const [pumpLs, setPumpLs] = useState(52);
  const [canalFactor, setCanalFactor] = useState(1.0);
  const [kFactor, setKFactor] = useState(1.0);

  // Refs for Plotly containers
  const plot3dRef = useRef<HTMLDivElement>(null);
  const crossRef = useRef<HTMLDivElement>(null);
  const evoRef = useRef<HTMLDivElement>(null);

  // ── Fetch baseline data ──

  useEffect(() => {
    const url = `${API_BASE}/api/hydrotwin/barbo/3d/simulate`;
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d: HydroSimData) => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  // ── Render 3D plot when data + Plotly ready ──

  useEffect(() => {
    if (!plotlyReady || !data || !plot3dRef.current) return;
    const el = plot3dRef.current;

    Plotly.newPlot(el, data.traces as unknown[], data.layout, {
      responsive: true,
      displayModeBar: true,
      modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
      displaylogo: false,
    }).then(() => {
      if (data.frames.length > 0) {
        Plotly.addFrames(el, data.frames);
      }
    });

    // Listen for slider changes to update cross-section
    (el as unknown as HTMLElement & { on: (evt: string, cb: (e: unknown) => void) => void }).on(
      'plotly_sliderchange',
      (e: unknown) => {
        const ev = e as { slider?: { active?: number } };
        if (ev?.slider?.active !== undefined) {
          setActiveMonth(MONTHS[ev.slider.active]);
        }
      }
    );
  }, [plotlyReady, data]);

  // ── Render cross-section ──

  useEffect(() => {
    if (!plotlyReady || !data || !crossRef.current) return;
    const cs = data.crossSections[activeMonth];
    if (!cs) return;

    const traces = [
      { x: cs.y, y: cs.topo, name: 'Superficie', mode: 'lines', line: { color: '#8B7355', width: 2 }, fill: 'tozeroy', fillcolor: 'rgba(252,255,164,0.08)' },
      { x: cs.y, y: cs.layer1_bot, name: 'Base Capa 1', mode: 'lines', line: { color: '#de4968', width: 1.5, dash: 'dash' } },
      { x: cs.y, y: cs.layer2_bot, name: 'Base Capa 2', mode: 'lines', line: { color: '#3b0f70', width: 1.5, dash: 'dash' } },
      { x: cs.y, y: cs.base, name: 'Base rocosa', mode: 'lines', line: { color: '#5c3d2e', width: 2 }, fill: 'tozeroy', fillcolor: 'rgba(92,61,46,0.15)' },
      { x: cs.y, y: cs.h, name: 'Nivel piezom.', mode: 'lines', line: { color: '#06b6d4', width: 2.5 } },
    ];

    const layout = {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'DM Sans, sans-serif', color: '#888', size: 10 },
      margin: { l: 50, r: 20, t: 25, b: 30 },
      title: { text: `Corte transversal N–S por el pozo · ${activeMonth}`, font: { size: 11, color: '#666' }, x: 0.02 },
      xaxis: { title: { text: 'Eje Y (km)', font: { size: 10 } }, gridcolor: 'rgba(255,255,255,0.04)', tickfont: { size: 9 } },
      yaxis: { title: { text: 'Cota (m.s.n.m.)', font: { size: 10 } }, gridcolor: 'rgba(255,255,255,0.04)', tickfont: { size: 9 } },
      legend: { x: 0.5, y: 1.05, xanchor: 'center', orientation: 'h', font: { size: 9, color: '#777' } },
      shapes: [{ type: 'line', x0: data.meta.well_y_km, x1: data.meta.well_y_km, y0: 280, y1: 440, line: { color: '#ef4444', width: 2, dash: 'dot' } }],
      annotations: [{ x: data.meta.well_y_km, y: 442, text: 'POZO', font: { size: 9, color: '#ef4444', family: 'JetBrains Mono, monospace' }, showarrow: false }],
    };

    Plotly.newPlot(crossRef.current, traces, layout, { responsive: true, displayModeBar: false });
  }, [plotlyReady, data, activeMonth]);

  // ── Render evolution chart ──

  useEffect(() => {
    if (!plotlyReady || !data || !evoRef.current) return;
    const td = data.temporalData;

    const traces = [
      { x: td.months, y: td.Q_pump, name: 'Bombeo (m³/d)', type: 'bar', marker: { color: 'rgba(239,68,68,0.6)' }, yaxis: 'y' },
      { x: td.months, y: td.max_dd, name: 'Desc. máx. (m)', type: 'scatter', mode: 'lines+markers', line: { color: '#06b6d4', width: 2 }, marker: { size: 4 }, yaxis: 'y2' },
      { x: td.months, y: td.infiltration, name: 'Infiltr. canal', type: 'scatter', mode: 'lines', line: { color: '#10b981', width: 1.5, dash: 'dot' }, yaxis: 'y2' },
    ];

    const layout = {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'DM Sans, sans-serif', color: '#888', size: 9 },
      margin: { l: 35, r: 35, t: 10, b: 25 },
      legend: { x: 0, y: 1.15, orientation: 'h', font: { size: 8, color: '#777' } },
      xaxis: { gridcolor: 'rgba(255,255,255,0.04)', tickfont: { size: 8 } },
      yaxis: { gridcolor: 'rgba(255,255,255,0.04)', title: { text: 'm³/d', font: { size: 8 } }, tickfont: { size: 8 }, side: 'left' },
      yaxis2: { overlaying: 'y', side: 'right', gridcolor: 'rgba(255,255,255,0.04)', title: { text: 'm', font: { size: 8 } }, tickfont: { size: 8 } },
      bargap: 0.3,
    };

    Plotly.newPlot(evoRef.current, traces, layout, { responsive: true, displayModeBar: false });
  }, [plotlyReady, data]);

  // ── Re-simulate ──

  const handleResimulate = useCallback(async () => {
    setSimulating(true);
    try {
      const res = await fetch(`${API_BASE}/api/hydrotwin/barbo/3d/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pump_ls: pumpLs, canal_factor: canalFactor, k_factor: kFactor }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: HydroSimData = await res.json();
      setData(d);
      setActiveMonth('Oct');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de simulación');
    } finally {
      setSimulating(false);
    }
  }, [pumpLs, canalFactor, kFactor]);

  // ── Resize observer ──

  useEffect(() => {
    if (!plotlyReady) return;
    const ro = new ResizeObserver(() => {
      if (plot3dRef.current) Plotly.Plots.resize(plot3dRef.current);
      if (crossRef.current) Plotly.Plots.resize(crossRef.current);
      if (evoRef.current) Plotly.Plots.resize(evoRef.current);
    });
    if (plot3dRef.current) ro.observe(plot3dRef.current);
    return () => ro.disconnect();
  }, [plotlyReady]);

  // ── KPI helper ──

  const kpis = data?.kpis;
  const displayKpis = {
    dd: kpis?.maxDrawdown ?? 0,
    pumpLs: kpis?.wellQ_ls ?? 0,
    pumpM3d: kpis?.wellQ_m3d ?? 0,
    infiltration: kpis?.infiltration ?? 0,
  };

  // ═══════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════

  return (
    <>
      <Head>
        <title>HydroTwin 3D · Acuífero Sierra Espuña</title>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>

      <Script
        src="https://cdn.plot.ly/plotly-2.35.2.min.js"
        strategy="afterInteractive"
        onLoad={() => setPlotlyReady(true)}
      />

      <div className="flex h-screen flex-col" style={{ background: '#08080f', color: '#e4e4e7', fontFamily: "'DM Sans', system-ui, sans-serif" }}>

        {/* ═══ HEADER ═══ */}
        <header className="flex items-center justify-between border-b px-5 py-2.5" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'linear-gradient(180deg, #0c0c18 0%, #08080f 100%)' }}>
          <div className="flex items-center gap-3">
            <Link href="/hydrotwin/barbo/dashboard" className="flex items-center gap-2 text-xs text-[#71717a] hover:text-[#06b6d4] transition-colors">
              <ArrowLeft size={14} />
              Dashboard
            </Link>
            <div className="h-5 w-px bg-white/10" />
            <div className="flex h-9 w-9 items-center justify-center rounded-lg font-mono text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #06b6d4, #0891b2)' }}>HT</div>
            <div>
              <div className="text-base font-semibold">HydroTwin 3D</div>
              <div className="text-[11px] text-[#71717a]">Gemelo Digital · Acuífero Sierra Espuña (070.040)</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-medium text-red-400">Masa en riesgo cuantitativo</span>
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-400">
              {simulating ? '◌ Simulando...' : '● Simulación activa'}
            </span>
            <span className="font-mono text-[11px] text-[#52525b]">NeoFarm · GeoTwin</span>
          </div>
        </header>

        {/* ═══ APP BODY ═══ */}
        <div className="flex flex-1 min-h-0">

          {/* ═══ SIDEBAR ═══ */}
          <aside className="flex w-[220px] shrink-0 flex-col gap-4 overflow-y-auto border-r p-4" style={{ borderColor: 'rgba(255,255,255,0.06)', background: '#0f0f1a' }}>

            {/* Parámetros de simulación */}
            <section>
              <h3 className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-[#52525b]">Parámetros de simulación</h3>

              <SliderControl label="Bombeo (l/s)" value={pumpLs} min={5} max={60} step={1} unit="" onChange={setPumpLs} />
              <SliderControl label="Caudal canal (×)" value={canalFactor} min={0} max={2} step={0.05} unit="" displayFn={v => v.toFixed(2)} onChange={setCanalFactor} />
              <SliderControl label="K factor (×)" value={kFactor} min={0.1} max={5} step={0.1} unit="" displayFn={v => v.toFixed(2)} onChange={setKFactor} />

              <button
                onClick={handleResimulate}
                disabled={simulating}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-[#06b6d4]/30 bg-[#06b6d4]/10 py-2 text-xs font-medium text-[#06b6d4] transition hover:bg-[#06b6d4]/20 disabled:opacity-50"
              >
                {simulating ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                Re-simular FD
              </button>
            </section>

            {/* KPIs */}
            <section>
              <h3 className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-[#52525b]">Indicadores clave</h3>
              <KpiMini label="Descenso máximo" value={`${displayKpis.dd.toFixed(1)} m`} sub="Cono de depresión" color="#ef4444" />
              <KpiMini label="Bombeo actual" value={`${displayKpis.pumpLs.toFixed(0)} l/s`} sub={`${displayKpis.pumpM3d.toFixed(0)} m³/día`} color="#06b6d4" />
              <KpiMini label="Infiltración canal" value={`${displayKpis.infiltration.toFixed(0)}`} sub="m³/día neto" color="#10b981" />
              <KpiMini label="Concesión anual" value="4.45M" sub="m³/año autorizado" color="#f59e0b" />
              <KpiMini label="Eficiencia 2025" value="95.8%" sub="distribuido / extraído" color="#8b5cf6" />
            </section>

            {/* Estratigrafía */}
            <section>
              <h3 className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-[#52525b]">Estratigrafía</h3>
              <div className="flex flex-col gap-1.5 text-[10px] leading-relaxed">
                <StratRow color="#fcffa4" label="0–40m Arenas/Gravas (K≈3)" />
                <StratRow color="#de4968" label="40–80m Transición (K≈0.3)" />
                <StratRow color="#3b0f70" label="80–120m Margas (K≈0.005)" />
                <StratRow color="#5c3d2e" label="Base carbonatada" />
              </div>
            </section>
          </aside>

          {/* ═══ MAIN CONTENT ═══ */}
          <div className="flex flex-1 flex-col min-w-0">
            <div className="grid flex-1 min-h-0" style={{ gridTemplateColumns: '1fr 280px' }}>

              {/* 3D Plot */}
              <div className="relative min-h-0">
                {(loading || !plotlyReady) ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="flex flex-col items-center gap-3 text-[#71717a]">
                      <Loader2 size={32} className="animate-spin text-[#06b6d4]" />
                      <span className="text-sm">{loading ? 'Ejecutando solver FD...' : 'Cargando Plotly.js...'}</span>
                    </div>
                  </div>
                ) : error ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="max-w-sm rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center">
                      <p className="text-sm text-red-400">Error: {error}</p>
                      <p className="mt-2 text-xs text-[#71717a]">Verifica que el engine esté activo</p>
                    </div>
                  </div>
                ) : (
                  <div ref={plot3dRef} className="h-full w-full" />
                )}
              </div>

              {/* Right panel: piezometers + evolution */}
              <div className="flex flex-col overflow-y-auto border-l" style={{ borderColor: 'rgba(255,255,255,0.06)', background: '#0f0f1a' }}>
                <div className="border-b p-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#52525b]">Piezómetros</span>
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-400">8 activos</span>
                  </div>
                  {data?.piezData.map(p => (
                    <div key={p.name} className="flex items-center justify-between border-b py-1 text-[11px]" style={{ borderColor: 'rgba(255,255,255,0.03)' }}>
                      <span className="max-w-[110px] truncate text-[#71717a]">{p.name}</span>
                      <span className="font-mono text-xs font-semibold" style={{ color: p.dd > 8 ? '#ef4444' : p.dd > 4 ? '#f59e0b' : '#10b981' }}>
                        {p.h} m <small className="text-[#52525b]">{'\u25BC'}{p.dd}</small>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex-1 p-3">
                  <span className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[#52525b]">Evolución campaña Oct–Sep</span>
                  <div ref={evoRef} className="h-40" />
                </div>
              </div>
            </div>

            {/* Cross-section */}
            <div className="border-t" style={{ height: 220, borderColor: 'rgba(255,255,255,0.06)', background: '#0f0f1a' }}>
              <div ref={crossRef} className="h-full w-full" />
            </div>
          </div>
        </div>

        {/* ═══ FOOTER ═══ */}
        <footer className="flex items-center justify-between border-t px-5 py-1.5 text-[9px] text-[#52525b]" style={{ borderColor: 'rgba(255,255,255,0.06)', background: '#0f0f1a' }}>
          <span>HydroTwin Barbo v2.0 · Solver FD (diferencias finitas) · Acoplamiento Darcy canal–acuífero</span>
          <span>
            Masa de agua: Sierra Espuña (070.040) · Concesión: Aguas del Barbo ·{' '}
            <a href="https://geotwin.es" target="_blank" rel="noopener noreferrer" className="text-[#06b6d4]">GeoTwin</a> /{' '}
            <a href="https://neofarm.io" target="_blank" rel="noopener noreferrer" className="text-[#06b6d4]">NeoFarm</a>
          </span>
        </footer>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

function SliderControl({
  label, value, min, max, step, onChange, displayFn,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  displayFn?: (v: number) => string;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-[11px] text-[#71717a]">
        <span>{label}</span>
        <span className="font-mono font-semibold text-[#06b6d4]">{displayFn ? displayFn(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="ht-range w-full"
      />
    </div>
  );
}

function KpiMini({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div
      className="mb-1.5 rounded-md border p-2"
      style={{ borderColor: 'rgba(255,255,255,0.06)', borderLeftWidth: 3, borderLeftColor: color, background: '#12121f' }}
    >
      <div className="text-[9px] uppercase tracking-wide text-[#52525b]">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-bold" style={{ color }}>{value}</div>
      <div className="text-[9px] text-[#71717a]">{sub}</div>
    </div>
  );
}

function StratRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      <span className="text-[#71717a]">{label}</span>
    </div>
  );
}
