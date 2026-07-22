import { NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { verifyWithAdapter } from "@/lib/auth/passkeys"
import { createAuthSession, issueTrustedDevice } from "@/lib/auth/security"
import { rateLimiter } from "@/lib/rate-limit"
import { getClientIp } from "@vortex/shared"
import { untypedFrom } from "@/lib/supabase/untyped-table"

export async function POST(request: Request) {
  try {
    // Rate limit: 10 verification attempts per minute per IP
    const ip = getClientIp(request.headers) ?? "unknown"
    // failClosed: auth endpoints must block when rate limiter is unavailable
    const rl = await rateLimiter.check(`passkey-verify:${ip}`, { limit: 10, windowMs: 60_000, failClosed: true })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      challenge?: string
      credentialId?: string
      response?: Record<string, unknown>
      trustedDeviceLabel?: string
    }

    if (!body.challenge || !body.credentialId || !body.response) {
      return NextResponse.json({ error: "Missing authentication payload" }, { status: 400 })
    }

    // Validate field types and lengths to reject garbage before DB/crypto work
    if (typeof body.challenge !== "string" || body.challenge.length > 512) {
      return NextResponse.json({ error: "Invalid challenge" }, { status: 400 })
    }
    if (typeof body.credentialId !== "string" || body.credentialId.length > 1024) {
      return NextResponse.json({ error: "Invalid credentialId" }, { status: 400 })
    }
    if (typeof body.response !== "object" || body.response === null || Array.isArray(body.response)) {
      return NextResponse.json({ error: "Invalid response" }, { status: 400 })
    }

    const supabase = await createServiceRoleClient()

    // Atomically claim the challenge — only the first concurrent request succeeds
    const { data: claimedChallenge, error: claimError } = await untypedFrom(supabase, "auth_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("challenge", body.challenge)
      .eq("flow", "login")
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id,user_id,expires_at,origin,rp_id")
      .maybeSingle()

    if (claimError || !claimedChallenge) {
      return NextResponse.json({ error: "Challenge is invalid or expired" }, { status: 400 })
    }

    if (!claimedChallenge.origin || !claimedChallenge.rp_id) {
      return NextResponse.json({ error: "Challenge metadata is incomplete" }, { status: 400 })
    }

    const { data: credential } = await untypedFrom(supabase, "passkey_credentials")
      .select("id,user_id,public_key,counter,revoked_at")
      .eq("credential_id", body.credentialId)
      .maybeSingle()

    if (!credential || credential.revoked_at) {
      return NextResponse.json({ error: "Credential has been revoked" }, { status: 403 })
    }

    if (claimedChallenge.user_id && credential.user_id !== claimedChallenge.user_id) {
      return NextResponse.json({ error: "Credential/user mismatch" }, { status: 403 })
    }

    const verify = await verifyWithAdapter("authentication", {
      challenge: body.challenge,
      credentialId: body.credentialId,
      response: body.response,
      expectedOrigin: claimedChallenge.origin,
      expectedRpId: claimedChallenge.rp_id,
      publicKey: credential.public_key,
      prevCounter: credential.counter,
    })

    if (!verify.verified) {
      return NextResponse.json({ error: "Passkey assertion verification failed" }, { status: 400 })
    }

    // Only enforce counter comparison when both counters are non-zero
    // (first auth always has counter=0 on both sides)
    if (verify.newCounter && credential.counter && verify.newCounter <= credential.counter) {
      return NextResponse.json({ error: "Potential replay detected" }, { status: 409 })
    }

    await untypedFrom(supabase, "passkey_credentials")
      .update({ counter: verify.newCounter, last_used_at: new Date().toISOString() })
      .eq("id", credential.id)

    const userResult = await supabase.auth.admin.getUserById(credential.user_id)
    const email = userResult.data.user?.email
    if (!email) {
      return NextResponse.json({ error: "Unable to resolve account email for passkey login" }, { status: 400 })
    }

    // Generate a magic link token, then verify it server-side through the
    // cookie-aware client so session cookies are set in this response —
    // no implicit-grant redirect required.
    const link = await supabase.auth.admin.generateLink({ type: "magiclink", email })
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

    const trustedDeviceId = body.trustedDeviceLabel
      ? await issueTrustedDevice(credential.user_id, body.trustedDeviceLabel)
      : null

    await createAuthSession({
      userId: credential.user_id,
      trustedDeviceId,
      userAgent: request.headers.get("user-agent"),
      ipAddress: getClientIp(request.headers),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[passkey-verify]", err instanceof Error ? err.message : "Unknown error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
