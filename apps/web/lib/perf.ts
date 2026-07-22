/**
 * Lightweight performance timing for diagnosing server-switch latency.
 * All logging is dev-only and prefixed with [perf] for easy filtering.
 *
 * Server-side: use `perfTimer()` to time async blocks.
 * Client-side: use `perfMarkNavStart()` at navigation trigger,
 *              then `perfLogSinceNav()` in component mount effects.
 */

interface PerfWindow extends Window {
  __vortexNavStart?: number
  __vortexNavContext?: string
}

const ENABLED = process.env.NODE_ENV !== "production"

// ── Server-side timing ──────────────────────────────────────────────────────

/** Start a timer; call `.end()` to log the elapsed time. */
export function perfTimer(label: string): { end: () => void } {
  if (!ENABLED) return { end() {} }
  const start = performance.now()
  return {
    end() {
      const ms = (performance.now() - start).toFixed(1)
      console.log(`[perf] ${label} — ${ms}ms`)
    },
  }
}

// ── Client-side navigation timing ───────────────────────────────────────────

/** Mark the start of a server/channel switch navigation. */
export function perfMarkNavStart(context?: string) {
  if (!ENABLED || typeof window === "undefined") return
  const w = window as PerfWindow
  w.__vortexNavStart = performance.now()
  w.__vortexNavContext = context ?? "unknown"
  console.log(`[perf] ▶ navigation start${context ? ` (${context})` : ""}`)
}

/** Log elapsed time since the last `perfMarkNavStart()` call. */
export function perfLogSinceNav(label: string) {
  if (!ENABLED || typeof window === "undefined") return
  const w = window as PerfWindow
  const start = w.__vortexNavStart
  if (start == null) return
  const elapsed = (performance.now() - start).toFixed(1)
  const ctx = w.__vortexNavContext ?? ""
  console.log(`[perf]   ${label} — ${elapsed}ms${ctx ? ` [${ctx}]` : ""}`)
}

/** Clear the navigation mark (call when the final component mounts). */
export function perfClearNav() {
  if (!ENABLED || typeof window === "undefined") return
  const w = window as PerfWindow
  delete w.__vortexNavStart
  delete w.__vortexNavContext
}
