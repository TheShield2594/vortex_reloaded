import { NextRequest, NextResponse } from "next/server"
import { and, eq, isNull } from "drizzle-orm"
import { createDb, registrationInvites } from "@vortex/db"
import { requireAuth } from "@/lib/utils/api-helpers"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/invites/[id]")
const db = createDb()

// DELETE /api/invites/[id] — revoke an invite code (creator only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const { id } = await params

    let updated: Array<{ id: string }>
    try {
      updated = await db
        .update(registrationInvites)
        .set({ revokedAt: new Date().toISOString() })
        .where(
          and(
            eq(registrationInvites.id, id),
            eq(registrationInvites.createdBy, user.id),
            isNull(registrationInvites.revokedAt)
          )
        )
        .returning({ id: registrationInvites.id })
    } catch (err) {
      log.error({ route: "/api/invites/[id]", action: "DELETE", userId: user.id, inviteId: id, error: err instanceof Error ? err.message : String(err) }, "failed to revoke invite")
      return NextResponse.json({ error: "Failed to revoke invite" }, { status: 500 })
    }

    if (updated.length === 0) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error({ route: "/api/invites/[id]", action: "DELETE", error: err instanceof Error ? err.message : String(err) }, "DELETE error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
