/**
 * Issue #40 ("Group trust model") — appends signed group-membership-change
 * entries (see packages/db/src/schema/trust.ts) and fires the automated
 * safety-number verification nudge that accompanies a new member joining.
 * Shared by the add/remove-member route so both write paths log through the
 * same place instead of duplicating the insert/lookup logic.
 */
import { randomUUID } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { createDb, dmMembershipEvents, notifications, olmDeviceIdentities, users } from "@vortex/db"
import { canonicalMembershipEventPayload } from "@/lib/olm-protocol"
import { publishGatewayEvent } from "@/lib/gateway-publish"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()

export type MembershipAction = "member_added" | "member_removed" | "member_left"

export type MembershipClientSignature = { deviceId: string; signature: string; eventId: string; timestamp: string } | null

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Generous enough to absorb ordinary clock drift between a client and this
// server without letting a signed row's displayed time be backdated/
// postdated by anything meaningful.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

/**
 * Appends a log entry — signed if the caller's device produced a signature
 * over a device the server actually has a published identity for (and a
 * plausible eventId/timestamp), unsigned otherwise. The canonical payload
 * is always rebuilt from the actorId/targetId/action this call was given,
 * never trusted from the client, so a stored signature can only ever attest
 * to the action that was actually persisted. For a signed row, `id`/
 * `created_at` are the client-supplied `eventId`/`timestamp` rather than
 * server-generated ones — see trust.ts's doc comment for why: it binds the
 * signature to this specific row (a unique-constraint replay guard) and to
 * the timestamp actually displayed for it.
 */
export async function recordMembershipEvent(params: {
  dmChannelId: string
  action: MembershipAction
  actorId: string
  targetId: string
  clientSignature: MembershipClientSignature
}): Promise<void> {
  const { dmChannelId, action, actorId, targetId, clientSignature } = params

  let actorDeviceId: string | null = null
  let actorEd25519Key: string | null = null
  let signature: string | null = null
  let eventId: string = randomUUID()
  let timestamp: string = new Date().toISOString()

  if (clientSignature) {
    const [device] = await db
      .select({ ed25519IdentityKey: olmDeviceIdentities.ed25519IdentityKey })
      .from(olmDeviceIdentities)
      .where(
        and(
          eq(olmDeviceIdentities.userId, actorId),
          eq(olmDeviceIdentities.deviceId, clientSignature.deviceId)
        )
      )
      .limit(1)

    const claimedMs = Date.parse(clientSignature.timestamp)
    const withinClockSkew = Number.isFinite(claimedMs) && Math.abs(claimedMs - Date.now()) <= MAX_CLOCK_SKEW_MS
    const validEventId = UUID_RE.test(clientSignature.eventId)

    // Only persist the signature (and adopt the client's eventId/timestamp
    // as this row's id/created_at) alongside a device identity the server
    // actually has on file, a well-formed event id, and a timestamp close
    // to "now" — a signature over a deviceId with no published bundle can't
    // be verified by anyone later, and an implausible id/timestamp is
    // dropped rather than stored as if it were checkable.
    if (device && validEventId && withinClockSkew) {
      actorDeviceId = clientSignature.deviceId
      actorEd25519Key = device.ed25519IdentityKey
      signature = clientSignature.signature
      eventId = clientSignature.eventId
      timestamp = clientSignature.timestamp
    }
  }

  const payload = canonicalMembershipEventPayload(eventId, timestamp, dmChannelId, action, actorId, targetId)

  await db.insert(dmMembershipEvents).values({
    id: eventId,
    dmChannelId,
    action,
    actorId,
    targetId,
    actorDeviceId,
    actorEd25519Key,
    payload,
    signature,
    createdAt: timestamp,
  })
}

/**
 * Issue #40's "automated ... nudges instead of a buried manual QR-scan
 * flow": when a member is added to a group, prompt the adder and the new
 * member to verify safety numbers with each other — the one relationship
 * that just became newly relevant — instead of requiring either of them to
 * go looking for a verification screen on their own.
 *
 * `channelId`/`messageId` are repurposed per notifications.ts's doc
 * comment: `channelId` is the group the nudge relates to, `messageId` is
 * the other party's user id.
 */
export async function nudgeSafetyNumberVerification(params: {
  dmChannelId: string
  actorId: string
  targetId: string
}): Promise<void> {
  const { dmChannelId, actorId, targetId } = params
  if (actorId === targetId) return

  const people = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users)
    .where(inArray(users.id, [actorId, targetId]))
  const nameOf = (id: string) => {
    const person = people.find((p) => p.id === id)
    return person?.displayName || person?.username || "Someone"
  }
  const actorName = nameOf(actorId)
  const targetName = nameOf(targetId)

  const [[actorNotif], [targetNotif]] = await Promise.all([
    db
      .insert(notifications)
      .values({
        userId: actorId,
        type: "verify_prompt",
        title: `Verify safety number with ${targetName}`,
        body: "You just added them to a group — confirm you're both seeing the same safety number.",
        channelId: dmChannelId,
        messageId: targetId,
      })
      .returning(),
    db
      .insert(notifications)
      .values({
        userId: targetId,
        type: "verify_prompt",
        title: `Verify safety number with ${actorName}`,
        body: "You were just added to a group — confirm you're both seeing the same safety number.",
        channelId: dmChannelId,
        messageId: actorId,
      })
      .returning(),
  ])

  await Promise.all([
    publishGatewayEvent(
      { type: "notification.created", channelId: `user:${actorId}`, actorId, data: toSnakeCase(actorNotif) },
      { route: "/api/dm/channels/[channelId]/members" }
    ),
    publishGatewayEvent(
      { type: "notification.created", channelId: `user:${targetId}`, actorId, data: toSnakeCase(targetNotif) },
      { route: "/api/dm/channels/[channelId]/members" }
    ),
  ])
}
