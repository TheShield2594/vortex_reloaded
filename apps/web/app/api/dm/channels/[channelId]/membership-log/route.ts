import { NextResponse } from "next/server"
import { and, desc, eq, inArray } from "drizzle-orm"
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
 */
export async function GET(_req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const { channelId } = await params

    const [membership] = await db
      .select({ userId: dmChannelMembers.userId })
      .from(dmChannelMembers)
      .where(and(eq(dmChannelMembers.dmChannelId, channelId), eq(dmChannelMembers.userId, user.id)))
      .limit(1)
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

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
      .where(eq(dmMembershipEvents.dmChannelId, channelId))
      .orderBy(desc(dmMembershipEvents.createdAt))
      .limit(LOG_LIMIT)

    const personIds = [...new Set(entries.flatMap((e) => [e.actorId, e.targetId]).filter((id): id is string => !!id))]
    const people = personIds.length
      ? await db
          .select({ id: users.id, displayName: users.displayName, username: users.username, avatarUrl: users.avatarUrl })
          .from(users)
          .where(inArray(users.id, personIds))
      : []
    const peopleById = Object.fromEntries(people.map((p) => [p.id, p]))

    return NextResponse.json({
      entries: toSnakeCase(entries.map((e) => ({
        ...e,
        actor: e.actorId ? peopleById[e.actorId] ?? null : null,
        target: e.targetId ? peopleById[e.targetId] ?? null : null,
      }))),
    })
  } catch (err) {
    console.error("[dm/channels/[channelId]/membership-log GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
