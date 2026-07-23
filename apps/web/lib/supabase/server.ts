import { cache } from "react"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import type { Database } from "@/types/database"

/**
 * Per-request cached auth check. Deduplicates the session lookup across
 * nested layouts and pages within a single render. Backed by Better Auth
 * (see lib/auth/better-auth.ts's `getBetterAuthUser` — same
 * `supabase.auth.getUser()`-shaped return value, so every existing caller
 * here needed no changes beyond the auth check itself moving off Supabase).
 */
export const getAuthUser = cache(async () => {
  const { getBetterAuthUser } = await import("@/lib/auth/better-auth")
  return getBetterAuthUser()
})

/**
 * Per-request cached Supabase client. Deduplicates client creation across
 * nested layouts and pages within a single render.
 *
 * Authenticates as the Better Auth session's user, not just via cookies —
 * Better Auth's session cookie means nothing to Supabase/PostgREST, so
 * without an explicit Supabase-shaped access token every query here would
 * run as the anonymous Postgres role and RLS policies keyed on
 * `auth.uid()` (supabase/migrations/00002_rls_policies.sql) would silently
 * see no authenticated user — not an error, just empty reads and rejected
 * writes. See lib/auth/supabase-jwt.ts for why this is safe to mint
 * per-request from just a user id.
 */
export const createServerSupabaseClient = cache(async () => {
  const cookieStore = await cookies()
  const { data } = await getAuthUser()

  let accessToken: string | undefined
  if (data.user) {
    const { signSupabaseAccessToken } = await import("@/lib/auth/supabase-jwt")
    accessToken = await signSupabaseAccessToken(data.user.id)
  }

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — proxy handles session refresh.
          }
        },
      },
    }
  )
})

/** Per-request cached service-role client. Bypasses RLS — use only for admin operations. */
export const createServiceRoleClient = cache(async () => {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
})
