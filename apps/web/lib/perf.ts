/**
 * Lightweight performance timing for diagnosing server-switch latency.
 * All logging is dev-only and prefixed with [perf] for easy filtering.
 *
 * Server-side: use `perfTimer()` to time async blocks.
 */

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
