import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

export default function EventsLoading(): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "var(--theme-bg-primary)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
        style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-bg-tertiary)" }}
      >
        <Skeleton className="h-5 w-28" />
      </div>

      {/* Calendar skeleton */}
      <div className="flex-1 px-6 py-6 space-y-4 overflow-hidden">
        {/* Month header */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-36" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
          </div>
        </div>
        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={`h-${i}`} className="h-6 w-full rounded" />
          ))}
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded" />
          ))}
        </div>
      </div>
    </div>
  )
}
