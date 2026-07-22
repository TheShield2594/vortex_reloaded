import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

export default function ProfileRedirectLoading(): React.ReactElement {
  return (
    <div
      className="flex flex-1 items-center justify-center"
      style={{ background: "var(--theme-bg-primary)" }}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading profile...</span>
      <Skeleton className="h-5 w-24" />
    </div>
  )
}
