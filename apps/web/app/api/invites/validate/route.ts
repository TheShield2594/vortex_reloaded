import { NextRequest, NextResponse } from "next/server"
import { createDb } from "@vortex/db"
import { checkInviteCode } from "@/lib/auth/invites"
import { checkRateLimit } from "@/lib/utils/api-helpers"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/invites/validate")
const db = createDb()

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  )
}

// GET /api/invites/validate?code=XXX — public pre-check for the register
// page (no auth: prospective users don't have an account yet). This is
// read-only (see lib/auth/invites.ts's checkInviteCode) — the actual,
// atomic redemption happens server-side in the sign-up hook itself, so a
// "valid" response here is only ever a UX convenience, never the real gate.
export async function GET(req: NextRequest) {
  try {
    // IP-keyed since the caller isn't authenticated — codes have ~40 bits of
    // entropy, but rate limiting still meaningfully raises the cost of
    // enumeration attempts against it.
    const limited = await checkRateLimit(clientIp(req), "invites:validate", { limit: 20, windowMs: 60_000 })
    if (limited) return limited

    const code = req.nextUrl.searchParams.get("code")
    if (!code) return NextResponse.json({ error: "code required" }, { status: 400 })

    const result = await checkInviteCode(db, code)
    return NextResponse.json(result)
  } catch (err) {
    log.error({ route: "/api/invites/validate", action: "GET", error: err instanceof Error ? err.message : String(err) }, "GET error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
