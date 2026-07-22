/**
 * Shared API route helpers — eliminates the auth-check / JSON-parse / error-response
 * boilerplate duplicated across 100+ route handlers.
 *
 * Usage:
 *   import { requireAuth, parseJsonBody, apiError, dbError, insertAuditLog } from "@/lib/utils/api-helpers"
 */
import { NextResponse, type NextRequest } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { createLogger } from "@/lib/logger"
import type { Json } from "@/types/database"

const log = createLogger("api-helpers")

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export type AuthResult = Awaited<ReturnType<typeof requireAuth>>

/**
 * Authenticate the current request.
 * Returns `{ supabase, user }` on success, or an early `NextResponse` on failure.
 *
 * Replace the 50+ copies of:
 *   const supabase = await createServerSupabaseClient()
 *   const { data: { user } } = await supabase.auth.getUser()
 *   if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
 */
export async function requireAuth() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError && !user) {
    const errRecord = authError as unknown as Record<string, unknown>
    const status = typeof errRecord.status === "number" ? errRecord.status : undefined
    const code = typeof errRecord.code === "string" ? errRecord.code : undefined
    const cause = errRecord.cause

    const isNetworkError =
      (typeof status === "number" && (status === 502 || status === 503 || status === 504))
      || (typeof code === "string" && (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT"))
      || (cause instanceof TypeError)
      || /fetch failed|econnrefused|network/i.test(authError.message ?? "")

    if (isNetworkError) {
      return { supabase, user: null, error: apiError("Auth service temporarily unavailable", 502) } as const
    }
  }

  if (!user) {
    return { supabase, user: null, error: unauthorized() } as const
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
