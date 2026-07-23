import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { resolveDbPath } from "./db-path"
import * as schema from "./schema"
import type BetterSqlite3 from "better-sqlite3"

// better-sqlite3 is a native addon (ships a compiled .node binding, not
// pure JS). When this module is pulled into apps/web's Next.js build
// (transitively, via Better Auth's drizzle adapter), webpack tries to
// statically bundle it and its own dynamic `require()` of the binding file
// fails at runtime ("Could not locate the bindings file") — the binding
// only exists on disk relative to node_modules, not inside a webpack
// chunk. `serverExternalPackages` / webpack `externals` couldn't keep it
// out of the server bundle reliably here (it's required through a raw-
// TypeScript workspace package rather than a pre-built node_modules entry
// point, which Next's externalization heuristics don't handle). Routing
// the require through `eval` hides it from webpack's static import graph
// entirely, so Node's real, unbundled `require()` resolves it at runtime
// instead.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dynamicRequire = eval("require") as NodeRequire
const Database = dynamicRequire("better-sqlite3") as typeof BetterSqlite3

/** Synchronous sleep (better-sqlite3 itself is fully synchronous — no await available here). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function createDb(path: string = resolveDbPath()) {
  // The default path (and some deployments' bind mounts) can point at a
  // directory that hasn't been created yet — e.g. apps/web imports this
  // module (transitively, via Better Auth) at the top level of route files,
  // which Next.js evaluates during its build-time page-data collection, well
  // before any deploy step has provisioned the real data volume.
  mkdirSync(dirname(path), { recursive: true })
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
  // both processes) without readers blocking on a writer. The very first
  // switch to WAL on a given file needs a brief exclusive lock to rewrite
  // the header and create the -wal/-shm files — when several connections
  // (both processes at startup, or Next's parallel build-time page-data
  // workers, each importing this module) race to do that switch at once,
  // `busy_timeout` alone hasn't proven reliable enough to avoid a hard
  // SQLITE_BUSY here, so retry explicitly.
  for (let attempt = 0; ; attempt++) {
    try {
      sqlite.pragma("journal_mode = WAL")
      break
    } catch (err) {
      const isBusy = err instanceof Error && "code" in err && err.code === "SQLITE_BUSY"
      if (!isBusy || attempt >= 5) throw err
      sleepSync(100 * (attempt + 1))
    }
  }

  return drizzle(sqlite, { schema })
}

export type VortexDb = ReturnType<typeof createDb>
