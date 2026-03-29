import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mulberry32 PRNG — same seed as the frontend for identical data
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
function rand(min: number, max: number): number {
  return min + rng() * (max - min);
}

// ---------------------------------------------------------------------------
// Types (mirrored from frontend barbo-types)
// ---------------------------------------------------------------------------
interface LecturaMensual {
  fecha: string;
  volumenExtraido: number;
  volumenDistribuido: number;
  perdidas: number;
  eficiencia: number;
  kwhTotal: number;
  kwhPorM3: number;
  horasBombeo: number;
  repartoPliego: number;
  repartoLibrilla: number;
}

interface AlertaOperativa {
  id: string;
  tipo: string;
  severidad: string;
  mensaje: string;
  timestamp: string;
  nodoOrigen?: string;
  resuelta: boolean;
}

interface TramoCanal {
  id: string;
  nombre: string;
  longitudKm: number;
  tipo: string;
  estado: string;
  perdidasEstimadas: number;
  ultimaLectura?: string;
}

interface EstadoAcuifero {
  nivelPiezometrico: number;
  tendencia: string;
  estadoRegulatorio: string;
  precipitacionAcumulada: number;
}

// ---------------------------------------------------------------------------
// Generate data (same logic as frontend barbo-demo-data)
// ---------------------------------------------------------------------------
function generateLecturas(): LecturaMensual[] {
  const lecturas: LecturaMensual[] = [];
  let year = 2014;
  let month = 10;

  for (let i = 0; i < 144; i++) {
    const fecha = `${year}-${String(month).padStart(2, '0')}`;
    const seasonFactor = Math.sin(((month - 2) * Math.PI) / 5);
    const volumenExtraido = Math.round(320_000 + 120_000 * seasonFactor + rand(-15_000, 15_000));
    const yearsElapsed = year - 2014 + (month - 1) / 12;
    const eficienciaBase = 0.92 + (yearsElapsed / 12) * 0.04;
    const eficiencia = Math.min(0.98, Math.max(0.88, eficienciaBase + rand(-0.015, 0.015)));
    const volumenDistribuido = Math.round(volumenExtraido * eficiencia);
    const perdidas = volumenExtraido - volumenDistribuido;
    const kwhPorM3 = Math.max(0.35, Math.min(0.80, 0.60 - (volumenExtraido - 300_000) / 2_000_000 + rand(-0.05, 0.05)));
    const kwhTotal = Math.round(volumenExtraido * kwhPorM3);
    const horasBombeo = Math.round(kwhTotal / rand(18, 25));
    const isAnomalia = year === 2022 && month >= 1 && month <= 6;
    const pctPliego = isAnomalia ? rand(0.42, 0.48) : rand(0.57, 0.63);
    const repartoPliego = Math.round(volumenDistribuido * pctPliego);
    const repartoLibrilla = volumenDistribuido - repartoPliego;

    lecturas.push({
      fecha, volumenExtraido, volumenDistribuido, perdidas,
      eficiencia: Math.round(eficiencia * 10000) / 10000,
      kwhTotal, kwhPorM3: Math.round(kwhPorM3 * 1000) / 1000,
      horasBombeo, repartoPliego, repartoLibrilla,
    });

    month++;
    if (month > 12) { month = 1; year++; }
  }
  return lecturas;
}

const DEMO_LECTURAS = generateLecturas();

