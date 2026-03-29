import Head from 'next/head';
import Link from 'next/link';
import { Droplets, BarChart3, Shield, Brain, ArrowRight, MapPin, Activity, TrendingUp, Gauge } from 'lucide-react';
import { BARBO } from '@/lib/hydrotwin/barbo-constants';

const KPIS_HERO = [
  { label: 'Volumen autorizado', value: '4.4M', unit: 'm³/año', icon: Droplets },
  { label: 'Eficiencia actual', value: '95.8', unit: '%', icon: TrendingUp },
  { label: 'Histórico disponible', value: '10+', unit: 'años', icon: Activity },
  { label: 'Ahorro potencial', value: '~51k', unit: '€/año', icon: Gauge },
] as const;

const TECH_COLUMNS = [
  {
    icon: Gauge,
    title: 'Medición',
    items: ['Caudalímetros ultrasónicos', 'Radares de nivel', 'Analizadores de energía', 'Sondas piezométricas'],
  },
  {
    icon: BarChart3,
    title: 'Gemelo digital',
    items: ['GeoTwin + HydroTwin', 'Histórico 10+ años', 'Alertas en tiempo real', 'Dashboard operativo'],
  },
  {
    icon: Brain,
    title: 'IA operativa',
    items: ['Detección de anomalías', 'Predicción de demanda', 'Optimización energética', 'Recomendaciones automáticas'],
  },
] as const;

