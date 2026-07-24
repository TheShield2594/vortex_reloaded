import { sql } from "drizzle-orm"
import { check, index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { createdAt, uuidPk } from "./columns"
import { dmChannels } from "./dm"
import { users } from "./users"

/**
 * Issue #40 ("Group trust model") — an append-only, client-signed log of
 * group-membership changes ("who added whom, when"), visible to members
 * instead of only being an internal implementation detail (Signal tracks
 * this but never surfaces it).
 *
 * Signing happens client-side with the actor's Olm device identity
 * (ed25519, see apps/web/lib/olm-protocol.ts) over a canonical payload of
 * `{channelId, action, actorId, targetId}` — the server never holds any
 * private key material and cannot forge entries, only append what a client
 * hands it. `actorEd25519Key` snapshots the signing device's public key at
 * write time (rather than joining `olm_device_identities` live) so a
 * verifier can still check old entries after that device is removed or its
 * keys rotate. `signature`/`actorDeviceId`/`actorEd25519Key` are nullable
 * because a caller with no local Olm identity yet (or a legacy/never-set-up
 * device) can still perform the action — such rows simply render as
 * "unsigned" in the log instead of being rejected, matching this app's
 * broader stance of degrading gracefully rather than blocking on E2EE setup.
 *
 * `created_at` is server-assigned insert time, not part of the signed
 * payload — binding a signature to a client-claimed timestamp would require
 * the server to trust that clock or the client to match the server's insert
 * time exactly, neither of which this table needs: the signature's job is
 * only to prove *who* attested to the action, ordering/"when" comes from
 * the log's own append order.
 */
export const dmMembershipEvents = sqliteTable(
  "dm_membership_events",
  {
    id: uuidPk(),
    dmChannelId: text("dm_channel_id")
      .notNull()
      .references(() => dmChannels.id, { onDelete: "cascade" }),
    action: text("action", { enum: ["member_added", "member_removed", "member_left"] }).notNull(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    targetId: text("target_id").references(() => users.id, { onDelete: "set null" }),
    actorDeviceId: text("actor_device_id"),
    actorEd25519Key: text("actor_ed25519_key"),
    /** The exact JSON string the signature was computed over — see canonicalMembershipEventPayload. */
    payload: text("payload").notNull(),
    signature: text("signature"),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_dm_membership_events_channel_created").on(table.dmChannelId, table.createdAt),
    check(
      "dm_membership_events_action_check",
      sql`${table.action} in ('member_added', 'member_removed', 'member_left')`
    ),
  ]
)

/**
 * Issue #40 — records that `userId` compared and confirmed a safety number
 * with `otherUserId` at a point in time, plus the fingerprint it verified
 * against. Re-derived on read (see apps/web/lib/safety-number.ts) and
 * compared to `safetyNumberFingerprint`: a mismatch means one side's
 * identity key material changed since the last verification (device reset,
 * reinstall, or a substitution attempt), which the UI surfaces the same way
 * Signal's "safety number changed" warning does, instead of silently
 * carrying the stale "verified" state forward.
 *
 * One-directional by design (`userId` verified `otherUserId`, not
 * necessarily the reverse) — each side confirms independently, same as
 * Signal.
 */
export const safetyNumberVerifications = sqliteTable(
  "safety_number_verifications",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    otherUserId: text("other_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    safetyNumberFingerprint: text("safety_number_fingerprint").notNull(),
    verifiedAt: createdAt("verified_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.otherUserId] })]
)
