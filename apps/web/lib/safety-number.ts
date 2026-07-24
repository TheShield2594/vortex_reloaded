/**
 * Issue #40 ("Group trust model") — derives a Signal-style numeric "safety
 * number" from two users' Olm ed25519 identity keys, so both sides can
 * compare a short human-checkable code (or scan each other's QR) instead of
 * trusting the server's TOFU pinning alone (see olm-protocol-store.ts's
 * checkAndPinIdentity). Only public key material is used — this runs
 * equally well server-side (to compute the "does this still match what was
 * verified" status attached to a nudge/notification) and client-side (to
 * render the actual comparison UI), so it's kept dependency-free and usable
 * under both the browser's and Node's global `crypto.subtle`.
 *
 * This is deliberately a simplified, from-scratch scheme inspired by (not
 * bit-compatible with) Signal's own numeric fingerprint — this codebase
 * never claims Signal Protocol compatibility (see olm-protocol.ts's top
 * comment), and a bit-compatible fingerprint would be meaningless anyway
 * since the underlying key material isn't Signal's.
 */

const ITERATIONS = 5200
const VERSION = "vortex-safety-number:v1"

// Issue #40: 5200 SHA-256 iterations per identity is deliberately slow (it's
// what makes brute-forcing a colliding identity key expensive) but that
// means it's also slow to *serve* — the safety-number GET route computes
// this twice per request, and the UI fires one request per other group
// member on tab open. Memoized by (userId, ed25519Key) — the key itself is
// part of the cache key, so a rotated/compromised key just misses the cache
// under its new value rather than needing explicit invalidation. Caches the
// in-flight Promise (not just the resolved value) so concurrent requests
// for the same identity dedupe onto one computation. Bounded FIFO eviction
// keeps this from growing unboundedly across a long process lifetime.
const FINGERPRINT_CACHE_MAX = 2000
const fingerprintCache = new Map<string, Promise<string>>()

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource)
  return new Uint8Array(digest)
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/**
 * One identity's half of the safety number: iterated SHA-256 (slows down
 * brute-force collision search on the identity key) over `userId` +
 * `ed25519Key`, reduced to 30 digits — six 5-digit groups read from the
 * first 30 bytes of the final digest, each 5-byte chunk taken as a
 * big-endian integer mod 100000 (matches the digit count Signal's own
 * fingerprint uses per identity).
 */
function fingerprintFor(userId: string, ed25519Key: string): Promise<string> {
  const cacheKey = `${userId}:${ed25519Key}`
  const cached = fingerprintCache.get(cacheKey)
  if (cached) return cached

  const computed = (async () => {
    const encoder = new TextEncoder()
    const keyBytes = encoder.encode(ed25519Key)
    let digest = await sha256(concatBytes(encoder.encode(`${VERSION}:${userId}:`), keyBytes))
    for (let i = 0; i < ITERATIONS; i++) {
      digest = await sha256(concatBytes(digest, keyBytes))
    }

    let digits = ""
    for (let chunk = 0; chunk < 6; chunk++) {
      const start = chunk * 5
      let value = 0
      for (let b = 0; b < 5; b++) value = value * 256 + digest[start + b]
      digits += String(value % 100000).padStart(5, "0")
    }
    return digits
  })()

  fingerprintCache.set(cacheKey, computed)
  // A failed computation shouldn't poison the cache for retries.
  computed.catch(() => fingerprintCache.delete(cacheKey))
  if (fingerprintCache.size > FINGERPRINT_CACHE_MAX) {
    const oldestKey = fingerprintCache.keys().next().value
    if (oldestKey !== undefined) fingerprintCache.delete(oldestKey)
  }
  return computed
}

export type SafetyNumberIdentity = { userId: string; ed25519Key: string }

/**
 * The full 60-digit safety number for a pair of identities — both sides
 * sorted by userId so either party computes the same combined string
 * regardless of who's "self" vs "other".
 */
export async function computeSafetyNumber(a: SafetyNumberIdentity, b: SafetyNumberIdentity): Promise<string> {
  const [first, second] = a.userId <= b.userId ? [a, b] : [b, a]
  const [fa, fb] = await Promise.all([
    fingerprintFor(first.userId, first.ed25519Key),
    fingerprintFor(second.userId, second.ed25519Key),
  ])
  return fa + fb
}

/** Splits a 60-digit safety number into groups of 5 for display, e.g. "12345 67890 ...". */
export function formatSafetyNumber(digits: string): string {
  return digits.match(/.{1,5}/g)?.join(" ") ?? digits
}
