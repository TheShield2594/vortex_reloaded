"use client"

import { useEffect } from "react"
import * as Sentry from "@sentry/nextjs"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
    if (process.env.NODE_ENV !== "production") {
      console.error("Global unhandled error:", error)
    }
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "var(--theme-bg-primary)", color: "var(--theme-text-primary)", fontFamily: "var(--font-body, system-ui, sans-serif)" }}>
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            gap: "16px",
          }}
        >
          <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: 0 }}>Something went wrong</h2>
          <p style={{ fontSize: "14px", color: "var(--theme-text-secondary)", margin: 0 }}>
            An unexpected error occurred. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "8px 16px",
              borderRadius: "4px",
              fontSize: "14px",
              fontWeight: 500,
              color: "white",
              background: "var(--theme-accent)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  )
}