const DEMO_ALERTAS: AlertaOperativa[] = [
  { id: 'alt-001', tipo: 'perdida', severidad: 'alarma', mensaje: 'Pérdida >8% detectada en Tramo 3 (cielo abierto, km 5.2–8.0)', timestamp: '2026-03-29T08:00:00Z', nodoOrigen: 'tramo-3', resuelta: false },
  { id: 'alt-002', tipo: 'energia', severidad: 'aviso', mensaje: 'kWh/m³ por encima del umbral (0.68) durante las últimas 48h', timestamp: '2026-03-28T16:00:00Z', nodoOrigen: 'pozo', resuelta: false },
  { id: 'alt-003', tipo: 'acuifero', severidad: 'critica', mensaje: 'Nivel piezométrico 2.3m por debajo de la media estacional', timestamp: '2026-03-28T10:00:00Z', nodoOrigen: 'acuifero', resuelta: false },
  { id: 'alt-004', tipo: 'reparto', severidad: 'info', mensaje: 'Reparto Pliego/Librilla dentro de márgenes normales esta semana', timestamp: '2026-03-27T10:00:00Z', resuelta: true },
  { id: 'alt-005', tipo: 'mantenimiento', severidad: 'aviso', mensaje: 'Revisión programada del partidor P2', timestamp: '2026-03-26T10:00:00Z', nodoOrigen: 'partidor-2', resuelta: false },
  { id: 'alt-006', tipo: 'perdida', severidad: 'aviso', mensaje: 'Pérdidas acumuladas del trimestre superan estimación (+12%)', timestamp: '2026-03-25T10:00:00Z', resuelta: false },
  { id: 'alt-007', tipo: 'energia', severidad: 'info', mensaje: 'Consumo energético mensual un 3% inferior al mes anterior', timestamp: '2026-03-24T10:00:00Z', resuelta: true },
  { id: 'alt-008', tipo: 'intrusion', severidad: 'alarma', mensaje: 'Conductividad elevada en muestra de pozo — posible intrusión salina', timestamp: '2026-03-23T10:00:00Z', nodoOrigen: 'pozo', resuelta: false },
];

const DEMO_TRAMOS: TramoCanal[] = [
  { id: 'tramo-1', nombre: 'Pozo → Nodo A', longitudKm: 1.8, tipo: 'entubado', estado: 'ok', perdidasEstimadas: 1.2, ultimaLectura: '2026-03-29T08:00:00Z' },
  { id: 'tramo-2', nombre: 'Nodo A → Nodo B', longitudKm: 2.5, tipo: 'entubado', estado: 'ok', perdidasEstimadas: 1.5, ultimaLectura: '2026-03-29T08:00:00Z' },
  { id: 'tramo-3', nombre: 'Nodo B → Bifurcación', longitudKm: 3.8, tipo: 'cielo_abierto', estado: 'alarma', perdidasEstimadas: 8.2, ultimaLectura: '2026-03-29T07:30:00Z' },
  { id: 'tramo-4', nombre: 'Bifurcación → Pliego', longitudKm: 2.6, tipo: 'cielo_abierto', estado: 'aviso', perdidasEstimadas: 4.1, ultimaLectura: '2026-03-29T07:45:00Z' },
  { id: 'tramo-5', nombre: 'Bifurcación → Librilla', longitudKm: 1.8, tipo: 'entubado', estado: 'ok', perdidasEstimadas: 1.0, ultimaLectura: '2026-03-29T08:00:00Z' },
];

const DEMO_ACUIFERO: EstadoAcuifero = {
  nivelPiezometrico: 412.3,
  tendencia: 'bajando',
  estadoRegulatorio: 'riesgo',
  precipitacionAcumulada: 285,
};

