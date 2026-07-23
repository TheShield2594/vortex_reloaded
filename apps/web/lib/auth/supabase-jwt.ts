import { SignJWT } from "jose"

/**
 * Short-lived — minted fresh per request (see lib/supabase/server.ts), so
 * there's no benefit to a longer lifetime and every extra second is extra
 * blast radius if one ever leaked (e.g. into logs).
 */
const SUPABASE_ACCESS_TOKEN_TTL_SECONDS = 60

function jwtSecret(): Uint8Array {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) {
    throw new Error("SUPABASE_JWT_SECRET must be set to authenticate Supabase Postgres requests")
  }
  return new TextEncoder().encode(secret)
}

/**
 * Supabase Postgres's RLS policies are keyed on `auth.uid()`/`auth.role()`
 * (see supabase/migrations/00002_rls_policies.sql), which read the `sub`/
 * `role` claims PostgREST extracts from the request's JWT — normally one
 * Supabase Auth (GoTrue) issues and the client keeps in a cookie/session.
 * Better Auth owns the session now (see lib/auth/better-auth.ts) and never
 * mints a Supabase-shaped token, so without this, every RLS-protected query
 * from apps/web's anon-key Supabase client would run as the anonymous role
 * and `auth.uid()` would resolve to NULL — not an error, just silent
 * empty-result-set reads and RLS-rejected writes.
 *
 * This mints a JWT with the same claim shape and signing scheme
 * (HS256, project JWT secret) Supabase's own tokens use, scoped to the
 * already-verified Better Auth session's user id, so RLS resolves exactly
 * as it did pre-cutover.
 */
export async function signSupabaseAccessToken(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + SUPABASE_ACCESS_TOKEN_TTL_SECONDS)
    .sign(jwtSecret())
}
