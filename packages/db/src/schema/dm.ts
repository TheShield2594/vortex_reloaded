import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core"
import { createdAt, updatedAt, uuidPk } from "./columns"
import { users } from "./users"

/**
 * supabase/migrations/00009_group_dms.sql, 00030_dm_e2ee.sql, 00105_dm_channel_theme.sql.
 * `updated_at` auto-touches on any Drizzle-issued UPDATE (renames, theme
 * changes, ...) *and* is bumped directly by the `dm_message_bump_trigger`
 * and `dm_rotate_on_member_change` triggers (see src/sql/) for writes that
 * happen on other tables — see those triggers for the two write paths
 * that don't go through a `dm_channels` UPDATE.
 */
export const dmChannels = sqliteTable(
  "dm_channels",
  {
    id: uuidPk(),
    name: text("name"),
    iconUrl: text("icon_url"),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    isGroup: integer("is_group", { mode: "boolean" }).notNull().default(false),
    isEncrypted: integer("is_encrypted", { mode: "boolean" }).notNull().default(false),
    encryptionKeyVersion: integer("encryption_key_version").notNull().default(1),
    encryptionMembershipEpoch: integer("encryption_membership_epoch").notNull().default(0),
    /**
     * Which E2EE scheme this channel's `directMessages.content` envelopes
     * use. Every encrypted channel now uses "olm" (Matrix.org's Double
     * Ratchet implementation — see apps/web/app/api/dm/channels/route.ts).
     * "legacy-ecdh" (a retired static per-device ECDH+AES-GCM wrap) only
     * lingers on channels created before the Olm migration; its client code
     * has since been removed, so those channels' history is no longer
     * decryptable and the value is retained for historical record only.
     */
    encryptionScheme: text("encryption_scheme", { enum: ["legacy-ecdh", "olm"] })
      .notNull()
      .default("legacy-ecdh"),
    themePreset: text("theme_preset", {
      enum: [
        "twilight",
        "midnight-neon",
        "synthwave",
        "carbon",
        "oled-black",
        "frost",
        "clarity",
        "velvet-dusk",
        "terminal",
        "sakura-blossom",
        "frosthearth",
        "night-city-neural",
      ],
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("dm_channels_updated_idx").on(table.updatedAt),
    check(
      "dm_channels_theme_preset_check",
      sql`${table.themePreset} is null or ${table.themePreset} in (
        'twilight', 'midnight-neon', 'synthwave', 'carbon', 'oled-black',
        'frost', 'clarity', 'velvet-dusk', 'terminal', 'sakura-blossom',
        'frosthearth', 'night-city-neural'
      )`
    ),
    check(
      "dm_channels_encryption_scheme_check",
      sql`${table.encryptionScheme} in ('legacy-ecdh', 'olm')`
    ),
  ]
)

/**
 * supabase/migrations/00001_initial_schema.sql, 00009_group_dms.sql,
 * 00038_dm_reply_to.sql, 00089_dm_full_text_search.sql.
 *
 * `search_vector` (Postgres tsvector + GIN index + trigger) is dropped
 * entirely per the migration plan's TSVECTOR mapping — replaced by the
 * `direct_messages_fts` FTS5 virtual table in src/sql/, not a column here.
 *
 * The two overlapping Postgres indexes on `(dm_channel_id, created_at)`
 * (00095's `idx_direct_messages_dm_channel_id_created` and 00100's superset
 * `idx_direct_messages_channel_created_deleted`, which also covers
 * `deleted_at`) are consolidated to the superset only.
 */
export const directMessages = sqliteTable(
  "direct_messages",
  {
    id: uuidPk(),
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    receiverId: text("receiver_id").references(() => users.id, { onDelete: "cascade" }),
    content: text("content"),
    readAt: text("read_at"),
    editedAt: text("edited_at"),
    deletedAt: text("deleted_at"),
    dmChannelId: text("dm_channel_id").references(() => dmChannels.id, { onDelete: "cascade" }),
    replyToId: text("reply_to_id").references((): AnySQLiteColumn => directMessages.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_direct_messages_sender_receiver").on(table.senderId, table.receiverId),
    index("idx_direct_messages_created_at").on(table.createdAt),
    index("idx_direct_messages_reply_to_id")
      .on(table.replyToId)
      .where(sql`${table.replyToId} is not null`),
    index("idx_direct_messages_channel_created_deleted").on(
      table.dmChannelId,
      table.createdAt,
      table.deletedAt
    ),
  ]
)

/** supabase/migrations/00009_group_dms.sql. No later migration touches this table. */
export const dmChannelMembers = sqliteTable(
  "dm_channel_members",
  {
    dmChannelId: text("dm_channel_id")
      .notNull()
      .references(() => dmChannels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
    addedAt: createdAt("added_at"),
  },
  (table) => [
    primaryKey({ columns: [table.dmChannelId, table.userId] }),
    index("dm_channel_members_user_idx").on(table.userId),
    index("idx_dm_channel_members_dm_channel_id").on(table.dmChannelId),
  ]
)

/** supabase/migrations/00009_group_dms.sql. No later migration touches this table. */
export const dmReadStates = sqliteTable(
  "dm_read_states",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dmChannelId: text("dm_channel_id")
      .notNull()
      .references(() => dmChannels.id, { onDelete: "cascade" }),
    lastReadAt: createdAt("last_read_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.dmChannelId] })]
)

/** supabase/migrations/00082_dm_reactions.sql. Composite PK, no surrogate id. */
export const dmReactions = sqliteTable(
  "dm_reactions",
  {
    dmId: text("dm_id")
      .notNull()
      .references(() => directMessages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.dmId, table.userId, table.emoji] }),
    index("idx_dm_reactions_dm_id").on(table.dmId),
  ]
)

/** supabase/migrations/00001_initial_schema.sql, 00081_attachment_decay.sql. */
export const dmAttachments = sqliteTable(
  "dm_attachments",
  {
    id: uuidPk(),
    dmId: text("dm_id")
      .notNull()
      .references(() => directMessages.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    filename: text("filename").notNull(),
    size: integer("size").notNull(),
    contentType: text("content_type").notNull(),
    createdAt: createdAt(),
    expiresAt: text("expires_at"),
    lastAccessedAt: text("last_accessed_at"),
    purgedAt: text("purged_at"),
    lifetimeDays: integer("lifetime_days"),
    decayCost: real("decay_cost"),
  },
  (table) => [
    index("idx_dm_attachments_decay_expiry")
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} is not null and ${table.purgedAt} is null`),
  ]
)

/**
 * Olm (Matrix.org's Double Ratchet implementation — not Signal's own
 * codebase/protocol, see issue #1's discussion) device identity — one row
 * per (user, device). `curve25519IdentityKey`/`ed25519IdentityKey` come
 * straight from `Olm.Account.identity_keys()`; `fallback*` is the device's
 * current Olm fallback key (functions like Signal's signed prekey — a
 * long-lived key used to establish a session once one-time keys are
 * exhausted). Both the fallback key and every one-time key in
 * `olmOneTimeKeys` are signed with the device's ed25519 identity key
 * (`Olm.Account.sign`) so a session initiator can verify authenticity
 * independent of server trust — see apps/web/lib/olm-protocol.ts's
 * `signBundle`/`verifyBundleSignature`.
 */
export const olmDeviceIdentities = sqliteTable(
  "olm_device_identities",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    curve25519IdentityKey: text("curve25519_identity_key").notNull(),
    ed25519IdentityKey: text("ed25519_identity_key").notNull(),
    fallbackKeyId: text("fallback_key_id").notNull(),
    fallbackPublicKey: text("fallback_public_key").notNull(),
    fallbackSignature: text("fallback_signature").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.deviceId] })]
)

/**
 * One-time prekeys for X3DH-style Olm session establishment. Each row is
 * claimed at most once via apps/web/app/api/dm/olm/keys/claim/route.ts's
 * atomic select-then-mark-consumed — reusing an Olm one-time key breaks the
 * forward-secrecy guarantee it exists to provide.
 *
 * Claiming sets `consumedAt` rather than deleting the row. A hard delete
 * would free up the (userId, deviceId, keyId) primary key slot, and
 * apps/web/app/api/dm/olm/keys/device/route.ts's publish endpoint inserts
 * with `onConflictDoNothing()` — so a replayed/duplicate publish request
 * carrying an already-claimed keyId would silently resurrect it as
 * claimable again. Leaving a consumed tombstone in place keeps that primary
 * key permanently occupied, so the conflict (and no-op) always wins instead.
 */
export const olmOneTimeKeys = sqliteTable(
  "olm_one_time_keys",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    keyId: text("key_id").notNull(),
    publicKey: text("public_key").notNull(),
    signature: text("signature").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.deviceId, table.keyId] }),
    index("olm_one_time_keys_claim_idx").on(table.userId, table.deviceId, table.consumedAt, table.createdAt),
  ]
)

