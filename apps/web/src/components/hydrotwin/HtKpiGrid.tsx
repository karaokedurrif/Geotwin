import { HtKpiCard } from './HtKpiCard';
import type { KpiCard } from '@/lib/hydrotwin/barbo-types';

interface HtKpiGridProps {
  kpis: KpiCard[];
}

export function HtKpiGrid({ kpis }: HtKpiGridProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {kpis.map(kpi => (
        <HtKpiCard key={kpi.id} kpi={kpi} />
      ))}
    </div>
  );
}
