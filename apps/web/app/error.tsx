"use client"

import { useEffect } from "react"
import * as Sentry from "@sentry/nextjs"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
    if (process.env.NODE_ENV !== "production") {
      console.error("Unhandled error:", error)
    }
  }, [error])

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center min-h-screen gap-4"
      style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-primary)" }}
    >
      <h2 className="text-xl font-bold">Something went wrong</h2>
      <p className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>
        An unexpected error occurred. Please try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="px-4 py-2 rounded text-sm font-medium text-white transition-colors hover:opacity-90"
        style={{ background: "var(--theme-accent)" }}
      >
        Try Again
      </button>
    </div>
  )
}
