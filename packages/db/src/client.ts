import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { resolveDbPath } from "./db-path"
import * as schema from "./schema"

export function createDb(path: string = resolveDbPath()) {
  const sqlite = new Database(path)

  // Required for every FK-cascading table in this schema (SQLite has FK
  // enforcement off by default, per-connection) and for the device-key-cap
  // / reply-same-channel / activity-log-prune triggers in
  // src/sql/fts5-and-triggers.sql, several of which assume ON DELETE CASCADE
  // actually cascades.
  sqlite.pragma("foreign_keys = ON")
  // Set before the WAL switch below so the busy handler is already active if
  // another connection holds a lock during the switch itself, not just for
  // later statements.
  sqlite.pragma("busy_timeout = 5000")
  // WAL lets `apps/web` and `apps/signal` hold the same on-disk file open
  // concurrently (the deployment's bind-mounted SQLite file, shared between
  // both processes) without readers blocking on a writer.
  sqlite.pragma("journal_mode = WAL")

  return drizzle(sqlite, { schema })
}

export type VortexDb = ReturnType<typeof createDb>
