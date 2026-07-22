import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { getRpId, PASSKEY_CHALLENGE_TTL_SECONDS, randomChallenge, resolveRequestOrigin } from "@/lib/auth/passkeys"
import { rateLimiter } from "@/lib/rate-limit"
import { getClientIp } from "@vortex/shared"
import { untypedFrom } from "@/lib/supabase/untyped-table"

/**
 * Look up a user by email via the GoTrue admin REST API.
 * The Supabase JS client's admin.listUsers does not support email filtering,
 * so we call the REST endpoint directly.
 */
async function getUserIdByEmail(email: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return null

  try {
    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1&filter=${encodeURIComponent(`email:eq:${email}`)}`,
      {
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? serviceKey,
        },
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    const users = data?.users ?? data
    if (Array.isArray(users) && users.length === 1 && users[0]?.id) {
      return users[0].id as string
    }
    return null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    // Rate limit: 10 passkey challenge requests per minute per IP
    const ip = getClientIp(request.headers) ?? "unknown"
    // failClosed: auth endpoints must block when rate limiter is unavailable
    const rl = await rateLimiter.check(`passkey-options:${ip}`, { limit: 10, windowMs: 60_000, failClosed: true })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { email } = (await request.json().catch(() => ({}))) as { email?: string }

    // Basic email format validation before any DB lookup
    if (email !== undefined && (typeof email !== "string" || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 })
    }

    const supabase = await createServiceRoleClient()

    let userId: string | null = null
    let policy = {
      passkey_first: false,
      enforce_passkey: false,
      fallback_password: true,
      fallback_magic_link: true,
    }

    if (email) {
      userId = await getUserIdByEmail(email)

      if (userId) {
        const { data: policyRow } = await untypedFrom(supabase, "auth_security_policies")
          .select("passkey_first,enforce_passkey,fallback_password,fallback_magic_link")
          .eq("user_id", userId)
          .maybeSingle()
        if (policyRow) policy = policyRow as typeof policy
      }
    }

    const challenge = randomChallenge()
    const expiresAt = new Date(Date.now() + PASSKEY_CHALLENGE_TTL_SECONDS * 1000).toISOString()
    const origin = resolveRequestOrigin(request.headers)
    const rpID = getRpId(origin)

    const { error: challengeError } = await untypedFrom(supabase, "auth_challenges").insert({
      user_id: userId,
      flow: "login",
      challenge,
      rp_id: rpID,
      origin,
      expires_at: expiresAt,
    })
    if (challengeError) {
      console.error("[passkey-options] challenge insert failed:", challengeError.message)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    // Only query credentials for a specific user — never expose the full table
    let credentials: Array<{ credential_id: string }> = []
    if (userId) {
      const { data } = await untypedFrom(supabase, "passkey_credentials")
        .select("credential_id")
        .is("revoked_at", null)
        .eq("user_id", userId)
      credentials = data || []
    }

    return NextResponse.json({
      challenge,
      timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
      rpId: rpID,
      userVerification: "preferred",
      allowCredentials: credentials.map((row) => ({ id: row.credential_id, type: "public-key" })),
      policy,
    })
  } catch (err) {
    console.error("[passkey-options]", err instanceof Error ? err.message : "Unknown error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
