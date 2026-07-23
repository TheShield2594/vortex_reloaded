/**
 * Shared API route helpers — eliminates the auth-check / JSON-parse / error-response
 * boilerplate duplicated across 100+ route handlers.
 *
 * Usage:
 *   import { requireAuth, parseJsonBody, apiError, dbError, insertAuditLog } from "@/lib/utils/api-helpers"
 */
import { headers as nextHeaders } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { auth } from "@/lib/auth/better-auth"
import { createLogger } from "@/lib/logger"
import type { Json } from "@/types/database"

const log = createLogger("api-helpers")

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export type AuthResult = Awaited<ReturnType<typeof requireAuth>>

/**
 * Authenticated caller, shaped to what routes actually read off it (`.id`
 * near-universally; `.email`/`.username` occasionally) — deliberately not a
 * reconstruction of Supabase's old `User` type, since Better Auth's session
 * user has a genuinely different shape (see lib/auth/better-auth.ts's
 * `user.fields` mapping).
 */
export interface AuthUser {
  id: string
  email: string
  emailVerified: boolean
  username: string
  displayName: string | null
}

/**
 * Authenticate the current request against Better Auth's session.
 * Returns `{ supabase, user }` on success, or an early `NextResponse` on failure.
 *
 * `supabase` is still returned (and still the right client to use) because
 * apps/web's non-auth data access hasn't moved off Supabase Postgres yet —
 * only auth itself has cut over to Better Auth/SQLite (see issue #8's PR
 * description for why the two live side by side for now). Only the identity
 * check below changed; every route's existing `supabase.from(...)` calls are
 * unaffected.
 *
 * Replace the 50+ copies of:
 *   const supabase = await createServerSupabaseClient()
 *   const { data: { user } } = await supabase.auth.getUser()
 *   if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
 */
export async function requireAuth() {
  const supabase = await createServerSupabaseClient()

  let session: Awaited<ReturnType<typeof auth.api.getSession>>
  try {
    session = await auth.api.getSession({ headers: await nextHeaders() })
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "getSession failed")
    return { supabase, user: null, error: apiError("Auth service temporarily unavailable", 502) } as const
  }

  if (!session?.user) {
    return { supabase, user: null, error: unauthorized() } as const
  }

  const user: AuthUser = {
    id: session.user.id,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    username: session.user.name,
    displayName: (session.user as { displayName?: string | null }).displayName ?? null,
  }

  return { supabase, user, error: null } as const
}

/**
 * Same as `requireAuth` but also returns a service-role client for admin ops.
 */
export async function requireAuthWithServiceRole() {
  const result = await requireAuth()
  if (result.error) return { ...result, serviceSupabase: null } as const

  const serviceSupabase = await createServiceRoleClient()
  return { ...result, serviceSupabase } as const
}

// ---------------------------------------------------------------------------
// JSON body parsing
// ---------------------------------------------------------------------------

/**
 * Safely parse a request body as JSON.
 * Returns `{ data }` on success or `{ data: null, error: NextResponse }` on failure.
 *
 * Replace the 15+ copies of:
 *   let body: unknown
 *   try { body = await req.json() }
 *   catch { return NextResponse.json({ error: "Malformed JSON" }, { status: 400 }) }
 */
export async function parseJsonBody<T = unknown>(
  req: NextRequest
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }> {
  try {
    const data = (await req.json()) as T
    return { data, error: null }
  } catch {
    return { data: null, error: apiError("Malformed JSON", 400) }
  }
}

// ---------------------------------------------------------------------------
// Standardised error responses
// ---------------------------------------------------------------------------

/** 401 Unauthorized */
export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 })
}

/** 403 Forbidden */
export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 })
}

/** 404 Not Found */
export function notFound(entity = "Resource") {
  return NextResponse.json({ error: `${entity} not found` }, { status: 404 })
}

/** Generic API error response */
export function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status })
}

/** Structured context for dbError logging */
export interface DbErrorContext {
  route?: string
  userId?: string
  action?: string
  detail?: string
}

/**
 * Convert a Supabase error into a 500 response.
 * Returns a generic message to avoid leaking DB schema details to clients.
 * The original error message is logged server-side for debugging.
 *
 * Replace the 50+ copies of:
 *   if (error) return NextResponse.json({ error: error.message }, { status: 500 })
 */
export function dbError(error: { message: string } | null, context?: string | DbErrorContext): NextResponse | null {
  if (!error) return null
  if (typeof context === "string") {
    log.error({ context, err: error.message }, "Database operation failed")
  } else if (context) {
    log.error({ ...context, err: error.message }, "Database operation failed")
  } else {
    log.error({ err: error.message }, "Database operation failed (no context)")
  }
  return NextResponse.json({ error: "Database operation failed" }, { status: 500 })
}

// ---------------------------------------------------------------------------
// Rate limiting helper
// ---------------------------------------------------------------------------

/**
 * Apply rate limiting to the current request.
 * Returns `null` if the request is allowed, or a 429 `NextResponse` if blocked.
 *
 * Usage:
 *   const limited = await checkRateLimit(user.id, "servers:create", { limit: 10, windowMs: 3600_000 })
 *   if (limited) return limited
 */
export async function checkRateLimit(
  key: string,
  action: string,
  opts: { limit: number; windowMs: number; failClosed?: boolean },
): Promise<NextResponse | null> {
  const { rateLimiter } = await import("@/lib/rate-limit")
  const result = await rateLimiter.check(`${action}:${key}`, opts)
  if (!result.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      },
    )
  }
  return null
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

interface AuditLogEntry {
  server_id: string
  actor_id: string
  action: string
  target_id?: string | null
  target_type?: string | null
  changes?: Record<string, Json | undefined> | null
}

/**
 * Insert an audit log row using the provided Supabase client.
 *
 * Logs errors server-side rather than silently swallowing them.
 * Returns the Supabase result so callers can optionally handle errors.
 */
export async function insertAuditLog(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  entry: AuditLogEntry
): Promise<{ error: { message: string; code?: string } | null }> {
  const { error } = await supabase.from("audit_logs").insert({
    server_id: entry.server_id,
    actor_id: entry.actor_id,
    action: entry.action,
    target_id: entry.target_id ?? null,
    target_type: entry.target_type ?? null,
    changes: (entry.changes as Json) ?? null,
  })

  if (error) {
    log.error({
      action: entry.action,
      server_id: entry.server_id,
      actor_id: entry.actor_id,
      target_id: entry.target_id ?? null,
      db_error: error.message,
      db_code: error.code,
    }, "Audit log insert failed")
  }

  return { error: error ? { message: error.message, code: error.code } : null }
}
