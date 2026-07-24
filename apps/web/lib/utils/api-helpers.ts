/**
 * Shared API route helpers — eliminates the auth-check / JSON-parse / error-response
 * boilerplate duplicated across 100+ route handlers.
 *
 * Usage:
 *   import { requireAuth, parseJsonBody, apiError, dbError } from "@/lib/utils/api-helpers"
 */
import { headers as nextHeaders } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/lib/auth/better-auth"
import { createLogger } from "@/lib/logger"

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
 * Returns `{ user }` on success, or an early `NextResponse` on failure.
 *
 * Replace the 50+ copies of:
 *   const { data: { user } } = await getAuthUser()
 *   if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
 */
export async function requireAuth() {
  let session: Awaited<ReturnType<typeof auth.api.getSession>>
  try {
    session = await auth.api.getSession({ headers: await nextHeaders() })
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "getSession failed")
    return { user: null, error: apiError("Auth service temporarily unavailable", 502) } as const
  }

  if (!session?.user) {
    return { user: null, error: unauthorized() } as const
  }

  const user: AuthUser = {
    id: session.user.id,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    username: session.user.name,
    displayName: (session.user as { displayName?: string | null }).displayName ?? null,
  }

  return { user, error: null } as const
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

/** Generic API error response */
export function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status })
}

// ---------------------------------------------------------------------------
// Rate limiting helper
// ---------------------------------------------------------------------------

/**
 * Apply rate limiting to the current request.
 * Returns `null` if the request is allowed, or a 429 `NextResponse` if blocked.
 *
 * Usage:
 *   const limited = await checkRateLimit(user.id, "dm:create", { limit: 10, windowMs: 3600_000 })
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
