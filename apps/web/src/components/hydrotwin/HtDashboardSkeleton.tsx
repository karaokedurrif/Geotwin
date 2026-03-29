export function HtDashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-4 p-6">
      {/* KPI grid skeleton */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-white/[0.06] bg-[#111118]">
            <div className="p-4 space-y-3">
              <div className="h-2 w-16 rounded bg-white/[0.06]" />
              <div className="h-6 w-20 rounded bg-white/[0.06]" />
              <div className="h-2 w-12 rounded bg-white/[0.06]" />
            </div>
          </div>
        ))}
      </div>

      {/* Charts skeleton */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-[340px] rounded-xl border border-white/[0.06] bg-[#111118]" />
        <div className="h-[340px] rounded-xl border border-white/[0.06] bg-[#111118]" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-[320px] rounded-xl border border-white/[0.06] bg-[#111118]" />
        <div className="h-[200px] rounded-xl border border-white/[0.06] bg-[#111118]" />
      </div>
    </div>
  );
}
