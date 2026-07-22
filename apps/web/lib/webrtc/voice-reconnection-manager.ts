/**
 * VoiceReconnectionManager — centralized reconnection state machine for voice sessions.
 *
 * Replaces ad-hoc reconnection logic scattered across useVoice with a single,
 * testable manager that owns the reconnect lifecycle: ICE restarts, full peer
 * re-negotiation, and full session reconnect with exponential backoff + jitter.
 *
 * State machine:  connected ──▶ reconnecting ──▶ connected
 *                                    │
 *                                    ▼
 *                              disconnected  (max attempts exhausted)
 */

// ── Constants ────────────────────────────────────────────────────────────────

const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 30_000
const RECONNECT_MAX_ATTEMPTS = 5
const ICE_RESTART_MAX_PER_PEER = 2

// ── Types ────────────────────────────────────────────────────────────────────

export type VoiceConnectionState = "connected" | "reconnecting" | "disconnected"

export interface ReconnectSnapshot {
  state: VoiceConnectionState
  attempt: number
  maxAttempts: number
}

export type ReconnectListener = (snapshot: ReconnectSnapshot) => void

export interface VoiceReconnectionManagerOptions {
  /** Callback to re-join the Supabase Realtime channel with the preserved MediaStream. */
  rejoinSession: () => Promise<void>
  /** Callback when ICE restart is attempted for a specific peer. */
  onIceRestart: (peerId: string, attempt: number) => void
  /** Callback when a peer needs full re-negotiation (ICE restarts exhausted). */
  onFullPeerReconnect: (peerId: string) => void
  /** Callback when state transitions. */
  onStateChange?: ReconnectListener
  /** Override max attempts (default 5). */
  maxAttempts?: number
}

// ── Manager ──────────────────────────────────────────────────────────────────

export class VoiceReconnectionManager {
  private state: VoiceConnectionState = "connected"
  private attempt = 0
  private readonly maxAttempts: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private iceRestartCounts = new Map<string, number>()
  private listeners = new Set<ReconnectListener>()
  private disposed = false

  private rejoinSession: () => Promise<void>
  private onIceRestart: (peerId: string, attempt: number) => void
  private onFullPeerReconnect: (peerId: string) => void

  constructor(options: VoiceReconnectionManagerOptions) {
    this.rejoinSession = options.rejoinSession
    this.onIceRestart = options.onIceRestart
    this.onFullPeerReconnect = options.onFullPeerReconnect
    this.maxAttempts = options.maxAttempts ?? RECONNECT_MAX_ATTEMPTS

    if (options.onStateChange) {
      this.listeners.add(options.onStateChange)
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: ReconnectListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Current snapshot of reconnection state. */
  getSnapshot(): ReconnectSnapshot {
    return { state: this.state, attempt: this.attempt, maxAttempts: this.maxAttempts }
  }

  /**
   * Notify the manager that a peer's ICE connection state changed.
   * The manager decides whether to ICE-restart, full-reconnect the peer,
   * or escalate to a full session reconnect.
   */
  handleIceStateChange(peerId: string, iceState: RTCIceConnectionState): void {
    if (this.disposed) return

    switch (iceState) {
      case "connected":
      case "completed":
        this.iceRestartCounts.delete(peerId)
        // If we were reconnecting and this was the trigger, check if we can mark connected
        if (this.state === "reconnecting") {
          // Caller should check all peers and call markConnected() if all are healthy.
        }
        break

      case "disconnected":
        if (this.state === "connected") {
          this.transition("reconnecting", 0)
        }
        this.tryIceRestart(peerId)
        break

      case "failed":
        if (this.state === "connected") {
          this.transition("reconnecting", 0)
        }
        if (!this.tryIceRestart(peerId)) {
          this.onFullPeerReconnect(peerId)
          this.iceRestartCounts.delete(peerId)
        }
        break

      case "closed":
        this.iceRestartCounts.delete(peerId)
        break
    }
  }

  /**
   * Called when the Supabase Realtime channel itself goes down or when
   * all peer connections are lost. Schedules a full session reconnect
   * with exponential backoff.
   */
  scheduleSessionReconnect(): void {
    if (this.disposed) return
    if (this.state === "disconnected") return // max attempts exhausted

    if (this.attempt >= this.maxAttempts) {
      this.transition("disconnected", this.attempt)
      return
    }

    const delay = this.computeDelay(this.attempt)
    this.transition("reconnecting", this.attempt + 1)

    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.disposed) return

      this.rejoinSession().then(() => {
        if (!this.disposed) {
          this.transition("connected", 0)
        }
      }).catch(() => {
        if (!this.disposed) {
          this.scheduleSessionReconnect()
        }
      })
    }, delay)
  }

  /** Mark the connection as recovered (all peers healthy). */
  markConnected(): void {
    if (this.disposed) return
    this.clearTimer()
    this.iceRestartCounts.clear()
    this.transition("connected", 0)
  }

  /** User-triggered manual reconnect (resets attempt counter). */
  manualReconnect(): void {
    if (this.disposed) return
    this.attempt = 0
    this.iceRestartCounts.clear()
    this.scheduleSessionReconnect()
  }

  /**
   * Called when the browser goes online after being offline.
   * Only triggers reconnect if not already in disconnected (max-exhausted) state.
   */
  handleOnline(): void {
    if (this.disposed) return
    if (this.state === "disconnected") return
    if (this.state !== "reconnecting") {
      this.attempt = 0
      this.scheduleSessionReconnect()
    }
  }

  /** Called when the browser goes offline. */
  handleOffline(): void {
    if (this.disposed) return
    if (this.state === "connected") {
      this.transition("reconnecting", 0)
    }
  }

  /** Tear down the manager, cancelling any pending timers. */
  dispose(): void {
    this.disposed = true
    this.clearTimer()
    this.listeners.clear()
    this.iceRestartCounts.clear()
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private tryIceRestart(peerId: string): boolean {
    const attempts = this.iceRestartCounts.get(peerId) ?? 0
    if (attempts >= ICE_RESTART_MAX_PER_PEER) {
      return false
    }
    const next = attempts + 1
    this.iceRestartCounts.set(peerId, next)
    this.onIceRestart(peerId, next)
    return true
  }

  private transition(newState: VoiceConnectionState, attempt: number): void {
    if (this.state === newState && this.attempt === attempt) return
    this.state = newState
    this.attempt = attempt
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      try { listener(snapshot) } catch { /* listener error */ }
    }
  }

  private computeDelay(attempt: number): number {
    const base = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt), RECONNECT_MAX_DELAY_MS)
    const jitter = base * (0.1 + Math.random() * 0.2)
    return Math.round(base + jitter)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
