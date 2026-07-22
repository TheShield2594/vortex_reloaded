import { Skeleton } from "@/components/ui/skeleton"
import { VortexSpinner, VortexMotif } from "@/components/ui/vortex-spinner"

export default function ServerLoading() {
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Mobile: single-column skeleton with top bar ── */}
      <div className="flex flex-1 flex-col md:hidden" style={{ background: "var(--theme-bg-primary)" }}>
        {/* Top bar placeholder */}
        <div
          className="flex items-center gap-1 px-2 py-2 border-b flex-shrink-0"
          style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-bg-tertiary)" }}
        >
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-4 w-28" />
        </div>
        {/* Centered spinner */}
        <div className="flex flex-col items-center justify-center flex-1 gap-3 relative">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
            <VortexMotif size={160} />
          </div>
          <div className="relative z-10 flex flex-col items-center gap-3">
            <VortexSpinner size={40} />
            <p className="text-sm animate-pulse" style={{ color: "var(--theme-text-muted)" }}>Loading server...</p>
          </div>
        </div>
      </div>

      {/* ── Desktop: three-column skeleton ── */}
      <aside className="hidden md:block w-60 flex-shrink-0 border-r px-3 py-4" style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-bg-tertiary)" }}>
        <Skeleton className="mb-4 h-8 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 12 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      </aside>

      <main className="hidden md:block flex-1 border-r px-4 py-4 relative" style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-bg-tertiary)" }}>
        {/* Vortex spiral motif as subtle background watermark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
          <VortexMotif size={200} />
        </div>
        {/* Vortex branded spinner */}
        <div className="flex flex-col items-center justify-center h-full gap-3 relative z-10">
          <VortexSpinner size={48} />
          <p className="text-sm animate-pulse" style={{ color: "var(--theme-text-muted)" }}>Loading server...</p>
        </div>
      </main>

      <aside className="hidden md:block w-60 flex-shrink-0 px-3 py-4" style={{ background: "var(--theme-bg-secondary)" }}>
        <Skeleton className="mb-3 h-3 w-20" />
        <div className="space-y-3">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-2.5 w-28" />
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
