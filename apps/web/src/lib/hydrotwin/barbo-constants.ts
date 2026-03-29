export const BARBO = {
  concesion: {
    volumenAnualAutorizado: 4_447_872, // m³/año
    unidad: 'm³',
    titular: 'Aguas del Barbo',
    masaAgua: 'Sierra Espuña (070.040)',
    estadoMasa: 'riesgo_cuantitativo',
  },
  historico: {
    inicio: '2014-10',
    fin: '2026-03',
    registros: 144,
  },
  eficiencia: {
    2024: 0.947,
    2025: 0.958,
  },
  perdidasAnuales: 51_000, // €
  patronEstacional: {
    picoVerano: { mes: 'julio', volumen: 444_000 },
    valleInvierno: { mes: 'febrero', volumen: 210_000 },
  },
  infraestructura: {
    pozo: { lat: 37.85, lng: -1.48, tipo: 'cabecera' as const },
    bifurcacion: { lat: 37.87, lng: -1.46, tipo: 'reparto' as const, destinos: ['Pliego', 'Librilla'] },
    partidores: 3,
    tramosCanal: 5,
    longitudCanalKm: 12.5,
  },
  presupuestoPiloto: {
    austero: { min: 43_000, max: 72_000, recomendado: '48-65k€' },
    inteligente: { min: 146_000, max: 294_000, recomendado: '160-240k€' },
  },
  cupoMensualMedio: 4_447_872 / 12, // ~370,656 m³/mes
  costePorM3Perdido: 0.42, // €/m³ estimado para calcular pérdidas en €
} as const;

export const HT_COLORS = {
  primary: '#06b6d4',      // azul agua — color principal HydroTwin
  ok: '#10b981',           // esmeralda
  aviso: '#f59e0b',        // ámbar
  alarma: '#ef4444',       // rojo
  pliego: '#06b6d4',       // cyan
  librilla: '#1e3a5f',     // azul oscuro
  bg: '#0a0a0f',
  bgCard: '#111118',
  border: 'rgba(255,255,255,0.06)',
  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
} as const;

export const HT_THRESHOLDS = {
  eficiencia: { ok: 0.95, aviso: 0.90 },       // >= ok → verde, >= aviso → ámbar, else rojo
  kwhPorM3: { ok: 0.55, aviso: 0.65 },         // <= ok → verde, <= aviso → ámbar, else rojo
  perdidasPct: { ok: 0.03, aviso: 0.05 },      // <= ok → verde, <= aviso → ámbar, else rojo
  cupoAnual: { aviso: 0.85, alarma: 0.95 },    // >= aviso → ámbar, >= alarma → rojo
} as const;
