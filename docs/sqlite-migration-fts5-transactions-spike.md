# Spike: FTS5 raw SQL + multi-statement transactions on better-sqlite3

Findings for [#4](https://github.com/TheShield2594/vortex_reloaded/issues/4), a
pre-migration spike blocking the full Drizzle schema authoring work (#6).
Runnable code lives in `spikes/sqlite-migration/` (standalone, not part of any
npm workspace — see that directory's `package.json`).

## Summary

Both rough edges have a working, proven pattern:

1. **FTS5 search** — an external-content `fts5` virtual table plus three
   `AFTER INSERT/UPDATE/DELETE` triggers reproduces the Postgres
   `search_vector` + GIN index + trigger pattern exactly, hand-written in raw
   SQL (confirmed: no Drizzle or Prisma schema support for this either way).
2. **Device-key race** — the literal port of `upsert_user_device_key`'s
   count-then-insert logic *is* racy under real concurrent access, reproduced
   with two worker threads hitting the same on-disk file. Two independent
   fixes close it, both usable without Drizzle's async `db.transaction()`:
   a `BEFORE INSERT` trigger that folds the cap check into the insert
   statement itself, or better-sqlite3's own synchronous
   `.transaction().immediate()` wrapper.

Recommendation for #6: use the trigger-based fix for the device-key cap (see
[below](#recommendation-for-6)).

## 1. FTS5: `direct_messages` full-text search

Script: `spikes/sqlite-migration/fts5-direct-messages.mjs`

### Postgres baseline

`supabase/migrations/00089_dm_full_text_search.sql` adds a `search_vector
tsvector` column to `direct_messages`, a GIN index on it, and a `BEFORE
INSERT OR UPDATE OF content` trigger that recomputes it via `to_tsvector`.

### SQLite pattern

```sql
CREATE VIRTUAL TABLE direct_messages_fts USING fts5(
  content,
  content='direct_messages',
  content_rowid='rowid',
  tokenize='porter unicode61'
);
```

This is an **external-content** FTS5 table: it stores only the inverted
index, not a second copy of `content`, by pointing `content_rowid` at
`direct_messages`'s hidden `rowid` (SQLite keeps this even though `id` is a
`TEXT PRIMARY KEY`, since the table isn't declared `WITHOUT ROWID`).

External-content tables don't auto-sync — the app or triggers must mirror
every write:

```sql
CREATE TRIGGER direct_messages_fts_ai AFTER INSERT ON direct_messages BEGIN
  INSERT INTO direct_messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER direct_messages_fts_ad AFTER DELETE ON direct_messages BEGIN
  INSERT INTO direct_messages_fts(direct_messages_fts, rowid, content)
  VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER direct_messages_fts_au AFTER UPDATE OF content ON direct_messages BEGIN
  INSERT INTO direct_messages_fts(direct_messages_fts, rowid, content)
  VALUES ('delete', old.rowid, old.content);
  INSERT INTO direct_messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
```

The `'delete'` command is FTS5's special syntax for retracting a stale index
entry — needed before re-indexing on `UPDATE` and on physical row `DELETE`
(cascade deletes when a `dm_channel` or `user` is removed). Restricting the
update trigger to `UPDATE OF content` (mirroring the Postgres trigger's `OF
content` clause) means edits to `edited_at`/`deleted_at` alone don't churn
the index.

Querying:

```sql
SELECT dm.id, dm.content, bm25(direct_messages_fts) AS rank
FROM direct_messages_fts
JOIN direct_messages dm ON dm.rowid = direct_messages_fts.rowid
WHERE direct_messages_fts MATCH ?
  AND dm.deleted_at IS NULL
ORDER BY rank
```

`bm25()` gives a relevance ranking for free, comparable in spirit to
Postgres's `ts_rank`.

### What the spike verified end-to-end

- Insert → indexed → `MATCH` finds it.
- Edit `content` → old terms drop out, new terms are searchable (via the
  delete-then-reinsert pair in the update trigger).
- Soft delete (app sets `content = NULL`, per
  `apps/web/app/api/dm/channels/[channelId]/messages/[messageId]/route.ts`) →
  excluded from results through both the `UPDATE OF content` trigger and the
  `dm.deleted_at IS NULL` filter (defense in depth).
- Hard/cascade delete → row disappears from the FTS index; row counts between
  `direct_messages` and `direct_messages_fts` stay equal.
- `INSERT INTO direct_messages_fts(direct_messages_fts) VALUES('integrity-check')`
  is FTS5's built-in consistency check between the shadow index and content
  table — worth running in CI/smoke tests after the real migration lands.

### Confirmed constraints

- No query-builder or schema-declaration support for FTS5 in Drizzle or
  Prisma — this whole block (virtual table + triggers) must be raw SQL
  (`sql` tagged templates in Drizzle migrations, or a `.sql` file run
  directly), same as it would be hand-written against any raw `sqlite3` CLI.
- `better-sqlite3`'s bundled SQLite (3.49.2 in this environment) has FTS5
  compiled in (`pragma_compile_options` → `ENABLE_FTS5`); nothing extra to
  install beyond the `better-sqlite3` package itself.

## 2. Device-key cap-then-insert race

Scripts: `spikes/sqlite-migration/device-key-race.mjs` (orchestrator) and
`device-key-worker.mjs` (per-connection worker).

### The bug, reproduced

`upsert_user_device_key` (`supabase/migrations/00030_dm_e2ee.sql`) does:

```sql
SELECT COUNT(*) INTO v_count FROM user_device_keys
WHERE user_id = auth.uid() AND device_id <> p_device_id;

IF v_count >= p_device_limit THEN RAISE EXCEPTION 'device_limit_reached'; END IF;

INSERT INTO user_device_keys (...) VALUES (...)
ON CONFLICT (user_id, device_id) DO UPDATE SET ...;
```

A literal port to `better-sqlite3` as two standalone prepared statements has
the same check-then-act gap Postgres has: two concurrent registrations can
both read the same pre-insert count before either writes.

The spike proves this isn't hypothetical: two `worker_threads`, each with its
own connection to the same on-disk file, race to register a **new** device
for one user against a `device_limit` of 1 (chosen for a sharp pass/fail
signal). A 30ms synchronous sleep (`Atomics.wait`) is inserted between the
count and the insert to widen the window so the race reproduces every run
rather than only under unlucky timing — real production traffic doesn't need
help finding this window, but a deterministic test does.

Result: **both registrations report success**, and the table ends up with 2
rows against a limit of 1. Confirmed over multiple runs (see script output).

Why this specific case matters more than most: of the 7 live Postgres RPCs,
`upsert_user_device_key` is the one the issue and prior scoping work flagged
as genuinely needing atomicity — not just for style, but because encryption
key management is where a race actually corrupts state (a device that should
have been rejected ends up trusted).

### Why `db.transaction()` (Drizzle-style) doesn't just work

`better-sqlite3`'s own `.transaction()` API is **synchronous** — the callback
must not return a Promise, and any `await` inside it throws. Drizzle's
`db.transaction(async (tx) => ...)` assumes an async callback (matching its
Postgres/MySQL drivers, which are inherently async over a socket). This is a
hard API mismatch, not a configuration option — confirmed against
`better-sqlite3`'s transaction implementation, which runs the callback
inline between `BEGIN`/`COMMIT` with no microtask yield point.

### Two proven-safe patterns (neither needs an async transaction)

**B. `BEFORE INSERT` trigger** (recommended — see below):

```sql
CREATE TRIGGER user_device_keys_cap_before_insert
BEFORE INSERT ON user_device_keys
WHEN (
  SELECT COUNT(*) FROM user_device_keys
  WHERE user_id = NEW.user_id AND device_id <> NEW.device_id
) >= :device_limit
BEGIN
  SELECT RAISE(ABORT, 'device_limit_reached');
END;
```

The cap check becomes part of the same atomic `INSERT ... ON CONFLICT DO
UPDATE` statement — there's no app-level window between check and write to
race, because there's no separate app-level check at all. SQLite's own
single-writer locking does the rest: this is safe across processes, not just
threads within one Node process. `better-sqlite3` surfaces the `RAISE(ABORT,
'device_limit_reached')` as a catchable `SqliteError` whose `.message` is
exactly `device_limit_reached`, so the API route's existing
`error.message?.includes("device_limit_reached")` check
(`apps/web/app/api/dm/keys/device/route.ts`) needs no changes.

**C. `better-sqlite3`'s synchronous `.transaction().immediate()`:**

```js
const tx = db.transaction(() => {
  const { n } = countOtherDevices.get(userId, deviceId)
  if (n >= Math.max(limit, 1)) throw new Error("device_limit_reached")
  upsert.run(userId, deviceId, publicKey)
})
tx.immediate()
```

`.immediate()` (vs. the default `.deferred()`) acquires SQLite's write lock
at `BEGIN` instead of at the first write statement, so the read (`COUNT`)
and write (`INSERT`) execute under one continuously-held lock. A concurrent
`.immediate()` transaction from another connection blocks at `BEGIN`
(honoring `PRAGMA busy_timeout`) until this one commits, then re-reads a
fresh count. This mirrors the "workable sync-transaction wrapper" option the
issue named, and keeps the cap logic in application code rather than SQL.

Both were verified under the same real-concurrency harness: exactly one of
the two racing registrations succeeds, the loser fails with
`device_limit_reached`, and the final row count never exceeds the limit —
run repeatably (multiple runs shown stable, no flakes observed).

### Recommendation for #6

Prefer **B (trigger)** when authoring the Drizzle schema for
`user_device_keys`:

- Enforces the invariant at the schema level regardless of which code path
  writes to the table (API route, a future admin tool, a script) — pattern C
  only protects call sites that remember to use it.
- No dependency on how a given ORM call wraps a transaction; survives a
  future swap away from `better-sqlite3` more easily than app-level lock
  semantics tied to one driver's `.immediate()` API.
- Same "raw SQL only" bucket as the FTS5 triggers, so #6 already needs a
  raw-SQL migration step for schema objects Drizzle can't declare — this
  doesn't add a new category of hand-written SQL, just one more object in
  it.

Pattern C is worth keeping in mind for any future case where the cap/guard
logic is too dynamic to express as a static trigger predicate (e.g. depends
on data outside the table being inserted into).

## Environment notes

- `better-sqlite3@11.3.0` installed and built cleanly in this environment
  (prebuilt binary, no compiler toolchain needed) against bundled SQLite
  3.49.2, which has FTS5 enabled by default.
- Spike lives outside the npm workspaces (`spikes/sqlite-migration/package.json`
  is standalone) so it doesn't affect the app's dependency tree until #6
  actually adds `better-sqlite3`/`drizzle-orm` for real.
