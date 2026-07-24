/**
 * Step-up (re-authentication) endpoint.
 *
 * `hooks.before` in lib/auth/better-auth.ts refuses `/two-factor/disable` and
 * `/link-social` unless the caller holds a valid `vtx_step_up` cookie. This is
 * the only thing that mints one: the client re-proves a credential here, then
 * retries the gated action. Without it the gate is a permanent lockout rather
 * than a protection (issue #56).
 *
 *   GET  → what the caller would need to submit, and whether they already
 *          hold a live token (so the UI can skip the prompt entirely)
 *   POST → verify `{ password }` or `{ totpCode }` and issue the token
 */
import { headers as nextHeaders } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { createDb } from "@vortex/db"
import { auth } from "@/lib/auth/better-auth"
import { hasValidStepUpToken, issueStepUpToken, STEP_UP_TTL_MS } from "@/lib/auth/step-up"
import { getStepUpMethods, verifyStepUpPassword } from "@/lib/auth/step-up-verify"
import { apiError, checkRateLimit, parseJsonBody, requireAuth } from "@/lib/utils/api-helpers"
import { createLogger } from "@/lib/logger"

const log = createLogger("step-up")

const db = createDb()

/**
 * Deliberately identical for "wrong password", "wrong code" and "you submitted
 * a factor this account doesn't have" — the response must not tell an attacker
 * holding a stolen session which factors the victim has configured beyond what
 * GET already says, nor confirm a guessed password separately from a code.
 */
const VERIFICATION_FAILED = "Verification failed"

/**
 * Returned when the account has no factor to be challenged on at all. Unlike
 * {@link VERIFICATION_FAILED} this is deliberately specific: it's not a failed
 * attempt, it's a state the user has to leave before the action is reachable,
 * and the message has to say how.
 */
const NO_FACTOR_AVAILABLE =
  "Set a password or enable two-factor authentication before changing your account's security settings."

export async function GET() {
  const { user, error } = await requireAuth()
  if (error) return error

  try {
    return NextResponse.json({
      verified: await hasValidStepUpToken(user.id),
      ttlMs: STEP_UP_TTL_MS,
      methods: await getStepUpMethods(db, user.id),
    })
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err), userId: user.id }, "Failed to read step-up methods")
    return apiError("Internal server error", 500)
  }
}

export async function POST(request: NextRequest) {
  const { user, error } = await requireAuth()
  if (error) return error

  // Per-user rather than per-IP: the caller is already authenticated, and this
  // is the only brute-force ceiling on the TOTP path — Better Auth's own
  // per-challenge attempt budget and account lockout only apply to the
  // sign-in branch of `verifyTOTP`, not the session branch used below.
  const limited = await checkRateLimit(user.id, "step-up", {
    limit: 10,
    windowMs: 15 * 60 * 1000,
    failClosed: true,
  })
  if (limited) return limited

  const { data: body, error: parseError } = await parseJsonBody<{
    password?: unknown
    totpCode?: unknown
  }>(request)
  if (parseError) return parseError

  const password = typeof body.password === "string" ? body.password : null
  const totpCode = typeof body.totpCode === "string" ? body.totpCode.replace(/\s/g, "") : null

  try {
    const methods = await getStepUpMethods(db, user.id)

    if (totpCode && methods.totp) {
      const ok = await auth.api
        .verifyTOTP({ body: { code: totpCode }, headers: await nextHeaders() })
        .then(() => true)
        .catch(() => false)
      if (!ok) return apiError(VERIFICATION_FAILED, 401)
    } else if (password && methods.password) {
      if (!(await verifyStepUpPassword(db, user.id, password))) {
        return apiError(VERIFICATION_FAILED, 401)
      }
    } else if (methods.password || methods.totp) {
      // A factor exists but the caller submitted nothing usable for it.
      return apiError(VERIFICATION_FAILED, 401)
    } else {
      // No password and no 2FA — an OAuth-only account (see the bootstrap
      // escape hatch in lib/auth/better-auth.ts, the one path that can create
      // one). Minting a token here would make the session itself the proof,
      // which is exactly what step-up exists to *not* accept: a stolen session
      // could then link an attacker-controlled provider and outlive the theft
      // (CWE-287). Not a lockout either — Better Auth's password reset creates
      // a `credential` account when the user has none, so "forgot password"
      // gets such an account a real factor without help from an admin.
      log.warn({ userId: user.id }, "Step-up refused — account has no password or 2FA to challenge")
      return apiError(NO_FACTOR_AVAILABLE, 403)
    }

    await issueStepUpToken(user.id)
    return NextResponse.json({ ok: true, ttlMs: STEP_UP_TTL_MS })
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err), userId: user.id }, "Step-up verification failed")
    return apiError("Internal server error", 500)
  }
}
