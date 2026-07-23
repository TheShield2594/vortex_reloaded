import { writeFileSync } from "node:fs"
import path from "node:path"
import { toPortableRow, type PgRow } from "../transform"
import { tableDumpPath } from "../output-dir"

/**
 * A small "Postgres-shaped" fixture dataset — rows exactly as node-pg would
 * hand them to export.ts (Date objects for timestamptz, JS booleans, JS
 * objects/arrays for jsonb/array columns) — covering enough of the schema
 * to exercise every conversion rule in transform.ts, the FK chain
 * users -> dm_channels -> dm_channel_members -> direct_messages, a
 * self-referential reply, and FTS5-searchable content.
 */

export const USER_ALICE = "11111111-1111-1111-1111-111111111111"
export const USER_BOB = "11111111-1111-1111-1111-111111111112"
export const DM_CHANNEL = "22222222-2222-2222-2222-222222222222"
export const MESSAGE_1 = "33333333-3333-3333-3333-333333333331"
export const MESSAGE_2 = "33333333-3333-3333-3333-333333333332"

function user(id: string, username: string): PgRow {
  return {
    id,
    username,
    display_name: username[0].toUpperCase() + username.slice(1),
    avatar_url: null,
    banner_color: "#5865F2",
    banner_url: null,
    bio: null,
    custom_tag: null,
    status: "online",
    status_message: null,
    status_emoji: null,
    status_expires_at: null,
    discoverable: true,
    appearance_settings: { customCss: "" },
    interests: ["gaming", "music"],
    activity_visibility: "public",
    onboarding_completed_at: null,
    last_heartbeat_at: null,
    last_online_at: null,
    game_activity: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
  }
}

export const FIXTURE_TABLES: Record<string, PgRow[]> = {
  users: [user(USER_ALICE, "alice"), user(USER_BOB, "bob")],
  dm_channels: [
    {
      id: DM_CHANNEL,
      name: null,
      icon_url: null,
      owner_id: null,
      is_group: false,
      is_encrypted: false,
      encryption_key_version: 1,
      encryption_membership_epoch: 0,
      theme_preset: null,
      created_at: new Date("2026-01-02T00:00:00.000Z"),
      updated_at: new Date("2026-01-02T00:00:00.000Z"),
    },
  ],
  dm_channel_members: [
    { dm_channel_id: DM_CHANNEL, user_id: USER_ALICE, added_by: null, added_at: new Date("2026-01-02T00:00:00.000Z") },
    { dm_channel_id: DM_CHANNEL, user_id: USER_BOB, added_by: null, added_at: new Date("2026-01-02T00:00:00.000Z") },
  ],
  direct_messages: [
    {
      id: MESSAGE_1,
      sender_id: USER_ALICE,
      receiver_id: USER_BOB,
      content: "hello world",
      read_at: null,
      edited_at: null,
      deleted_at: null,
      dm_channel_id: DM_CHANNEL,
      reply_to_id: null,
      created_at: new Date("2026-01-03T00:00:00.000Z"),
    },
    {
      id: MESSAGE_2,
      sender_id: USER_BOB,
      receiver_id: USER_ALICE,
      content: "hi alice, replying",
      read_at: null,
      edited_at: null,
      deleted_at: null,
      dm_channel_id: DM_CHANNEL,
      reply_to_id: MESSAGE_1,
      created_at: new Date("2026-01-03T00:01:00.000Z"),
    },
  ],
  badge_definitions: [
    {
      id: "early_adopter",
      name: "Early Adopter",
      description: "",
      icon: "award",
      color: "#00e5ff",
      category: "general",
      rarity: "common",
      sort_order: 0,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    },
  ],
  user_badges: [
    {
      id: "44444444-4444-4444-4444-444444444444",
      user_id: USER_ALICE,
      badge_id: "early_adopter",
      awarded_at: new Date("2026-01-04T00:00:00.000Z"),
      awarded_by: null,
      metadata: null,
    },
  ],
}

export function writeFixtureDumps(outputDir: string): void {
  for (const [table, rows] of Object.entries(FIXTURE_TABLES)) {
    const lines = rows.map((row) => JSON.stringify(toPortableRow(row))).join("\n") + (rows.length > 0 ? "\n" : "")
    writeFileSync(path.join(outputDir, path.basename(tableDumpPath(outputDir, table))), lines)
  }
}
