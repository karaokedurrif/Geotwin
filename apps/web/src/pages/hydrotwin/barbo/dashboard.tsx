import { useState, useMemo } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { HtLayout } from '@/components/hydrotwin/HtLayout';
import { HtKpiGrid } from '@/components/hydrotwin/HtKpiGrid';
import { HtBalanceChart } from '@/components/hydrotwin/HtBalanceChart';
import { HtRepartoChart } from '@/components/hydrotwin/HtRepartoChart';
import { HtEnergiaChart } from '@/components/hydrotwin/HtEnergiaChart';
import { HtCanalStatus } from '@/components/hydrotwin/HtCanalStatus';
import { HtComparador } from '@/components/hydrotwin/HtComparador';
import { HtAcuiferoWidget } from '@/components/hydrotwin/HtAcuiferoWidget';
import { HtAlertPanel } from '@/components/hydrotwin/HtAlertPanel';
import { HtTimeSelector } from '@/components/hydrotwin/HtTimeSelector';
import { HtDashboardSkeleton } from '@/components/hydrotwin/HtDashboardSkeleton';
import {
  getDemoLecturas,
  getDemoAlertas,
  getDemoTramos,
  getDemoAcuifero,
  computeKpis,
} from '@/lib/hydrotwin/barbo-demo-data';

// Dynamic import for Leaflet map (avoid SSR)
const HtMiniMap = dynamic(
  () => import('@/components/hydrotwin/HtMiniMap').then(m => ({ default: m.HtMiniMap })),
  { ssr: false }
);

export default function HydroTwinBarboDashboard() {
  const [periodo, setPeriodo] = useState({ desde: '2014-10', hasta: '2026-03' });

  const allLecturas = useMemo(() => getDemoLecturas(), []);
  const alertas = useMemo(() => getDemoAlertas(), []);
  const tramos = useMemo(() => getDemoTramos(), []);
  const acuifero = useMemo(() => getDemoAcuifero(), []);

  const filteredLecturas = useMemo(() =>
    allLecturas.filter(l => l.fecha >= periodo.desde && l.fecha <= periodo.hasta),
    [allLecturas, periodo]
  );

  const kpis = useMemo(() => computeKpis(allLecturas), [allLecturas]);

  if (filteredLecturas.length === 0) {
    return (
      <HtLayout estadoConexion="online">
        <HtDashboardSkeleton />
      </HtLayout>
    );
  }

  return (
    <>
      <Head>
        <title>Dashboard — HydroTwin Barbo</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <HtLayout estadoConexion="online">
        <div className="space-y-4 p-4 lg:p-6">
          {/* Time selector */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-200">Centro de mando</h2>
            <HtTimeSelector value={periodo} onChange={setPeriodo} />
          </div>

          {/* KPI Grid */}
          <HtKpiGrid kpis={kpis} />

          {/* Row: Balance + Reparto */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div id="balance">
              <HtBalanceChart lecturas={filteredLecturas} />
            </div>
            <div id="reparto">
              <HtRepartoChart lecturas={filteredLecturas} />
            </div>
          </div>

          {/* Row: Energía + Canal Status */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div id="energia">
              <HtEnergiaChart lecturas={filteredLecturas} />
            </div>
            <div id="perdidas">
              <HtCanalStatus tramos={tramos} />
            </div>
          </div>

          {/* Row: Comparador */}
          <div id="comparador">
            <HtComparador lecturas={allLecturas} />
          </div>

          {/* Row: Map + Acuífero + Alertas */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div id="acuifero" className="lg:col-span-1">
              <HtAcuiferoWidget acuifero={acuifero} />
            </div>
            <div className="lg:col-span-1">
              <HtMiniMap tramos={tramos} />
            </div>
            <div id="alertas" className="lg:col-span-1">
              <HtAlertPanel alertas={alertas} />
            </div>
          </div>
        </div>
      </HtLayout>
    </>
  );
}
