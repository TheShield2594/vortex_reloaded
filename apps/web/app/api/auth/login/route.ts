import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { computeLoginRisk } from "@/lib/auth/risk"
import { rateLimiter } from "@/lib/rate-limit"
import { getClientIp } from "@vortex/shared"
import { untypedFrom, untypedRpc } from "@/lib/supabase/untyped-table"

/**
 * POST /api/auth/login
 * Server-side login endpoint with brute-force protection.
 * Tracks failed attempts and enforces 15-minute lockout after 5 failures.
 * Returns a generic "Invalid credentials" message to avoid email enumeration.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string
    password?: string
  }

  if (!body.email || !body.password) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  // Input bounds — reject obviously invalid payloads early before hitting Supabase
  if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }
  if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 1000) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  const email = body.email.toLowerCase()
  const ipAddress = getClientIp(request.headers)

  // Rate limit by IP — 20 attempts per 15 minutes
  // failClosed: auth endpoints must not allow unlimited attempts when Redis is down
  const rateLimitKey = `login:${ipAddress ?? "unknown"}`
  const rl = await rateLimiter.check(rateLimitKey, { limit: 20, windowMs: 15 * 60 * 1000, failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many login attempts. Please try again later." }, { status: 429 })
  }

  const admin = await createServiceRoleClient()

  // Check if the email is locked out (fail-closed: treat RPC errors as locked out)
  let isLockedOut = false
  try {
    const { data: lockoutResult } = await untypedRpc(admin, "is_login_locked_out", {
      target_email: email,
    })
    isLockedOut = lockoutResult === true
  } catch {
    isLockedOut = true
  }

  if (isLockedOut) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  // Attempt sign-in using a server-side Supabase client that sets cookies
  const cookieStore = await cookies()
  const supabase = createServerClient(
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
            // Server component context — handled by middleware
          }
        },
      },
    }
  )

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: body.password,
  })

  if (error || !data.user) {
    // Record the failed attempt (best-effort; don't block login response on failure)
    try {
      await untypedRpc(admin, "record_login_attempt", {
        target_email: email,
        target_ip: ipAddress,
      })
    } catch {
      // Swallow — failing to record shouldn't change the auth response
    }
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  // Reject unverified emails — destroy the freshly-created session so no
  // valid tokens remain for the unverified user, then signal the client.
  if (!data.user.email_confirmed_at) {
    await supabase.auth.signOut().catch(() => {})
    return NextResponse.json({ emailUnverified: true }, { status: 403 })
  }

  // Clear failed attempts on successful login (best-effort)
  try {
    await untypedRpc(admin, "clear_login_attempts", { target_email: email })
  } catch {
    // Swallow — failing to clear shouldn't block a successful login
  }

  // Risk telemetry + suspicious login alerts (best effort)
  try {
    const currentIp = ipAddress
    const currentUa = request.headers.get("user-agent") || null
    const currentLocation = request.headers.get("x-vercel-ip-country") || request.headers.get("cf-ipcountry") || null

    const { data: prev } = await untypedFrom(admin, "login_risk_events")
      .select("ip_address,user_agent,location_hint")
      .eq("user_id", data.user.id)
      .eq("succeeded", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const risk = computeLoginRisk(
      { userId: data.user.id, ipAddress: currentIp, userAgent: currentUa, locationHint: currentLocation },
      prev ? { ipAddress: prev.ip_address, userAgent: prev.user_agent, locationHint: prev.location_hint } : null
    )

    await untypedFrom(admin, "login_risk_events").insert({
      user_id: data.user.id,
      email,
      ip_address: currentIp,
      user_agent: currentUa,
      location_hint: currentLocation,
      risk_score: risk.riskScore,
      reasons: risk.reasons,
      suspicious: risk.suspicious,
      succeeded: true,
    })

    if (risk.suspicious) {
      await admin.from("notifications").insert({
        user_id: data.user.id,
        type: "system",
        title: "Suspicious login detected",
        body: `We noticed a login from a new device or location (${currentIp || "unknown IP"}). If this wasn't you, reset your password immediately.`,
      })
    }

    // Enforce risk-based actions — scores >= 80 lock the session, >= 60 require MFA/email challenge
    if (risk.action === "lock_and_verify") {
      await supabase.auth.signOut().catch(() => {})
      return NextResponse.json({
        ok: false,
        riskBlocked: true,
        reason: "High-risk login detected. Please verify your email to continue.",
      }, { status: 403 })
    }

    if (risk.action === "challenge_mfa") {
      // If the user has MFA enrolled, we'll force the MFA challenge below.
      // If they don't, sign out and require email verification.
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const verifiedTotp = (factors?.totp ?? []).filter((f: { status: string }) => f.status === "verified")
      if (verifiedTotp.length > 0) {
        return NextResponse.json({
          ok: true,
          userId: data.user.id,
          requiresMfa: true,
          factorId: verifiedTotp[0].id,
        })
      }
      // No MFA enrolled — sign out and require email verification
      await supabase.auth.signOut().catch(() => {})
      return NextResponse.json({
        ok: false,
        riskBlocked: true,
        reason: "Unusual login activity detected. Please verify your email to continue.",
      }, { status: 403 })
    }
  } catch {
    // Do not block successful login on telemetry or alert failures
  }

  // Check if user has TOTP enrolled (for MFA challenge redirect)
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const verifiedTotp = (factors?.totp ?? []).filter((f: { status: string }) => f.status === "verified")
  const requiresMfa = verifiedTotp.length > 0

  // Check assurance level
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const needsChallenge = requiresMfa && assurance?.currentLevel === "aal1"

  return NextResponse.json({
    ok: true,
    userId: data.user.id,
    requiresMfa: needsChallenge,
    factorId: needsChallenge ? verifiedTotp[0].id : null,
  })
}
