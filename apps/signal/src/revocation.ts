/**
 * Per-user session revocation store (issue #52).
 *
 * When a user's sessions are invalidated in the web app (password change,
 * forced logout / session revocation, account deletion) it POSTs their userId
 * to the signal server's /revoke-sessions endpoint. We record a per-user
 * "revoked before" cutoff = now: any handshake JWT for that user minted
 * *before* the cutoff is rejected, without waiting for the next revalidation
 * cycle.
 *
 * Revocation is keyed by user, not by token, on purpose: the gateway handshake
 * JWT carries only the user id (its `sub`) and the web app never holds the
 * short-lived (15-minute) tokens themselves — they're minted on demand and
 * rotate every reconnect — so there is no specific token string it could ask
 * us to revoke. The issued-at cutoff makes the distinction that matters:
 * pre-cutoff tokens die immediately, while the fresh token a still-authorized
 * device fetches on its forced reconnect (iat >= cutoff) is admitted, so
 * legitimate devices self-heal and only revoked ones stay out.
 *
 * Backed by Redis when available (so the cutoff is shared across replicas),
 * with an in-memory fallback for single-instance deployments. Reads fail
 * closed — an unreachable store treats the session as revoked rather than
 * admitting a possibly-stale token.
 */

export interface RevocationRedis {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>
}

const REVOCATION_PREFIX = "vortex:revoked-user"

// Cutoff entries only need to outlive the longest-lived pre-cutoff token (the
// 15-minute JWT lifetime); 20 minutes leaves margin for clock skew, after
// which every pre-cutoff token has expired on its own and the entry can go.
export const REVOCATION_TTL_SECONDS = 20 * 60

export class SessionRevocationStore {
  private readonly redis: RevocationRedis | null
  private readonly now: () => number
  /** In-memory fallback: userId -> { cutoffMs, expiresAt }. */
  private readonly inMemory = new Map<string, { cutoffMs: number; expiresAt: number }>()

  constructor(redis: RevocationRedis | null, now: () => number = Date.now) {
    this.redis = redis
    this.now = now
  }

  /**
   * Records "revoke every token this user holds now". Returns false if the
   * cutoff could not be persisted (Redis error) so the caller can surface it.
   */
  async revoke(userId: string): Promise<boolean> {
    const cutoffMs = this.now()
    try {
      if (this.redis) {
        await this.redis.set(`${REVOCATION_PREFIX}:${userId}`, String(cutoffMs), "EX", REVOCATION_TTL_SECONDS)
      } else {
        this.inMemory.set(userId, { cutoffMs, expiresAt: cutoffMs + REVOCATION_TTL_SECONDS * 1000 })
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * True when the user has an active revocation whose cutoff is newer than the
   * token's issued-at — i.e. the token predates the revocation and must be
   * rejected. Throws are surfaced to the caller, which fails closed.
   */
  async isRevoked(userId: string, tokenIatSeconds: number): Promise<boolean> {
    const tokenIatMs = tokenIatSeconds * 1000
    if (this.redis) {
      const cutoff = await this.redis.get(`${REVOCATION_PREFIX}:${userId}`)
      if (cutoff === null) return false
      return tokenIatMs < Number(cutoff)
    }
    const entry = this.inMemory.get(userId)
    if (entry === undefined) return false
    if (this.now() > entry.expiresAt) {
      this.inMemory.delete(userId)
      return false
    }
    return tokenIatMs < entry.cutoffMs
  }

  /** Drop expired in-memory cutoffs (no-op when Redis-backed). */
  pruneExpired(): void {
    const now = this.now()
    for (const [userId, entry] of this.inMemory) {
      if (now > entry.expiresAt) this.inMemory.delete(userId)
    }
  }
}