// ---------------------------------------------------------------------------
// Query string validation helpers
// ---------------------------------------------------------------------------
function parseFecha(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return null;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------
export async function hydrotwinBarboRouter(fastify: FastifyInstance) {

  // GET /api/hydrotwin/barbo/lecturas?desde=2014-10&hasta=2026-03
  fastify.get<{ Querystring: { desde?: string; hasta?: string } }>(
    '/hydrotwin/barbo/lecturas',
    async (request) => {
      const desde = parseFecha(request.query.desde) ?? '2014-10';
      const hasta = parseFecha(request.query.hasta) ?? '2026-03';
      const filtered = DEMO_LECTURAS.filter(l => l.fecha >= desde && l.fecha <= hasta);
      return filtered;
    }
  );

  // GET /api/hydrotwin/barbo/kpis?periodo=2025-01:2025-03
  fastify.get<{ Querystring: { periodo?: string } }>(
    '/hydrotwin/barbo/kpis',
    async (request) => {
      const last = DEMO_LECTURAS[DEMO_LECTURAS.length - 1];
      const prev = DEMO_LECTURAS[DEMO_LECTURAS.length - 2];
      const last12 = DEMO_LECTURAS.slice(-12);

      const currentHydroYear = DEMO_LECTURAS.filter(l => {
        const [y, m] = l.fecha.split('-').map(Number);
        return (y === 2025 && m >= 10) || (y === 2026 && m <= 9);
      });
      const acumulado = currentHydroYear.reduce((s, l) => s + l.volumenExtraido, 0);
      const cupoPct = acumulado / 4_447_872;

      const tend = (a: number, b: number) => b === 0 ? 0 : Math.round(((a - b) / b) * 1000) / 10;

      return {
        kpis: [
          { id: 'bombeados', label: 'm³ bombeados', valor: last.volumenExtraido, unidad: 'm³', tendencia: tend(last.volumenExtraido, prev.volumenExtraido), colorEstado: 'ok', sparkline: last12.map(l => l.volumenExtraido) },
          { id: 'eficiencia', label: 'Eficiencia', valor: Math.round(last.eficiencia * 1000) / 10, unidad: '%', tendencia: tend(last.eficiencia, prev.eficiencia), colorEstado: last.eficiencia >= 0.95 ? 'ok' : last.eficiencia >= 0.90 ? 'aviso' : 'alarma', sparkline: last12.map(l => l.eficiencia * 100) },
          { id: 'kwhm3', label: 'kWh/m³', valor: last.kwhPorM3, unidad: 'kWh/m³', tendencia: tend(last.kwhPorM3, prev.kwhPorM3), colorEstado: last.kwhPorM3 <= 0.55 ? 'ok' : last.kwhPorM3 <= 0.65 ? 'aviso' : 'alarma', sparkline: last12.map(l => l.kwhPorM3) },
          { id: 'perdidas', label: 'Pérdidas', valor: last.perdidas, unidad: 'm³', tendencia: tend(last.perdidas, prev.perdidas), colorEstado: (1 - last.eficiencia) <= 0.03 ? 'ok' : (1 - last.eficiencia) <= 0.05 ? 'aviso' : 'alarma', sparkline: last12.map(l => l.perdidas) },
          { id: 'reparto-pliego', label: 'Reparto Pliego', valor: Math.round((last.repartoPliego / last.volumenDistribuido) * 1000) / 10, unidad: '%', tendencia: 0, colorEstado: 'ok', sparkline: last12.map(l => (l.repartoPliego / l.volumenDistribuido) * 100) },
          { id: 'cupo', label: 'Cupo consumido', valor: Math.round(cupoPct * 1000) / 10, unidad: '%', tendencia: 0, colorEstado: cupoPct >= 0.95 ? 'alarma' : cupoPct >= 0.85 ? 'aviso' : 'ok', sparkline: [] },
        ],
      };
    }
  );

  // GET /api/hydrotwin/barbo/alertas?estado=activas|resueltas|todas
  fastify.get<{ Querystring: { estado?: string } }>(
    '/hydrotwin/barbo/alertas',
    async (request) => {
      const estado = request.query.estado ?? 'todas';
      if (estado === 'activas') return DEMO_ALERTAS.filter(a => !a.resuelta);
      if (estado === 'resueltas') return DEMO_ALERTAS.filter(a => a.resuelta);
      return DEMO_ALERTAS;
    }
  );

  // GET /api/hydrotwin/barbo/tramos
  fastify.get('/hydrotwin/barbo/tramos', async () => {
    return DEMO_TRAMOS;
  });

  // GET /api/hydrotwin/barbo/acuifero
  fastify.get('/hydrotwin/barbo/acuifero', async () => {
    return DEMO_ACUIFERO;
  });

  // GET /api/hydrotwin/barbo/comparar?a=2023-10:2024-09&b=2024-10:2025-09
  fastify.get<{ Querystring: { a?: string; b?: string } }>(
    '/hydrotwin/barbo/comparar',
    async (request, reply) => {
      const parseRange = (s: unknown): { desde: string; hasta: string } | null => {
        if (typeof s !== 'string') return null;
        const parts = s.split(':');
        if (parts.length !== 2) return null;
        const desde = parseFecha(parts[0]);
        const hasta = parseFecha(parts[1]);
        if (!desde || !hasta) return null;
        return { desde, hasta };
      };

      const periodoA = parseRange(request.query.a);
      const periodoB = parseRange(request.query.b);

      if (!periodoA || !periodoB) {
        return reply.code(400).send({ error: 'Parámetros a y b requeridos. Formato: YYYY-MM:YYYY-MM' });
      }

      const summarize = (periodo: { desde: string; hasta: string }) => {
        const filtered = DEMO_LECTURAS.filter(l => l.fecha >= periodo.desde && l.fecha <= periodo.hasta);
        if (filtered.length === 0) return null;
        const volumenTotal = filtered.reduce((s, l) => s + l.volumenExtraido, 0);
        const eficienciaMedia = filtered.reduce((s, l) => s + l.eficiencia, 0) / filtered.length;
        const kwhPorM3Medio = filtered.reduce((s, l) => s + l.kwhPorM3, 0) / filtered.length;
        const perdidasTotales = filtered.reduce((s, l) => s + l.perdidas, 0);
        const totalDist = filtered.reduce((s, l) => s + l.volumenDistribuido, 0);
        const totalPliego = filtered.reduce((s, l) => s + l.repartoPliego, 0);
        const peak = filtered.reduce((best, l) => l.volumenExtraido > best.volumenExtraido ? l : best, filtered[0]);
        return {
          periodo,
          volumenTotal,
          eficienciaMedia: Math.round(eficienciaMedia * 10000) / 10000,
          kwhPorM3Medio: Math.round(kwhPorM3Medio * 1000) / 1000,
          perdidasTotales,
          perdidasEuros: Math.round(perdidasTotales * 0.42),
          repartoPliegoPct: Math.round((totalPliego / totalDist) * 1000) / 10,
          repartoLibrillaPct: Math.round(((totalDist - totalPliego) / totalDist) * 1000) / 10,
          picoMensual: { fecha: peak.fecha, volumen: peak.volumenExtraido },
        };
      };

      const a = summarize(periodoA);
      const b = summarize(periodoB);

      if (!a || !b) {
        return reply.code(404).send({ error: 'No hay datos para el periodo solicitado' });
      }

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
  );

  // ───────────────────────────────────────────────────────────────────
  // HydroTwin 3D — Proxy to engine for FD simulation
  // ───────────────────────────────────────────────────────────────────

  const engineUrl = process.env.ENGINE_URL ?? 'http://geotwin-engine:8002';

  // GET /api/hydrotwin/barbo/3d/simulate — baseline (cached in engine)
  fastify.get('/hydrotwin/barbo/3d/simulate', async (_request, reply) => {
    try {
      const res = await fetch(`${engineUrl}/hydro/barbo/simulate`);
      if (!res.ok) {
        return reply.code(res.status).send({ error: 'Engine simulation failed' });
      }
      const data = await res.json();
      return data;
    } catch (err) {
      fastify.log.error(err, 'Engine proxy error');
      return reply.code(502).send({ error: 'Engine unavailable' });
    }
  });

  // POST /api/hydrotwin/barbo/3d/simulate — re-simulate with params
  fastify.post<{
    Body: { pump_ls?: number; canal_factor?: number; k_factor?: number };
  }>('/hydrotwin/barbo/3d/simulate', async (request, reply) => {
    try {
      const res = await fetch(`${engineUrl}/hydro/barbo/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      if (!res.ok) {
        return reply.code(res.status).send({ error: 'Engine simulation failed' });
      }
      const data = await res.json();
      return data;
    } catch (err) {
      fastify.log.error(err, 'Engine proxy error');
      return reply.code(502).send({ error: 'Engine unavailable' });
    }
  });
}
