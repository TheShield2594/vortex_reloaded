import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { createDb, directMessages } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()

// PATCH /api/dm/channels/[channelId]/messages/[messageId] — edit a DM message
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> }
) {
  try {
    const { channelId, messageId } = await params
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json()
    const content = body?.content
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Content required" }, { status: 400 })
    }

    let data: typeof directMessages.$inferSelect | undefined
    try {
      const rows = await db
        .update(directMessages)
        .set({ content: content.trim(), editedAt: new Date().toISOString() })
        .where(
          and(
            eq(directMessages.id, messageId),
            eq(directMessages.senderId, user.id),
            eq(directMessages.dmChannelId, channelId)
          )
        )
        .returning()
      data = rows[0]
    } catch {
      return NextResponse.json({ error: "Message not found or not editable" }, { status: 404 })
    }

    if (!data) return NextResponse.json({ error: "Message not found or not editable" }, { status: 404 })

    return NextResponse.json(toSnakeCase(data))
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/dm/channels/[channelId]/messages/[messageId] — soft-delete a DM message
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> }
) {
  try {
    const { channelId, messageId } = await params
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let data: { id: string } | undefined
    try {
      const rows = await db
        .update(directMessages)
        .set({ deletedAt: new Date().toISOString(), content: null })
        .where(
          and(
            eq(directMessages.id, messageId),
            eq(directMessages.senderId, user.id),
            eq(directMessages.dmChannelId, channelId)
          )
        )
        .returning({ id: directMessages.id })
      data = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to delete message" }, { status: 500 })
    }

    if (!data) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
