import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

export default function FriendsLoading(): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "var(--theme-bg-primary)" }}>
      {/* Header skeleton */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
        style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-bg-tertiary)" }}
      >
        <Skeleton className="h-5 w-24" />
      </div>

      {/* Friend rows */}
      <div className="flex-1 px-3 py-3 space-y-2 overflow-hidden">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 px-2 py-2 rounded">
            <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
