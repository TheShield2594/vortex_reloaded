#!/usr/bin/env node
// Spike for issue #4 (part 2): a proven-safe pattern for the device-key
// cap-then-insert race (upsert_user_device_key), without relying on
// Drizzle's db.transaction() — better-sqlite3's own `.transaction()` is
// synchronous and rejects async callbacks outright.
//
// Runs three scenarios, each with two *real* concurrent registrations
// (separate worker threads, separate connections, same on-disk file)
// racing to register a new device for the same user against a device
// limit of 1:
//
//   A. naive     — direct port of the Postgres RPC's count-then-insert,
//                  as two standalone statements. Expected: BROKEN, both
//                  succeed, cap is exceeded (2 devices, limit 1).
//   B. trigger   — cap check moved into a BEFORE INSERT trigger, so the
//                  whole check+insert is one atomic statement.
//   C. immediate — count-then-insert wrapped in better-sqlite3's sync
//                  `.transaction().immediate()`.
//
// Run: node device-key-race.mjs

import Database from "better-sqlite3"
import { Worker } from "node:worker_threads"
import { fileURLToPath } from "node:url"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"

const WORKER_PATH = fileURLToPath(new URL("./device-key-worker.mjs", import.meta.url))
const LIMIT = 1 // sharp pass/fail signal: only 1 device allowed
const DELAY_MS = 30 // widen the check-then-act window so mode A reliably races

function freshDbPath(dir) {
  return path.join(dir, `devices-${process.hrtime.bigint()}.sqlite3`)
}

function createSchema(dbPath, { withTrigger }) {
  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.exec(`
    CREATE TABLE user_device_keys (
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, device_id)
    );
  `)
  if (withTrigger) {
    // Mirrors upsert_user_device_key's `COUNT(*) ... device_id <> p_device_id`
    // guard, but enforced by SQLite itself as part of the INSERT statement
    // rather than by application code running before it.
    db.exec(`
      CREATE TRIGGER user_device_keys_cap_before_insert
      BEFORE INSERT ON user_device_keys
      WHEN (
        SELECT COUNT(*) FROM user_device_keys
        WHERE user_id = NEW.user_id AND device_id <> NEW.device_id
      ) >= ${LIMIT}
      BEGIN
        SELECT RAISE(ABORT, 'device_limit_reached');
      END;
    `)
  }
  db.close()
}

function runWorker(dbPath, mode, deviceId) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: {
        dbPath,
        mode,
        userId: "user-1",
        deviceId,
        publicKey: `pk-${deviceId}`,
        limit: LIMIT,
        delayMs: DELAY_MS,
      },
    })
    worker.once("message", (msg) => {
      resolve(msg)
      worker.terminate()
    })
    worker.once("error", reject)
  })
}

const dir = mkdtempSync(path.join(tmpdir(), "vortex-device-key-spike-"))

async function scenario(name, mode, withTrigger) {
  const dbPath = freshDbPath(dir)
  createSchema(dbPath, { withTrigger })

  // Two genuinely concurrent device registrations for the same user,
  // racing against the device_limit=1 cap.
  const results = await Promise.all([
    runWorker(dbPath, mode, "device-A"),
    runWorker(dbPath, mode, "device-B"),
  ])

  const db = new Database(dbPath)
  const finalCount = db.prepare(`SELECT COUNT(*) AS n FROM user_device_keys WHERE user_id = 'user-1'`).get().n
  db.close()

  console.log(`\n[${name}]`)
  console.log("  results:", results)
  console.log(`  final device rows for user-1: ${finalCount} (limit=${LIMIT})`)
  return { results, finalCount }
}

const naiveOutcome = await scenario("A: naive count-then-insert (direct RPC port)", "naive", false)
const triggerOutcome = await scenario("B: BEFORE INSERT trigger cap", "trigger", true)
const immediateOutcome = await scenario("C: sync .transaction().immediate() wrapper", "immediate-tx", false)

// --- Assertions ------------------------------------------------------------

// A must demonstrably be broken — this is the bug the issue describes, not
// a hypothetical. If this assertion ever fails, the race stopped
// reproducing (e.g. timing changed) and DELAY_MS needs adjusting.
assert.equal(
  naiveOutcome.finalCount,
  2,
  "expected the naive pattern to oversell past the 1-device cap under real concurrency"
)
assert.ok(
  naiveOutcome.results.every((r) => r.ok),
  "naive pattern should let both concurrent registrations report success (that's the bug)"
)

for (const outcome of [
  { name: "trigger", outcome: triggerOutcome },
  { name: "immediate-tx", outcome: immediateOutcome },
]) {
  assert.equal(outcome.outcome.finalCount, 1, `${outcome.name}: cap must not exceed the limit`)
  assert.equal(
    outcome.outcome.results.filter((r) => r.ok).length,
    1,
    `${outcome.name}: exactly one of the two concurrent registrations should succeed`
  )
  assert.equal(
    outcome.outcome.results.filter((r) => !r.ok && r.error.includes("device_limit_reached")).length,
    1,
    `${outcome.name}: the loser must fail with device_limit_reached, not a generic SQLite error`
  )
}

rmSync(dir, { recursive: true, force: true })
console.log(
  "\nAll device-key race assertions passed: naive pattern reproducibly oversells under real " +
    "concurrent (worker_thread) access; both the trigger and immediate-transaction patterns cap correctly."
)
