import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

export default function ServerSettingsLoading(): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center" style={{ background: "var(--theme-bg-primary)" }}>
      <Skeleton className="h-5 w-24" />
    </div>
  )
}
