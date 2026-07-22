import { NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { verifyRecoveryCode } from "@/lib/auth/recovery-codes"
import { rateLimiter } from "@/lib/rate-limit"
import { getClientIp } from "@vortex/shared"
import { untypedFrom } from "@/lib/supabase/untyped-table"

/**
 * POST /api/auth/recovery-codes/redeem
 * Redeems a recovery code during login to bypass MFA.
 * Requires email + password to have already been verified (via Supabase session).
 * The code is marked as consumed (used_at set) after successful use.
 */
export async function POST(request: Request) {
  try {
    // Rate limit: 5 recovery code attempts per 15 minutes per IP (stricter — this is an MFA bypass path)
    const ip = getClientIp(request.headers) ?? "unknown"
    // failClosed: recovery code bypass is a critical auth path — must rate-limit even if Redis is down
    const rl = await rateLimiter.check(`recovery-redeem:${ip}`, { limit: 5, windowMs: 15 * 60_000, failClosed: true })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      email?: unknown
      password?: unknown
      code?: unknown
    }

    if (!body.email || !body.password || !body.code) {
      return NextResponse.json({ error: "Email, password, and recovery code are required" }, { status: 400 })
    }
    if (typeof body.email !== "string" || typeof body.password !== "string" || typeof body.code !== "string") {
      return NextResponse.json({ error: "Email, password, and code must be strings" }, { status: 400 })
    }
    if (body.email.length > 320 || body.password.length > 256 || body.code.length > 64) {
      return NextResponse.json({ error: "Field length exceeded" }, { status: 400 })
    }

    const admin = await createServiceRoleClient()

    // Verify password by attempting sign-in via a throwaway client
    const { createClient } = await import("@supabase/supabase-js")
    const tempClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data: signInData, error: signInError } = await tempClient.auth.signInWithPassword({
      email: body.email!,
      password: body.password!,
    })

    if (signInError || !signInData.user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
    }

    // Sign out the temp session immediately (best-effort)
    try {
      await tempClient.auth.signOut()
    } catch {
      // Non-critical — temp session will expire on its own
    }

    const authUser = signInData.user

    // Fetch all unused recovery codes for this user
    const { data: codes, error: codesError } = await untypedFrom(admin, "recovery_codes")
      .select("id,code_hash")
      .eq("user_id", authUser.id)
      .is("used_at", null)

    if (codesError || !codes || codes.length === 0) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
    }

    // Check the provided code against all unused hashes
    let matchedCodeId: string | null = null
    for (const row of codes as Array<{ id: string; code_hash: string }>) {
      const isMatch = await verifyRecoveryCode(body.code!, row.code_hash)
      if (isMatch) {
        matchedCodeId = row.id
        break
      }
    }

    if (!matchedCodeId) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
    }

    // Atomically mark the code as consumed (used_at IS NULL guard prevents double-use race)
    const { data: consumed, error: consumeError } = await untypedFrom(admin, "recovery_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", matchedCodeId)
      .is("used_at", null)
      .select("id")
      .single()

    if (consumeError || !consumed) {
      return NextResponse.json({ error: "Recovery code already used" }, { status: 409 })
    }

    // Generate a magic link token and verify it server-side so session cookies
    // are set in this response — no implicit-grant redirect required.
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: body.email! })
    const tokenHash = link.data.properties?.hashed_token
    if (!tokenHash) {
      return NextResponse.json({ error: "Unable to finalize session" }, { status: 500 })
    }

    const anonClient = await createServerSupabaseClient()
    const { error: otpError } = await anonClient.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    })
    if (otpError) {
      return NextResponse.json({ error: "Session creation failed" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[recovery-redeem]", err instanceof Error ? err.message : "Unknown error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
