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

/** Per-request cached Supabase client. Deduplicates client creation across nested layouts and pages within a single render. */
export const createServerSupabaseClient = cache(async () => {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
