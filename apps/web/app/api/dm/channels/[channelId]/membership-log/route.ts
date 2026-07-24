import { NextResponse } from "next/server"
import { and, desc, eq, inArray, lt, or } from "drizzle-orm"
import { createDb, dmChannelMembers, dmMembershipEvents, users } from "@vortex/db"
import { requireAuth } from "@/lib/utils/api-helpers"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()
const LOG_LIMIT = 100

/**
 * GET /api/dm/channels/[channelId]/membership-log — Issue #40's "visible,
 * signed membership/admin-change logs". Only current members can see a
 * channel's log (same bar as reading its messages); membership is checked
 * against `dm_channel_members` regardless of whether the caller was already
 * a member when a given entry was written, since the log is about the
 * channel's history, not the reader's.
 *
 * Every entry carries `payload`/`signature`/`actor_ed25519_key` as written —
 * the client, not this route, is responsible for calling
 * verifyEd25519Signature (see olm-protocol.ts) to render the "signed &
 * verified" badge. This route deliberately does not verify signatures
 * itself: Olm never loads server-side anywhere else in this codebase (the
 * server is untrusted for authenticity, only relied on to store and return
 * what it was given — see olm-protocol.ts's top comment), and verifying
 * here would just be a second copy of trust the client already has to do.
 *
 * `?before=<entryId>` pages through history older than LOG_LIMIT: pass the
 * `id` of the oldest entry from the previous page to fetch the next one.
 * Ordering is `(created_at desc, id desc)` rather than `created_at` alone —
 * several entries can share an identical millisecond timestamp (e.g. a
 * group's founding members, all recorded in one batch — see
 * apps/web/app/api/dm/channels/route.ts), and cursoring on `created_at`
 * alone could skip or repeat rows within such a batch. Omitting `before`
 * (the existing behavior) returns the newest page exactly as before.
 */
export async function GET(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const { channelId } = await params
    const beforeId = new URL(req.url).searchParams.get("before")

    const [membership] = await db
      .select({ userId: dmChannelMembers.userId })
      .from(dmChannelMembers)
      .where(and(eq(dmChannelMembers.dmChannelId, channelId), eq(dmChannelMembers.userId, user.id)))
      .limit(1)
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    let cursor: { createdAt: string; id: string } | null = null
    if (beforeId) {
      const [cursorRow] = await db
        .select({ createdAt: dmMembershipEvents.createdAt, id: dmMembershipEvents.id })
        .from(dmMembershipEvents)
        .where(and(eq(dmMembershipEvents.id, beforeId), eq(dmMembershipEvents.dmChannelId, channelId)))
        .limit(1)
      // An unknown/foreign cursor is ignored rather than erroring — falls
      // back to the first page, same as omitting `before` entirely.
      cursor = cursorRow ?? null
    }

    const entries = await db
      .select({
        id: dmMembershipEvents.id,
        action: dmMembershipEvents.action,
        actorId: dmMembershipEvents.actorId,
        targetId: dmMembershipEvents.targetId,
        actorDeviceId: dmMembershipEvents.actorDeviceId,
        actorEd25519Key: dmMembershipEvents.actorEd25519Key,
        payload: dmMembershipEvents.payload,
        signature: dmMembershipEvents.signature,
        createdAt: dmMembershipEvents.createdAt,
      })
      .from(dmMembershipEvents)
      .where(
        cursor
          ? and(
              eq(dmMembershipEvents.dmChannelId, channelId),
              or(
                lt(dmMembershipEvents.createdAt, cursor.createdAt),
                and(eq(dmMembershipEvents.createdAt, cursor.createdAt), lt(dmMembershipEvents.id, cursor.id))
              )
            )
          : eq(dmMembershipEvents.dmChannelId, channelId)
      )
      .orderBy(desc(dmMembershipEvents.createdAt), desc(dmMembershipEvents.id))
      .limit(LOG_LIMIT)

    const personIds = [...new Set(entries.flatMap((e) => [e.actorId, e.targetId]).filter((id): id is string => !!id))]
    const people = personIds.length
      ? await db
          .select({ id: users.id, displayName: users.displayName, username: users.username, avatarUrl: users.avatarUrl })
          .from(users)
          .where(inArray(users.id, personIds))
      : []
    const peopleById = Object.fromEntries(people.map((p) => [p.id, p]))
    const lastEntry = entries[entries.length - 1]

    return NextResponse.json({
      entries: toSnakeCase(entries.map((e) => ({
        ...e,
        actor: e.actorId ? peopleById[e.actorId] ?? null : null,
        target: e.targetId ? peopleById[e.targetId] ?? null : null,
      }))),
      next_cursor: entries.length === LOG_LIMIT && lastEntry ? lastEntry.id : null,
    })
  } catch (err) {
    console.error("[dm/channels/[channelId]/membership-log GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
