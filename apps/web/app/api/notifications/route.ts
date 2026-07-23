import { NextRequest, NextResponse, after } from "next/server"
import { and, count, desc, eq, inArray } from "drizzle-orm"
import { createDb, notifications } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { publishGatewayEvent } from "@/lib/gateway-publish"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()

const NOTIFICATION_COLUMNS = {
  id: notifications.id,
  type: notifications.type,
  title: notifications.title,
  body: notifications.body,
  iconUrl: notifications.iconUrl,
  serverId: notifications.serverId,
  channelId: notifications.channelId,
  messageId: notifications.messageId,
  read: notifications.read,
  createdAt: notifications.createdAt,
}

// GET /api/notifications — fetch notifications for the current user
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const limitParam = searchParams.get("limit")
    const parsed = limitParam ? Number(limitParam) : NaN
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(1, parsed), 100) : 30

    const countOnly = searchParams.get("countOnly") === "true"
    if (countOnly) {
      const [row] = await db
        .select({ value: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, user.id), eq(notifications.read, false)))
      return NextResponse.json({ unreadCount: row?.value ?? 0 })
    }

    const rows = await db
      .select(NOTIFICATION_COLUMNS)
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)

    return NextResponse.json({ notifications: toSnakeCase(rows) })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PATCH /api/notifications — mark notifications as read
// Body: { id?: string } — if id is provided mark that one; otherwise mark all unread as read
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json() as Record<string, unknown>
    const { id } = body

    if (id !== undefined && (typeof id !== "string" || id.trim() === "")) {
      return NextResponse.json({ error: "id must be a non-empty string" }, { status: 400 })
    }

    const trimmedId = typeof id === "string" ? id.trim() : undefined
    const conditions = [eq(notifications.userId, user.id), eq(notifications.read, false)]
    if (trimmedId) {
      conditions.push(eq(notifications.id, trimmedId))
    }

    const updated = await db
      .update(notifications)
      .set({ read: true })
      .where(and(...conditions))
      .returning(NOTIFICATION_COLUMNS)

    if (updated.length > 0) {
      const snakeUpdated = toSnakeCase<Record<string, unknown>[]>(updated)
      after(() => Promise.all(snakeUpdated.map((n) => publishGatewayEvent({
        type: "notification.updated",
        channelId: `user:${user.id}`,
        actorId: user.id,
        data: n,
      }, { route: "/api/notifications" }))))
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/notifications — dismiss notifications
// Body: { id?: string, ids?: string[] }
// - id: delete a single notification
// - ids: delete specific notifications by ID
// - neither: error (prevent accidental mass deletion)
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json() as Record<string, unknown>
    const { id, ids } = body

    if (id !== undefined && (typeof id !== "string" || id.trim() === "")) {
      return NextResponse.json({ error: "id must be a non-empty string" }, { status: 400 })
    }
    if (ids !== undefined && (!Array.isArray(ids) || !ids.every((v) => typeof v === "string"))) {
      return NextResponse.json({ error: "ids must be an array of strings" }, { status: 400 })
    }
    if (!id && !ids) {
      return NextResponse.json({ error: "id or ids required" }, { status: 400 })
    }

    const trimmedDeleteId = typeof id === "string" ? id.trim() : undefined
    const trimmedIds = Array.isArray(ids) ? ids.map((s: string) => s.trim()).filter(Boolean) : undefined

    const conditions = [eq(notifications.userId, user.id)]
    if (trimmedDeleteId) {
      conditions.push(eq(notifications.id, trimmedDeleteId))
    } else if (trimmedIds) {
      if (trimmedIds.length === 0) {
        return NextResponse.json({ error: "No valid IDs provided" }, { status: 400 })
      }
      conditions.push(inArray(notifications.id, trimmedIds))
    }

    const deleted = await db
      .delete(notifications)
      .where(and(...conditions))
      .returning({ id: notifications.id, read: notifications.read })

    if (deleted.length > 0) {
      const snakeDeleted = toSnakeCase<Record<string, unknown>[]>(deleted)
      after(() => Promise.all(snakeDeleted.map((n) => publishGatewayEvent({
        type: "notification.deleted",
        channelId: `user:${user.id}`,
        actorId: user.id,
        data: n,
      }, { route: "/api/notifications" }))))
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
