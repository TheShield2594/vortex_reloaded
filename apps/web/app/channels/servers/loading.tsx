import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

export default function ServersLoading(): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "var(--theme-bg-primary)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
        style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-bg-tertiary)" }}
      >
        <Skeleton className="h-5 w-28" />
        <div className="ml-auto">
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      </div>

      {/* Server grid skeleton */}
      <div className="flex-1 px-4 py-4 overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg p-4 space-y-3"
              style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
            >
              <Skeleton className="h-12 w-12 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20 opacity-60" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
