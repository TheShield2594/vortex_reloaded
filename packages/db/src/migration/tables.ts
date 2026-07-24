/**
 * The 28 live tables authored in issue #6 (../schema), listed in FK-dependency
 * order: every table appears after every table it references. Both export.ts
 * and import.ts iterate this list in order — export because a stable,
 * predictable table order makes a partial/resumed export easier to reason
 * about, import because SQLite has `PRAGMA foreign_keys = ON` (see
 * ../client.ts) and will reject a child row inserted before its parent.
 *
 * `orderBy` drives the Postgres `ORDER BY` clause in export.ts (a
 * deterministic row order, not a correctness requirement — see import.ts's
 * module comment for why FK-triggered side effects aren't a concern here).
 */

export interface TableSpec {
  /** Table name — identical in Postgres (public schema) and SQLite. */
  name: string
  /** Column(s) to ORDER BY during export, for deterministic pagination. */
  orderBy: string[]
}

export const MIGRATION_TABLES: TableSpec[] = [
  { name: "users", orderBy: ["id"] },
  { name: "badge_definitions", orderBy: ["id"] },
  { name: "dm_channels", orderBy: ["id"] },
  { name: "friendships", orderBy: ["id"] },
  { name: "notifications", orderBy: ["id"] },
  { name: "user_notification_preferences", orderBy: ["user_id"] },
  { name: "push_subscriptions", orderBy: ["id"] },
  { name: "user_pinned_items", orderBy: ["id"] },
  { name: "user_activity_log", orderBy: ["id"] },
  { name: "user_connections", orderBy: ["id"] },
  { name: "user_badges", orderBy: ["id"] },
  { name: "reports", orderBy: ["id"] },
  { name: "attachments", orderBy: ["id"] },
  { name: "auth_security_policies", orderBy: ["user_id"] },
  { name: "login_risk_events", orderBy: ["id"] },
  { name: "login_attempts", orderBy: ["id"] },
  { name: "dm_channel_members", orderBy: ["dm_channel_id", "user_id"] },
  // Chronological order isn't required for correctness (see import.ts), but
  // keeps the NDJSON dump readable and makes reply_to_id issues easy to spot.
  { name: "direct_messages", orderBy: ["created_at", "id"] },
  { name: "dm_read_states", orderBy: ["user_id", "dm_channel_id"] },
  { name: "dm_reactions", orderBy: ["dm_id", "user_id", "emoji"] },
  { name: "dm_attachments", orderBy: ["id"] },
]

export function requireTable(name: string): TableSpec {
  const table = MIGRATION_TABLES.find((t) => t.name === name)
  if (!table) throw new Error(`Unknown migration table: ${name}`)
  return table
}
