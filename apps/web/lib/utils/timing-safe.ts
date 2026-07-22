import crypto from "node:crypto"

/**
 * Constant-time string comparison using crypto.timingSafeEqual.
 * Prevents timing side-channel attacks on secret comparisons.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Perform a dummy comparison to avoid timing leak on length mismatch
    crypto.timingSafeEqual(bufA, bufA)
    return false
  }
  return crypto.timingSafeEqual(bufA, bufB)
}

/**
 * Validate a `Bearer <token>` authorization header against an expected secret.
 * Returns true only if the header is well-formed and the token matches.
 */
export function verifyBearerToken(authHeader: string | null, expectedSecret: string): boolean {
  if (!authHeader || expectedSecret.length === 0) return false
  const prefix = "Bearer "
  if (!authHeader.startsWith(prefix)) return false
  const token = authHeader.slice(prefix.length)
  if (token.length === 0) return false
  return timingSafeEqual(token, expectedSecret)
}
