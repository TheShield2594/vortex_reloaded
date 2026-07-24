import { NextRequest, NextResponse, after } from "next/server"
import { and, eq } from "drizzle-orm"
import { createDb, dmChannelMembers, dmChannels } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { publishGatewayEvent, revokeGatewayChannelAccess } from "@/lib/gateway-publish"
import { nudgeSafetyNumberVerification, recordMembershipEvent, type MembershipClientSignature } from "@/lib/membership-log"

/** Trims to Olm ed25519 signature/device-id-shaped strings; anything else is treated as "no signature supplied". */
function parseClientSignature(deviceId: unknown, signature: unknown): MembershipClientSignature {
  if (typeof deviceId !== "string" || typeof signature !== "string") return null
  if (!deviceId || !signature || deviceId.length > 128 || signature.length > 256) return null
  return { deviceId, signature }
}

const db = createDb()

// POST /api/dm/channels/[channelId]/members — add a member to a group DM
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Verify caller membership and channel type in parallel
    const [membershipRows, channelRows] = await Promise.all([
      db
        .select({ userId: dmChannelMembers.userId })
        .from(dmChannelMembers)
        .where(and(eq(dmChannelMembers.dmChannelId, channelId), eq(dmChannelMembers.userId, user.id)))
        .limit(1),
      db.select({ isGroup: dmChannels.isGroup }).from(dmChannels).where(eq(dmChannels.id, channelId)).limit(1),
    ])
    const membership = membershipRows[0]
    const channel = channelRows[0]

    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    if (!channel?.isGroup) {
      return NextResponse.json({ error: "Cannot add members to a 1:1 DM" }, { status: 400 })
    }

    const { userId, deviceId, signature } = await req.json()
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 })
    const clientSignature = parseClientSignature(deviceId, signature)

    try {
      await db.insert(dmChannelMembers).values({ dmChannelId: channelId, userId, addedBy: user.id })
    } catch (insertError) {
      if (insertError instanceof Error && /UNIQUE constraint failed/.test(insertError.message)) {
        return NextResponse.json({ error: "Already a member" }, { status: 409 })
      }
      return NextResponse.json({ error: "Failed to add member" }, { status: 500 })
    }

    // Issue #40: append a signed log entry for "who added whom, when" and
    // nudge both sides to verify safety numbers — best-effort, after the
    // response, since neither should block or fail the membership change
    // itself.
    after(() =>
      recordMembershipEvent({
        dmChannelId: channelId,
        action: "member_added",
        actorId: user.id,
        targetId: userId,
        clientSignature,
      }).catch((err) => console.error("[dm/channels/[channelId]/members POST] membership log failed:", err))
    )
    after(() =>
      nudgeSafetyNumberVerification({ dmChannelId: channelId, actorId: user.id, targetId: userId }).catch((err) =>
        console.error("[dm/channels/[channelId]/members POST] verify nudge failed:", err)
      )
    )

    // Existing members (already subscribed to this channel) see the join;
    // the new member isn't in the channel's gateway room yet, so notify them
    // directly via their per-user channel so their DM list picks it up.
    after(() => publishGatewayEvent({
      type: "member.joined",
      channelId,
      actorId: user.id,
      data: { channelId, userId },
    }, { route: "/api/dm/channels/[channelId]/members" }))
    after(() => publishGatewayEvent({
      type: "member.joined",
      channelId: `user:${userId}`,
      actorId: user.id,
      data: { channelId },
    }, { route: "/api/dm/channels/[channelId]/members" }))

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[dm/channels/[channelId]/members POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/dm/channels/[channelId]/members?userId=... — remove a member (or leave)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const targetUserId = searchParams.get("userId") ?? user.id
    const clientSignature = parseClientSignature(searchParams.get("deviceId"), searchParams.get("signature"))

    // Only owners can remove others; anyone can remove themselves
    if (targetUserId !== user.id) {
      const [channel] = await db
        .select({ ownerId: dmChannels.ownerId })
        .from(dmChannels)
        .where(eq(dmChannels.id, channelId))
        .limit(1)

      if (channel?.ownerId !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    try {
      await db
        .delete(dmChannelMembers)
        .where(and(eq(dmChannelMembers.dmChannelId, channelId), eq(dmChannelMembers.userId, targetUserId)))
    } catch {
      return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })
    }

    // Revoke the removed member's live gateway room membership before
    // announcing the departure — otherwise a still-connected socket (this
    // channel's DM list / notification-sound subscriptions are sticky, see
    // dm-list.tsx) would keep receiving this channel's message/reaction
    // events until it happens to reconnect and gateway:subscribe's
    // checkChannelAccess re-checks membership.
    await revokeGatewayChannelAccess(targetUserId, channelId)

    // Issue #40: append a signed "left"/"removed" log entry — see the POST
    // handler above for why this is best-effort and deferred past the
    // response.
    after(() =>
      recordMembershipEvent({
        dmChannelId: channelId,
        action: targetUserId === user.id ? "member_left" : "member_removed",
        actorId: user.id,
        targetId: targetUserId,
        clientSignature,
      }).catch((err) => console.error("[dm/channels/[channelId]/members DELETE] membership log failed:", err))
    )

    // Remaining members (subscribed to this channel) see the departure; the
    // removed member is notified via their per-user channel so their DM
    // list drops the channel.
    after(() => publishGatewayEvent({
      type: "member.left",
      channelId,
      actorId: user.id,
      data: { channelId, userId: targetUserId },
    }, { route: "/api/dm/channels/[channelId]/members" }))
    after(() => publishGatewayEvent({
      type: "member.left",
      channelId: `user:${targetUserId}`,
      actorId: user.id,
      data: { channelId },
    }, { route: "/api/dm/channels/[channelId]/members" }))

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[dm/channels/[channelId]/members DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
