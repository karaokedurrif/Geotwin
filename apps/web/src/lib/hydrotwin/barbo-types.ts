export interface LecturaMensual {
  fecha: string;              // 'YYYY-MM'
  volumenExtraido: number;    // m³
  volumenDistribuido: number; // m³
  perdidas: number;           // m³
  eficiencia: number;         // 0-1
  kwhTotal: number;
  kwhPorM3: number;
  horasBombeo: number;
  repartoPliego: number;      // m³
  repartoLibrilla: number;    // m³
}

export interface AlertaOperativa {
  id: string;
  tipo: 'perdida' | 'energia' | 'reparto' | 'acuifero' | 'intrusion' | 'mantenimiento';
  severidad: 'info' | 'aviso' | 'alarma' | 'critica';
  mensaje: string;
  timestamp: string;
  nodoOrigen?: string;
  resuelta: boolean;
}

export interface TramoCanal {
  id: string;
  nombre: string;
  longitudKm: number;
  tipo: 'entubado' | 'cielo_abierto';
  estado: 'ok' | 'aviso' | 'alarma';
  perdidasEstimadas: number; // %
  ultimaLectura?: string;
}

export interface EstadoAcuifero {
  nivelPiezometrico: number;       // m.s.n.m.
  tendencia: 'subiendo' | 'estable' | 'bajando';
  estadoRegulatorio: 'buen_estado' | 'riesgo' | 'mal_estado';
  precipitacionAcumulada: number;  // mm últimos 12 meses
}

export type PeriodoComparacion = {
  desde: string; // 'YYYY-MM'
  hasta: string;
};

export interface DashboardState {
  periodo: PeriodoComparacion;
  lecturas: LecturaMensual[];
  alertas: AlertaOperativa[];
  tramos: TramoCanal[];
  acuifero: EstadoAcuifero;
  ultimaActualizacion: string;
  estadoConexion: 'online' | 'offline' | 'degradado';
}

export interface KpiCard {
  id: string;
  label: string;
  valor: number;
  unidad: string;
  tendencia: number;       // % cambio vs periodo anterior
  colorEstado: 'ok' | 'aviso' | 'alarma';
  sparkline: number[];     // últimos 12 valores
}

export interface ResumenCampania {
  periodo: PeriodoComparacion;
  volumenTotal: number;
  eficienciaMedia: number;
  kwhPorM3Medio: number;
  perdidasTotales: number;     // m³
  perdidasEuros: number;       // €
  repartoPliegoPct: number;    // %
  repartoLibrillaPct: number;  // %
  picoMensual: { fecha: string; volumen: number };
}

export interface ComparacionCampanias {
  campaniaA: ResumenCampania;
  campaniaB: ResumenCampania;
  deltas: {
    volumenTotal: number;
    eficienciaMedia: number;
    kwhPorM3Medio: number;
    perdidasTotales: number;
    perdidasEuros: number;
    repartoPliegoPct: number;
  };
}
