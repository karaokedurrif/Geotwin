import type {
  LecturaMensual,
  AlertaOperativa,
  TramoCanal,
  EstadoAcuifero,
  KpiCard,
  ResumenCampania,
  ComparacionCampanias,
  PeriodoComparacion,
} from './barbo-types';
import { BARBO, HT_THRESHOLDS } from './barbo-constants';

// ---------------------------------------------------------------------------
// Mulberry32 — PRNG determinístico con seed fijo
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(424242);

// Helper: random in range using the seeded PRNG
function rand(min: number, max: number): number {
  return min + rng() * (max - min);
}

// ---------------------------------------------------------------------------
// Generate 144 monthly readings: Oct 2014 – Mar 2026
// ---------------------------------------------------------------------------
function generateLecturas(): LecturaMensual[] {
  const lecturas: LecturaMensual[] = [];
  let year = 2014;
  let month = 10;

  for (let i = 0; i < 144; i++) {
    const fecha = `${year}-${String(month).padStart(2, '0')}`;

    // Seasonal sinusoid: peak in July (month 7), valley in Feb (month 2)
    const seasonFactor = Math.sin(((month - 2) * Math.PI) / 5);
    const volumenBase = 320_000;
    const amplitud = 120_000;
    const volumenExtraido = Math.round(
      volumenBase + amplitud * seasonFactor + rand(-15_000, 15_000)
    );

    // Efficiency improves gradually from ~92% (2014) to ~96% (2025)
    const yearsElapsed = year - 2014 + (month - 1) / 12;
    const eficienciaBase = 0.92 + (yearsElapsed / 12) * 0.04;
    const eficiencia = Math.min(0.98, Math.max(0.88, eficienciaBase + rand(-0.015, 0.015)));

    const volumenDistribuido = Math.round(volumenExtraido * eficiencia);
    const perdidas = volumenExtraido - volumenDistribuido;

    // kWh/m³: inversely correlated with volume (pumping more = better ratio)
    const kwhPorM3 = Math.max(0.35, Math.min(0.80,
      0.60 - (volumenExtraido - 300_000) / 2_000_000 + rand(-0.05, 0.05)
    ));
    const kwhTotal = Math.round(volumenExtraido * kwhPorM3);
    const horasBombeo = Math.round(kwhTotal / rand(18, 25)); // ~20 kW pump

    // Reparto: normally ~60/40 Pliego/Librilla
    // Anomaly 2022: Librilla surges to ~55% for 6 months (Jan–Jun 2022)
    const isAnomalia2022 = year === 2022 && month >= 1 && month <= 6;
    const pctPliego = isAnomalia2022
      ? rand(0.42, 0.48)
      : rand(0.57, 0.63);
    const repartoPliego = Math.round(volumenDistribuido * pctPliego);
    const repartoLibrilla = volumenDistribuido - repartoPliego;

    lecturas.push({
      fecha,
      volumenExtraido,
      volumenDistribuido,
      perdidas,
      eficiencia: Math.round(eficiencia * 10000) / 10000,
      kwhTotal,
      kwhPorM3: Math.round(kwhPorM3 * 1000) / 1000,
      horasBombeo,
      repartoPliego,
      repartoLibrilla,
    });

    // Advance month
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return lecturas;
}

// ---------------------------------------------------------------------------
// Alertas demo — 15 alerts distributed over last 30 days
// ---------------------------------------------------------------------------
function generateAlertas(): AlertaOperativa[] {
  const now = new Date('2026-03-29T10:00:00Z');
  const alertas: AlertaOperativa[] = [
    {
      id: 'alt-001', tipo: 'perdida', severidad: 'alarma',
      mensaje: 'Pérdida >8% detectada en Tramo 3 (cielo abierto, km 5.2–8.0)',
      timestamp: new Date(now.getTime() - 2 * 3600_000).toISOString(),
      nodoOrigen: 'tramo-3', resuelta: false,
    },
    {
      id: 'alt-002', tipo: 'energia', severidad: 'aviso',
      mensaje: 'kWh/m³ por encima del umbral (0.68) durante las últimas 48h',
      timestamp: new Date(now.getTime() - 18 * 3600_000).toISOString(),
      nodoOrigen: 'pozo', resuelta: false,
    },
    {
      id: 'alt-003', tipo: 'acuifero', severidad: 'critica',
      mensaje: 'Nivel piezométrico 2.3m por debajo de la media estacional',
      timestamp: new Date(now.getTime() - 24 * 3600_000).toISOString(),
      nodoOrigen: 'acuifero', resuelta: false,
    },
    {
      id: 'alt-004', tipo: 'reparto', severidad: 'info',
      mensaje: 'Reparto Pliego/Librilla dentro de márgenes normales esta semana',
      timestamp: new Date(now.getTime() - 2 * 86400_000).toISOString(),
      resuelta: true,
    },
    {
      id: 'alt-005', tipo: 'mantenimiento', severidad: 'aviso',
      mensaje: 'Revisión programada del partidor P2 — pendiente desde hace 15 días',
      timestamp: new Date(now.getTime() - 3 * 86400_000).toISOString(),
      nodoOrigen: 'partidor-2', resuelta: false,
    },
    {
      id: 'alt-006', tipo: 'perdida', severidad: 'aviso',
      mensaje: 'Pérdidas acumuladas del trimestre superan estimación (+12%)',
      timestamp: new Date(now.getTime() - 4 * 86400_000).toISOString(),
      resuelta: false,
    },
    {
      id: 'alt-007', tipo: 'energia', severidad: 'info',
      mensaje: 'Consumo energético mensual un 3% inferior al mes anterior',
      timestamp: new Date(now.getTime() - 5 * 86400_000).toISOString(),
      resuelta: true,
    },
    {
      id: 'alt-008', tipo: 'intrusion', severidad: 'alarma',
      mensaje: 'Conductividad elevada en muestra de pozo — posible intrusión salina',
      timestamp: new Date(now.getTime() - 6 * 86400_000).toISOString(),
      nodoOrigen: 'pozo', resuelta: false,
    },
    {
      id: 'alt-009', tipo: 'perdida', severidad: 'info',
      mensaje: 'Tramo 1 (entubado) sin variaciones anómalas en las últimas 2 semanas',
      timestamp: new Date(now.getTime() - 8 * 86400_000).toISOString(),
      nodoOrigen: 'tramo-1', resuelta: true,
    },
    {
      id: 'alt-010', tipo: 'mantenimiento', severidad: 'aviso',
      mensaje: 'Caudalímetro C3 requiere calibración (desviación >2%)',
      timestamp: new Date(now.getTime() - 10 * 86400_000).toISOString(),
      nodoOrigen: 'tramo-3', resuelta: false,
    },
    {
      id: 'alt-011', tipo: 'acuifero', severidad: 'aviso',
      mensaje: 'Precipitación acumulada 12 meses un 18% inferior a la media',
      timestamp: new Date(now.getTime() - 12 * 86400_000).toISOString(),
      resuelta: false,
    },
    {
      id: 'alt-012', tipo: 'reparto', severidad: 'aviso',
      mensaje: 'Librilla recibió un 5% más de lo habitual la semana pasada',
      timestamp: new Date(now.getTime() - 15 * 86400_000).toISOString(),
      resuelta: true,
    },
    {
      id: 'alt-013', tipo: 'energia', severidad: 'alarma',
      mensaje: 'Pico de consumo eléctrico detectado — posible fallo en variador',
      timestamp: new Date(now.getTime() - 18 * 86400_000).toISOString(),
      nodoOrigen: 'pozo', resuelta: true,
    },
    {
      id: 'alt-014', tipo: 'perdida', severidad: 'critica',
      mensaje: 'Rotura parcial detectada en Tramo 4 (cielo abierto) — intervención urgente',
      timestamp: new Date(now.getTime() - 22 * 86400_000).toISOString(),
      nodoOrigen: 'tramo-4', resuelta: true,
    },
    {
      id: 'alt-015', tipo: 'mantenimiento', severidad: 'info',
      mensaje: 'Limpieza de canal completada en Tramo 2',
      timestamp: new Date(now.getTime() - 28 * 86400_000).toISOString(),
      nodoOrigen: 'tramo-2', resuelta: true,
    },
  ];
  return alertas;
}

// ---------------------------------------------------------------------------
// Tramos del canal
// ---------------------------------------------------------------------------
function generateTramos(): TramoCanal[] {
  return [
    {
      id: 'tramo-1', nombre: 'Pozo → Nodo A', longitudKm: 1.8,
      tipo: 'entubado', estado: 'ok', perdidasEstimadas: 1.2,
      ultimaLectura: '2026-03-29T08:00:00Z',
    },
    {
      id: 'tramo-2', nombre: 'Nodo A → Nodo B', longitudKm: 2.5,
      tipo: 'entubado', estado: 'ok', perdidasEstimadas: 1.5,
      ultimaLectura: '2026-03-29T08:00:00Z',
    },
    {
      id: 'tramo-3', nombre: 'Nodo B → Bifurcación', longitudKm: 3.8,
      tipo: 'cielo_abierto', estado: 'alarma', perdidasEstimadas: 8.2,
      ultimaLectura: '2026-03-29T07:30:00Z',
    },
    {
      id: 'tramo-4', nombre: 'Bifurcación → Pliego', longitudKm: 2.6,
      tipo: 'cielo_abierto', estado: 'aviso', perdidasEstimadas: 4.1,
      ultimaLectura: '2026-03-29T07:45:00Z',
    },
    {
      id: 'tramo-5', nombre: 'Bifurcación → Librilla', longitudKm: 1.8,
      tipo: 'entubado', estado: 'ok', perdidasEstimadas: 1.0,
      ultimaLectura: '2026-03-29T08:00:00Z',
    },
  ];
}

// ---------------------------------------------------------------------------
// Estado del acuífero
// ---------------------------------------------------------------------------
function generateAcuifero(): EstadoAcuifero {
  return {
    nivelPiezometrico: 412.3,
    tendencia: 'bajando',
    estadoRegulatorio: 'riesgo',
    precipitacionAcumulada: 285,
  };
}

// ---------------------------------------------------------------------------
// KPIs — computed from lecturas
// ---------------------------------------------------------------------------
function getColorEstado(value: number, thresholds: { ok: number; aviso: number }, higher_is_better: boolean): 'ok' | 'aviso' | 'alarma' {
  if (higher_is_better) {
    if (value >= thresholds.ok) return 'ok';
    if (value >= thresholds.aviso) return 'aviso';
    return 'alarma';
  }
  if (value <= thresholds.ok) return 'ok';
  if (value <= thresholds.aviso) return 'aviso';
  return 'alarma';
}

export function computeKpis(lecturas: LecturaMensual[]): KpiCard[] {
  const latest = lecturas[lecturas.length - 1];
  const prev = lecturas[lecturas.length - 2];
  const last12 = lecturas.slice(-12);

  // Acumulado año hidrológico actual (Oct 2025 – Mar 2026)
  const currentHydroYear = lecturas.filter(l => {
    const [y, m] = l.fecha.split('-').map(Number);
    return (y === 2025 && m >= 10) || (y === 2026 && m <= 9);
  });
  const acumuladoAnual = currentHydroYear.reduce((s, l) => s + l.volumenExtraido, 0);
  const cupoPct = acumuladoAnual / BARBO.concesion.volumenAnualAutorizado;

  const tendencia = (current: number, previous: number) =>
    previous === 0 ? 0 : Math.round(((current - previous) / previous) * 1000) / 10;

  return [
    {
      id: 'bombeados',
      label: 'm³ bombeados',
      valor: latest.volumenExtraido,
      unidad: 'm³',
      tendencia: tendencia(latest.volumenExtraido, prev.volumenExtraido),
      colorEstado: 'ok',
      sparkline: last12.map(l => l.volumenExtraido),
    },
    {
      id: 'eficiencia',
      label: 'Eficiencia',
      valor: Math.round(latest.eficiencia * 1000) / 10,
      unidad: '%',
      tendencia: tendencia(latest.eficiencia, prev.eficiencia),
      colorEstado: getColorEstado(latest.eficiencia, HT_THRESHOLDS.eficiencia, true),
      sparkline: last12.map(l => l.eficiencia * 100),
    },
    {
      id: 'kwhm3',
      label: 'kWh/m³',
      valor: latest.kwhPorM3,
      unidad: 'kWh/m³',
      tendencia: tendencia(latest.kwhPorM3, prev.kwhPorM3),
      colorEstado: getColorEstado(latest.kwhPorM3, HT_THRESHOLDS.kwhPorM3, false),
      sparkline: last12.map(l => l.kwhPorM3),
    },
    {
      id: 'perdidas',
      label: 'Pérdidas estimadas',
      valor: latest.perdidas,
      unidad: 'm³',
      tendencia: tendencia(latest.perdidas, prev.perdidas),
      colorEstado: getColorEstado(1 - latest.eficiencia, HT_THRESHOLDS.perdidasPct, false),
      sparkline: last12.map(l => l.perdidas),
    },
    {
      id: 'reparto-pliego',
      label: 'Reparto Pliego',
      valor: Math.round((latest.repartoPliego / latest.volumenDistribuido) * 1000) / 10,
      unidad: '%',
      tendencia: tendencia(
        latest.repartoPliego / latest.volumenDistribuido,
        prev.repartoPliego / prev.volumenDistribuido
      ),
      colorEstado: 'ok',
      sparkline: last12.map(l => (l.repartoPliego / l.volumenDistribuido) * 100),
    },
    {
      id: 'cupo',
      label: 'Cupo consumido',
      valor: Math.round(cupoPct * 1000) / 10,
      unidad: '%',
      tendencia: 0,
      colorEstado: cupoPct >= HT_THRESHOLDS.cupoAnual.alarma ? 'alarma'
        : cupoPct >= HT_THRESHOLDS.cupoAnual.aviso ? 'aviso' : 'ok',
      sparkline: currentHydroYear.map((_, idx) =>
        currentHydroYear.slice(0, idx + 1).reduce((s, l) => s + l.volumenExtraido, 0) / BARBO.concesion.volumenAnualAutorizado * 100
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Comparador de campañas
// ---------------------------------------------------------------------------
function summarizeCampania(lecturas: LecturaMensual[], periodo: PeriodoComparacion): ResumenCampania {
  const filtered = lecturas.filter(l => l.fecha >= periodo.desde && l.fecha <= periodo.hasta);
  const volumenTotal = filtered.reduce((s, l) => s + l.volumenExtraido, 0);
  const eficienciaMedia = filtered.reduce((s, l) => s + l.eficiencia, 0) / filtered.length;
  const kwhPorM3Medio = filtered.reduce((s, l) => s + l.kwhPorM3, 0) / filtered.length;
  const perdidasTotales = filtered.reduce((s, l) => s + l.perdidas, 0);
  const totalDistribuido = filtered.reduce((s, l) => s + l.volumenDistribuido, 0);
  const totalPliego = filtered.reduce((s, l) => s + l.repartoPliego, 0);
  const peak = filtered.reduce((best, l) =>
    l.volumenExtraido > best.volumenExtraido ? l : best, filtered[0]);

  return {
    periodo,
    volumenTotal,
    eficienciaMedia: Math.round(eficienciaMedia * 10000) / 10000,
    kwhPorM3Medio: Math.round(kwhPorM3Medio * 1000) / 1000,
    perdidasTotales,
    perdidasEuros: Math.round(perdidasTotales * 0.42),
    repartoPliegoPct: Math.round((totalPliego / totalDistribuido) * 1000) / 10,
    repartoLibrillaPct: Math.round(((totalDistribuido - totalPliego) / totalDistribuido) * 1000) / 10,
    picoMensual: { fecha: peak.fecha, volumen: peak.volumenExtraido },
  };
}

export function compararCampanias(
  lecturas: LecturaMensual[],
  periodoA: PeriodoComparacion,
  periodoB: PeriodoComparacion,
): ComparacionCampanias {
  const a = summarizeCampania(lecturas, periodoA);
  const b = summarizeCampania(lecturas, periodoB);
  return {
    campaniaA: a,
    campaniaB: b,
    deltas: {
      volumenTotal: b.volumenTotal - a.volumenTotal,
      eficienciaMedia: Math.round((b.eficienciaMedia - a.eficienciaMedia) * 10000) / 10000,
      kwhPorM3Medio: Math.round((b.kwhPorM3Medio - a.kwhPorM3Medio) * 1000) / 1000,
      perdidasTotales: b.perdidasTotales - a.perdidasTotales,
      perdidasEuros: b.perdidasEuros - a.perdidasEuros,
      repartoPliegoPct: Math.round((b.repartoPliegoPct - a.repartoPliegoPct) * 10) / 10,
    },
  };
}

// ---------------------------------------------------------------------------
// Cached singleton — datos siempre iguales gracias al seed fijo
// ---------------------------------------------------------------------------
let _lecturas: LecturaMensual[] | null = null;
let _alertas: AlertaOperativa[] | null = null;
let _tramos: TramoCanal[] | null = null;
let _acuifero: EstadoAcuifero | null = null;

export function getDemoLecturas(): LecturaMensual[] {
  if (!_lecturas) _lecturas = generateLecturas();
  return _lecturas;
}

export function getDemoAlertas(): AlertaOperativa[] {
  if (!_alertas) _alertas = generateAlertas();
  return _alertas;
}

export function getDemoTramos(): TramoCanal[] {
  if (!_tramos) _tramos = generateTramos();
  return _tramos;
}

export function getDemoAcuifero(): EstadoAcuifero {
  if (!_acuifero) _acuifero = generateAcuifero();
  return _acuifero;
}
