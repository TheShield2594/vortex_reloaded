import { NextRequest, NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"
import { createDb, registrationInvites } from "@vortex/db"
import { requireAuth, parseJsonBody, checkRateLimit } from "@/lib/utils/api-helpers"
import { generateInviteCode } from "@/lib/auth/invites"
import { toSnakeCase } from "@/lib/utils/case"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/invites")
const db = createDb()

const MAX_USES_CAP = 50
const MAX_EXPIRES_DAYS = 365
const CODE_GENERATION_RETRIES = 5

type CreateInviteBody = { maxUses?: unknown; expiresInDays?: unknown }

// GET /api/invites — list invites created by the current user
export async function GET() {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    let rows: Array<typeof registrationInvites.$inferSelect>
    try {
      rows = await db
        .select()
        .from(registrationInvites)
        .where(eq(registrationInvites.createdBy, user.id))
        .orderBy(desc(registrationInvites.createdAt))
        .limit(100)
    } catch {
      return NextResponse.json({ error: "Failed to fetch invites" }, { status: 500 })
    }

    return NextResponse.json({ invites: toSnakeCase(rows) })
  } catch (err) {
    log.error({ route: "/api/invites", action: "GET", error: err instanceof Error ? err.message : String(err) }, "GET error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/invites — mint a new invite code (issue #3: invite-gated registration)
export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const limited = await checkRateLimit(user.id, "invites:create", { limit: 20, windowMs: 3600_000 })
    if (limited) return limited

    const { data: body, error: parseError } = await parseJsonBody<CreateInviteBody>(req)
    if (parseError) return parseError

    const maxUses = body.maxUses === undefined ? 1 : body.maxUses
    if (typeof maxUses !== "number" || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_USES_CAP) {
      return NextResponse.json({ error: `maxUses must be an integer between 1 and ${MAX_USES_CAP}` }, { status: 400 })
    }

    let expiresAt: string | null = null
    if (body.expiresInDays !== undefined) {
      const days = body.expiresInDays
      if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_EXPIRES_DAYS) {
        return NextResponse.json({ error: `expiresInDays must be an integer between 1 and ${MAX_EXPIRES_DAYS}` }, { status: 400 })
      }
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    }

    let created: typeof registrationInvites.$inferSelect | null = null
    for (let attempt = 0; attempt < CODE_GENERATION_RETRIES && !created; attempt++) {
      try {
        const [row] = await db
          .insert(registrationInvites)
          .values({ code: generateInviteCode(), createdBy: user.id, maxUses, expiresAt })
          .returning()
        created = row ?? null
      } catch (err) {
        // Unique constraint collision on `code` — vanishingly unlikely
        // (8 chars from a 32-symbol alphabet) but retry rather than fail.
        const message = err instanceof Error ? err.message : String(err)
        if (!message.includes("UNIQUE") || attempt === CODE_GENERATION_RETRIES - 1) {
          log.error({ route: "/api/invites", action: "POST", userId: user.id, error: message }, "failed to create invite")
          return NextResponse.json({ error: "Failed to create invite" }, { status: 500 })
        }
      }
    }

    if (!created) return NextResponse.json({ error: "Failed to create invite" }, { status: 500 })

    return NextResponse.json({ invite: toSnakeCase(created) }, { status: 201 })
  } catch (err) {
    log.error({ route: "/api/invites", action: "POST", error: err instanceof Error ? err.message : String(err) }, "POST error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
