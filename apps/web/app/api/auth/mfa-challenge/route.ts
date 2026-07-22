import { NextResponse } from "next/server"
import { rateLimiter } from "@/lib/rate-limit"
import { requireAuth } from "@/lib/utils/api-helpers"

/**
 * GET /api/auth/mfa-challenge
 * Checks if the current authenticated user has TOTP factors enrolled.
 * Returns the assurance level and factor info so the client can decide
 * whether to show the TOTP challenge screen.
 */
export async function GET() {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    const { data: factors } = await supabase.auth.mfa.listFactors()

    const verifiedTotp = (factors?.totp ?? []).filter((f: { status: string }) => f.status === "verified")
    const hasTOTP = verifiedTotp.length > 0

    return NextResponse.json({
      currentLevel: assurance?.currentLevel ?? "aal1",
      nextLevel: assurance?.nextLevel ?? "aal1",
      hasTOTP,
      factorId: hasTOTP ? verifiedTotp[0].id : null,
    })

  } catch (err) {
    console.error("[auth/mfa-challenge GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/auth/mfa-challenge
 * Creates a challenge and verifies a TOTP code for the given factor.
 * Used during the login flow to step up from AAL1 to AAL2.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const body = (await request.json().catch(() => ({}))) as {
      factorId?: string
      code?: string
    }

    if (!body.factorId || !body.code) {
      return NextResponse.json({ error: "factorId and code are required" }, { status: 400 })
    }

    // Rate limit: 5 attempts per 10 minutes per user+factor (uses Upstash Redis when configured)
    const rateLimitKey = `mfa:${user.id}:${body.factorId}`
    const rl = await rateLimiter.check(rateLimitKey, { limit: 5, windowMs: 10 * 60_000, failClosed: true })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 })
    }

    // Create a challenge
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: body.factorId,
    })

    if (challengeError || !challengeData) {
      return NextResponse.json(
        { error: "Failed to create MFA challenge" },
        { status: 400 }
      )
    }

    // Verify the TOTP code
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: body.factorId,
      challengeId: challengeData.id,
      code: body.code,
    })

    if (verifyError) {
      return NextResponse.json({ error: "Invalid code" }, { status: 401 })
    }

    return NextResponse.json({ ok: true, level: "aal2" })

  } catch (err) {
    console.error("[auth/mfa-challenge POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
