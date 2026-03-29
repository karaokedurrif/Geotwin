import Head from 'next/head';
import Link from 'next/link';
import { Droplets, ArrowRight } from 'lucide-react';

export default function HydroTwinIndex() {
  return (
    <>
      <Head>
        <title>HydroTwin — Gemelos digitales hídricos</title>
      </Head>

      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0f] text-slate-100 px-6">
        <Droplets className="h-12 w-12 text-cyan-400 mb-6" />
        <h1 className="text-3xl font-bold text-slate-200">HydroTwin</h1>
        <p className="mt-2 text-sm text-slate-500">Gemelos digitales hídricos sobre GeoTwin</p>

        <div className="mt-10 w-full max-w-sm">
          <Link
            href="/hydrotwin/barbo"
            className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#111118] p-4 hover:border-cyan-500/20 transition-colors"
          >
            <div>
              <span className="text-sm font-semibold text-slate-200">Aguas del Barbo</span>
              <span className="block text-[11px] text-slate-500">Sierra Espuña · Región de Murcia</span>
            </div>
            <ArrowRight className="h-4 w-4 text-cyan-400" />
          </Link>
        </div>
      </div>
    </>
  );
}
