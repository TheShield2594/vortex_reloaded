import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

export default function DiscoverLoading(): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "var(--theme-bg-primary)" }}>
      {/* Search bar skeleton */}
      <div
        className="flex items-center px-6 py-4 border-b flex-shrink-0"
        style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-bg-tertiary)" }}
      >
        <Skeleton className="h-10 w-full max-w-md rounded" />
      </div>

      {/* Server card grid */}
      <div className="flex-1 px-6 py-6 overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="rounded-lg border p-4 space-y-3"
              style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-bg-tertiary)" }}
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full flex-shrink-0" />
                <Skeleton className="h-4 w-28" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
