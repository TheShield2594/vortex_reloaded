"use client"

import { authClient } from "@/lib/auth/auth-client"

/**
 * Wraps a fetch response check — if 401, re-validates the session.
 * Better Auth's opaque session token doesn't need an active refresh call
 * the way Supabase's short-lived JWT did (it's refreshed lazily server-side
 * on ordinary getSession() calls past the `updateAge` threshold) — a 401
 * here means the session is genuinely gone (expired/revoked/signed out
 * elsewhere), so this just confirms that and redirects to login.
 */
export async function handleAuthError(response: Response): Promise<Response> {
  if (response.status === 401) {
    try {
      const { data } = await authClient.getSession()
      if (!data?.session) {
        if (typeof window !== "undefined") {
          window.location.href = "/login?expired=true"
        }
      }
    } catch (err: unknown) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[api-client.handleAuthError] getSession threw", {
          status: response.status,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
      // getSession threw — treat as expired
      if (typeof window !== "undefined") {
        window.location.href = "/login?expired=true"
      }
    }
  }
  return response
}

/**
 * Checks if a response is rate-limited and returns retry info.
 */
export function isRateLimited(response: Response): { limited: boolean; retryAfter: number | null } {
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After")
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10)
      if (!Number.isNaN(parsed)) {
        return { limited: true, retryAfter: parsed }
      }
      const dateMs = Date.parse(retryAfter)
      if (!Number.isNaN(dateMs)) {
        return { limited: true, retryAfter: Math.max(0, Math.ceil((dateMs - Date.now()) / 1000)) }
      }
    }
    return { limited: true, retryAfter: null }
  }
  return { limited: false, retryAfter: null }
}
