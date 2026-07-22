#!/usr/bin/env node
// Spike for issue #4 (part 1): FTS5 virtual table + sync trigger + MATCH query
// against a direct_messages-shaped table, entirely via raw SQL (no Drizzle
// query-builder support exists for FTS5 DDL).
//
// Mirrors the Postgres pattern in supabase/migrations/00089_dm_full_text_search.sql
// (search_vector tsvector column + GIN index + BEFORE INSERT/UPDATE trigger),
// but ports it to SQLite's "external content" FTS5 table, since duplicating
// message content into the index (a "contentless"-adjacent, non-external table)
// would double storage for no benefit here.
//
// Run: node fts5-direct-messages.mjs

import Database from "better-sqlite3"
import assert from "node:assert/strict"

const db = new Database(":memory:")
db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")

// ---------------------------------------------------------------------------
// 1. Base tables. A minimal `dm_channels` parent is included (rather than
//    stubbing FKs out) so the "cascade delete" exercise below is a real
//    ON DELETE CASCADE, not a manual DELETE standing in for one.
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE dm_channels (
    id TEXT PRIMARY KEY
  );

  CREATE TABLE direct_messages (
    id TEXT PRIMARY KEY,
    dm_channel_id TEXT NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL,
    content TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    edited_at TEXT,
    deleted_at TEXT
  );
`)

// ---------------------------------------------------------------------------
// 2. FTS5 virtual table, in "external content" mode: it stores only the
//    inverted index, not a second copy of `content`. content_rowid='rowid'
//    ties each FTS row back to direct_messages' implicit rowid (direct_messages
//    has a TEXT primary key, so SQLite still keeps a hidden integer rowid
//    unless the table is declared WITHOUT ROWID — it isn't here).
// ---------------------------------------------------------------------------
db.exec(`
  CREATE VIRTUAL TABLE direct_messages_fts USING fts5(
    content,
    content='direct_messages',
    content_rowid='rowid',
    tokenize='porter unicode61'
  );
`)

// ---------------------------------------------------------------------------
// 3. Sync triggers — the FTS5 equivalent of the Postgres
//    direct_messages_search_vector_update() trigger function. External-content
//    FTS5 tables require the app (or triggers) to explicitly mirror writes;
//    there is no "GENERATED ALWAYS"-style auto-sync.
//
//    The special 'delete' command (INSERT INTO fts_table(fts_table, rowid, ...)
//    VALUES('delete', ...)) removes stale index entries — required before
//    re-indexing on UPDATE, and on physical row DELETE (e.g. cascade deletes
//    when a dm_channel or user is removed).
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TRIGGER direct_messages_fts_ai AFTER INSERT ON direct_messages BEGIN
    INSERT INTO direct_messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END;

  CREATE TRIGGER direct_messages_fts_ad AFTER DELETE ON direct_messages BEGIN
    INSERT INTO direct_messages_fts(direct_messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  END;

  -- Postgres only re-derives search_vector "OF content" changing; do the same
  -- here so edits to unrelated columns (edited_at, deleted_at bookkeeping)
  -- don't churn the index.
  CREATE TRIGGER direct_messages_fts_au AFTER UPDATE OF content ON direct_messages BEGIN
    INSERT INTO direct_messages_fts(direct_messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
    INSERT INTO direct_messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
`)

const insert = db.prepare(
  `INSERT INTO direct_messages (id, dm_channel_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)`
)
const update = db.prepare(`UPDATE direct_messages SET content = ? WHERE id = ?`)
const softDelete = db.prepare(
  `UPDATE direct_messages SET content = NULL, deleted_at = datetime('now') WHERE id = ?`
)
const deleteChannel = db.prepare(`DELETE FROM dm_channels WHERE id = ?`)

const search = db.prepare(`
  SELECT dm.id, dm.content, bm25(direct_messages_fts) AS rank
  FROM direct_messages_fts
  JOIN direct_messages dm ON dm.rowid = direct_messages_fts.rowid
  WHERE direct_messages_fts MATCH ?
    AND dm.deleted_at IS NULL
  ORDER BY rank
`)

// ---------------------------------------------------------------------------
// 4. End-to-end exercise
// ---------------------------------------------------------------------------
// msg-2 lives in its own channel so the cascade-delete exercise below can
// remove exactly one message (via its parent dm_channel) without disturbing
// msg-1/msg-3.
db.prepare(`INSERT INTO dm_channels (id) VALUES (?)`).run("chan-1")
db.prepare(`INSERT INTO dm_channels (id) VALUES (?)`).run("chan-2")

insert.run("msg-1", "chan-1", "user-a", "Are we still on for the rocket launch tomorrow?", "2026-01-01")
insert.run("msg-2", "chan-2", "user-b", "Yes! Bringing the telescope too.", "2026-01-02")
insert.run("msg-3", "chan-1", "user-a", "Great, see you at the launch pad at dawn.", "2026-01-03")

let hits = search.all("launch")
assert.equal(hits.length, 2, "expected 2 matches for 'launch' after inserts")
console.log("MATCH 'launch' ->", hits.map((h) => h.id))

// content edit re-indexes correctly
update.run("Actually the rocket launch got postponed to next week.", "msg-1")
hits = search.all("postponed")
assert.equal(hits.length, 1)
assert.equal(hits[0].id, "msg-1")
console.log("MATCH 'postponed' after edit ->", hits.map((h) => h.id))

// old term no longer matches msg-1's new content, but msg-3 still has "launch"
hits = search.all("launch")
assert.deepEqual(
  hits.map((h) => h.id).sort(),
  ["msg-1", "msg-3"],
  "msg-1 now matches on new content ('launch' still appears), msg-3 unchanged"
)

// soft delete (content -> NULL) removes it from search results
softDelete.run("msg-3")
hits = search.all("launch")
assert.deepEqual(hits.map((h) => h.id), ["msg-1"], "soft-deleted message excluded from results")
console.log("MATCH 'launch' after soft-delete of msg-3 ->", hits.map((h) => h.id))

// physical delete via a real FK cascade (deleting msg-2's parent dm_channel,
// with foreign_keys=ON) also removes it from the index, no orphaned rows.
// SQLite's cascade delete performs an actual DELETE on the child row, so the
// direct_messages_fts_ad AFTER DELETE trigger still fires.
deleteChannel.run("chan-2")
const msg2Row = db.prepare("SELECT 1 FROM direct_messages WHERE id = 'msg-2'").get()
assert.equal(msg2Row, undefined, "msg-2 must be gone after its parent dm_channel cascades")
const ftsRowCount = db.prepare("SELECT count(*) AS n FROM direct_messages_fts").get().n
const baseRowCount = db.prepare("SELECT count(*) AS n FROM direct_messages").get().n
assert.equal(ftsRowCount, baseRowCount, "FTS index row count must track base table after cascade delete")
console.log(`Row counts after cascade delete: base=${baseRowCount} fts=${ftsRowCount}`)

// 'integrity-check' alone only checks the FTS index's own internal
// structure. For an external-content table, catching drift between the FTS
// index and the content table (direct_messages) requires rank=1 — verified
// empirically: without it, a deliberately desynced index/content pair does
// NOT raise, silently passing a corrupted index.
db.prepare(`INSERT INTO direct_messages_fts(direct_messages_fts, rank) VALUES('integrity-check', 1)`).run()

console.log("\nAll FTS5 assertions passed.")
