import { NextRequest, NextResponse } from "next/server"
import { pruneExpiredLoginAttempts } from "@/lib/auth/better-auth"
import { verifyBearerToken } from "@/lib/utils/timing-safe"

/**
 * GET /api/cron/login-attempts-cleanup
 *
 * Maintenance worker: purges login-attempt rows older than the lockout window.
 * Failed attempts are only cleared per-email on a successful login, so rows for
 * emails that never succeed (credential-stuffing probes, abandoned sign-ins)
 * would otherwise grow without bound. Anything older than the lockout window is
 * irrelevant to the lockout check, so it is safe to delete.
 *
 * Runs on a schedule via the cron runner (apps/cron). Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const secret = process.env.CRON_SECRET
    if (!secret) {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
    }
    const authHeader = req.headers.get("authorization")
    if (!verifyBearerToken(authHeader, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const deleted = await pruneExpiredLoginAttempts()

    console.log("login-attempts-cleanup: purged stale rows", {
      route: "cron/login-attempts-cleanup",
      deleted,
    })

    return NextResponse.json({ ok: true, deleted })
  } catch (err) {
    console.error("login-attempts-cleanup: unexpected error", {
      route: "cron/login-attempts-cleanup",
      error: err instanceof Error ? err.message : err,
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
