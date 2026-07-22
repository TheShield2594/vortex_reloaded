/**
 * Shared per-socket sliding-window rate limiter for the signal server.
 *
 * Used by both the main WebRTC signaling handler (index.ts) and
 * the real-time gateway (gateway.ts).
 */

export class SocketRateLimiter {
  /** Nested map: socketId → (action → timestamps) */
  private windows = new Map<string, Map<string, { timestamps: number[] }>>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Start the periodic cleanup timer. Call once after construction.
   * The returned instance can be used for chaining.
   */
  startCleanup(intervalMs = 60_000, maxAgeMs = 120_000): this {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }
    this.cleanupTimer = setInterval(() => this.cleanup(maxAgeMs), intervalMs)
    return this
  }

  /** Stop the periodic cleanup timer (for graceful shutdown). */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Check whether the action is within the rate limit.
   * Returns `true` if allowed, `false` if the limit has been exceeded.
   */
  check(socketId: string, action: string, limit: number, windowMs: number): boolean {
    const now = Date.now()
    const cutoff = now - windowMs
    let socketMap = this.windows.get(socketId)
    if (!socketMap) {
      socketMap = new Map()
      this.windows.set(socketId, socketMap)
    }
    let entry = socketMap.get(action)
    if (!entry) {
      entry = { timestamps: [] }
      socketMap.set(action, entry)
    }
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
    if (entry.timestamps.length >= limit) return false
    entry.timestamps.push(now)
    return true
  }

  /** Remove all rate-limit state for a disconnected socket. */
  remove(socketId: string): void {
    this.windows.delete(socketId)
  }

  /** Evict timestamps older than `maxAgeMs` from all sockets. */
  cleanup(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs
    for (const [socketId, socketMap] of this.windows) {
      for (const [action, entry] of socketMap) {
        entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
        if (entry.timestamps.length === 0) socketMap.delete(action)
      }
      if (socketMap.size === 0) this.windows.delete(socketId)
    }
  }
}
