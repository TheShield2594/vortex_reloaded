import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

export default function SettingsLoading(): React.ReactElement {
  return (
    <div className="flex flex-1 overflow-hidden" style={{ background: "var(--theme-bg-primary)" }}>
      {/* Sidebar */}
      <aside
        className="w-56 flex-shrink-0 border-r px-3 py-4 space-y-2"
        style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-bg-tertiary)" }}
      >
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-7 w-full rounded" />
        ))}
      </aside>

      {/* Content area */}
      <main className="flex-1 px-8 py-6 overflow-hidden">
        {/* Title */}
        <Skeleton className="h-7 w-48 mb-6" />

        {/* Setting rows */}
        <div className="space-y-5">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between border-b pb-4"
              style={{ borderColor: "var(--theme-bg-tertiary)" }}
            >
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-8 w-20 rounded" />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
