import { NextRequest, NextResponse } from "next/server"
import { and, eq, inArray } from "drizzle-orm"
import { createDb, dmChannelMembers } from "@vortex/db"
import { verifyBearerToken } from "@/lib/utils/timing-safe"

const db = createDb()

const USER_CHANNEL_PREFIX = "user:"
const MAX_CHANNELS = 100

/**
 * POST /api/internal/gateway/channel-access
 *
 * Internal endpoint the signal server calls during `gateway:subscribe` /
 * `gateway:resume` to decide which channel rooms a socket may actually join.
 * Membership is authoritative here in the web app's database, so the gateway
 * defers to this check rather than joining any requested room — without it any
 * authenticated user who obtained a channel ID could join another DM's gateway
 * room and receive its live `message.created` events (issue #51).
 *
 * Protected by the shared SIGNAL_REVOKE_SECRET — the same secret the web app
 * already uses to authenticate its own calls to the signal server, just in the
 * reverse direction.
 *
 * Body:     { userId: string, channelIds: string[] }
 * Response: { allowed: string[] }  // the subset of channelIds the user may join
 *
 * Access rules:
 *   - `user:{id}` synthetic channels: allowed only when id === userId.
 *   - DM/group channels: allowed only when the user has a dm_channel_members
 *     row for that channel.
 *   - anything else: denied (omitted from `allowed`).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const secret = process.env.SIGNAL_REVOKE_SECRET
    if (!secret) {
      return NextResponse.json({ error: "SIGNAL_REVOKE_SECRET not configured" }, { status: 503 })
    }
    if (!verifyBearerToken(req.headers.get("authorization"), secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body: unknown = await req.json().catch(() => null)
    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    const { userId, channelIds } = body as { userId?: unknown; channelIds?: unknown }
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 })
    }
    if (!Array.isArray(channelIds)) {
      return NextResponse.json({ error: "channelIds must be an array" }, { status: 400 })
    }
    if (channelIds.length > MAX_CHANNELS) {
      return NextResponse.json(
        { error: `Cannot check more than ${MAX_CHANNELS} channels at once` },
        { status: 400 }
      )
    }

    const requested = channelIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0
    )

    const allowed: string[] = []
    const dmChannelIds: string[] = []

    for (const id of requested) {
      if (id.startsWith(USER_CHANNEL_PREFIX)) {
        // Synthetic per-user channel — only the owning user may join it.
        if (id.slice(USER_CHANNEL_PREFIX.length) === userId) allowed.push(id)
      } else {
        dmChannelIds.push(id)
      }
    }

    if (dmChannelIds.length > 0) {
      const rows = await db
        .select({ dmChannelId: dmChannelMembers.dmChannelId })
        .from(dmChannelMembers)
        .where(
          and(
            eq(dmChannelMembers.userId, userId),
            inArray(dmChannelMembers.dmChannelId, dmChannelIds)
          )
        )
      const memberOf = new Set(rows.map((r) => r.dmChannelId))
      for (const id of dmChannelIds) {
        if (memberOf.has(id)) allowed.push(id)
      }
    }

    return NextResponse.json({ allowed })
  } catch (err) {
    console.error("[internal/gateway/channel-access POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