export default function HydroTwinBarboLanding() {
  return (
    <>
      <Head>
        <title>HydroTwin Barbo — Gemelo digital hídrico</title>
        <meta name="description" content="Gemelo digital hídrico de la concesión Aguas del Barbo, Sierra Espuña. Mide, controla y optimiza con datos reales de 10+ años." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div className="min-h-screen bg-[#0a0a0f] text-slate-100" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        {/* ── Navbar ─────────────────────────────────────── */}
        <nav className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-white/[0.06] bg-[#0a0a0f]/80 px-6 backdrop-blur-md">
          <div className="flex items-center gap-2 text-cyan-400">
            <Droplets className="h-5 w-5" />
            <span className="font-semibold text-sm tracking-tight">HydroTwin</span>
            <span className="text-slate-500 text-sm">·</span>
            <span className="text-slate-400 text-sm">Barbo</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/hydrotwin/barbo/3d"
              className="rounded-md bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-400 hover:bg-purple-500/20 transition-colors"
            >
              Modelo 3D
            </Link>
            <Link
              href="/hydrotwin/barbo/dashboard"
              className="rounded-md bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-400 hover:bg-cyan-500/20 transition-colors"
            >
              Ver dashboard demo
            </Link>
            <a
              href="mailto:info@neofarm.es?subject=HydroTwin%20Barbo%20-%20Solicitar%20acceso"
              className="rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-cyan-400 transition-colors"
            >
              Solicitar acceso
            </a>
          </div>
        </nav>

        {/* ── Hero ───────────────────────────────────────── */}
        <section className="relative overflow-hidden px-6 pt-20 pb-16">
          {/* Gradient background */}
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-cyan-500/[0.03] blur-3xl pointer-events-none" />

          <div className="relative mx-auto max-w-3xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/5 px-3 py-1 text-xs text-cyan-400">
              <Shield className="h-3 w-3" />
              Primer gemelo digital hídrico sobre GeoTwin
            </div>

            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              <span className="text-cyan-400">HydroTwin</span>{' '}
              <span className="text-slate-200">Barbo</span>
            </h1>

            <p className="mt-2 text-lg text-slate-400 sm:text-xl">
              Gemelo digital hídrico · Sierra Espuña
            </p>

            <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-slate-400">
              El sistema mide, controla y optimiza la concesión de aguas subterráneas
              de Barbo con datos reales de más de 10 años. Balance hídrico, reparto,
              eficiencia energética y estado del acuífero — todo en un solo panel.
            </p>

            <div className="mt-8 flex items-center justify-center gap-3">
              <a
                href="mailto:info@neofarm.es?subject=HydroTwin%20Barbo%20-%20Solicitar%20acceso"
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-cyan-400 transition-colors"
              >
                Solicitar acceso
                <ArrowRight className="h-4 w-4" />
              </a>
              <Link
                href="/hydrotwin/barbo/dashboard"
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/10 transition-colors"
              >
                Ver demo del dashboard
              </Link>
              <Link
                href="/hydrotwin/barbo/3d"
                className="inline-flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-5 py-2.5 text-sm font-medium text-purple-300 hover:bg-purple-500/20 transition-colors"
              >
                Modelo 3D del acuífero
              </Link>
            </div>
          </div>
        </section>

        {/* ── KPI Strip ──────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 pb-16">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {KPIS_HERO.map(kpi => {
              const Icon = kpi.icon;
              return (
                <div
                  key={kpi.label}
                  className="rounded-xl border border-white/[0.06] bg-[#111118] p-4"
                >
                  <div className="flex items-center gap-2 text-slate-500">
                    <Icon className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium uppercase tracking-wider">{kpi.label}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-slate-100" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      {kpi.value}
                    </span>
                    <span className="text-xs text-slate-500">{kpi.unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Qué ve el operador ─────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 pb-20">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-slate-200">Qué ve el operador</h2>
            <p className="mt-2 text-sm text-slate-500">
              Las cuatro preguntas que Felipe contesta cada día
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {[
              { q: '¿Cuánta agua sale?', desc: 'KPI de m³ bombeados y gráfico de balance hídrico mensual con tendencias estacionales.', color: 'border-cyan-500/30' },
              { q: '¿Cuánta llega?', desc: 'Eficiencia del sistema, pérdidas por tramo y estado visual del canal completo.', color: 'border-emerald-500/30' },
              { q: '¿Dónde se pierde?', desc: 'Mapa de pérdidas por tramo del canal, alertas geolocalizadas y diagnóstico automático.', color: 'border-amber-500/30' },
              { q: '¿Qué inversión devuelve antes?', desc: 'Comparador campaña vs campaña, análisis energético y ROI de mejoras propuestas.', color: 'border-red-500/30' },
            ].map(item => (
              <div
                key={item.q}
                className={`rounded-xl border ${item.color} bg-[#111118] p-5`}
              >
                <p className="text-sm font-semibold text-slate-200">{item.q}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Sistema físico ─────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 pb-20">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-slate-200">Sistema físico</h2>
            <p className="mt-2 text-sm text-slate-500">
              {BARBO.infraestructura.longitudCanalKm} km de canal · {BARBO.infraestructura.tramosCanal} tramos · {BARBO.infraestructura.partidores} partidores
            </p>
          </div>

          <div className="mt-10 rounded-xl border border-white/[0.06] bg-[#111118] p-6">
            {/* Simplified canal diagram */}
            <div className="flex items-center justify-between gap-2 overflow-x-auto py-4">
              {[
                { name: 'Pozo', icon: '💧', sub: 'Cabecera' },
                { name: 'Tramo 1', icon: '═', sub: 'Entubado · 1.8 km' },
                { name: 'Tramo 2', icon: '═', sub: 'Entubado · 2.5 km' },
                { name: 'Tramo 3', icon: '〰', sub: 'Cielo abierto · 3.8 km' },
                { name: 'Bifurcación', icon: '⑂', sub: 'Reparto' },
              ].map((node, i, arr) => (
                <div key={node.name} className="flex items-center gap-2">
                  <div className="flex flex-col items-center gap-1 min-w-[80px]">
                    <span className="text-xl">{node.icon}</span>
                    <span className="text-[11px] font-medium text-slate-300">{node.name}</span>
                    <span className="text-[9px] text-slate-600">{node.sub}</span>
                  </div>
                  {i < arr.length - 1 && (
                    <div className="h-px w-8 bg-gradient-to-r from-cyan-500/40 to-cyan-500/10 sm:w-12" />
                  )}
                </div>
              ))}
              <div className="flex flex-col gap-2 ml-2">
                <div className="flex items-center gap-2">
                  <div className="h-px w-6 bg-cyan-500/30" />
                  <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-400">Pliego</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-px w-6 bg-blue-800/50" />
                  <span className="rounded bg-blue-900/30 px-2 py-0.5 text-[10px] text-blue-300">Librilla</span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-600">
              <MapPin className="h-3 w-3" />
              <span>Sierra Espuña (070.040) · Masa de agua subterránea en riesgo cuantitativo</span>
            </div>
          </div>
        </section>

        {/* ── Tecnología ─────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 pb-20">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-slate-200">Tecnología</h2>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {TECH_COLUMNS.map(col => {
              const Icon = col.icon;
              return (
                <div key={col.title} className="rounded-xl border border-white/[0.06] bg-[#111118] p-5">
                  <div className="flex items-center gap-2 text-cyan-400">
                    <Icon className="h-4 w-4" />
                    <span className="text-sm font-semibold">{col.title}</span>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {col.items.map(item => (
                      <li key={item} className="flex items-start gap-2 text-xs text-slate-400">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-cyan-500/50" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Footer ─────────────────────────────────────── */}
        <footer className="border-t border-white/[0.06] px-6 py-8">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
            <div className="flex items-center gap-2 text-slate-600">
              <Droplets className="h-4 w-4" />
              <span className="text-xs">NeoFarm · HydroTwin</span>
            </div>
            <div className="flex gap-4 text-xs text-slate-600">
              <Link href="https://geotwin.es" className="hover:text-slate-400 transition-colors" target="_blank" rel="noopener noreferrer">
                GeoTwin
              </Link>
              <a href="mailto:info@neofarm.es" className="hover:text-slate-400 transition-colors">
                Contacto
              </a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
