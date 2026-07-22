import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

export default function NotificationsLoading(): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "var(--theme-bg-primary)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
        style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-bg-tertiary)" }}
      >
        <Skeleton className="h-5 w-32" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-7 w-20 rounded" />
        </div>
      </div>

      {/* Notification rows */}
      <div className="flex-1 px-3 py-3 space-y-2 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-3 py-3 rounded">
            <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3 w-64" />
              <Skeleton className="h-2.5 w-16 opacity-60" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
