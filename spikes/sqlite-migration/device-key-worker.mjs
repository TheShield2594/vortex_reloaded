// Worker used by device-key-race.mjs. Each worker opens its own connection
// to the same on-disk SQLite file and attempts a single device-key
// registration, so the three modes below are exercised under *real*
// concurrent access (separate OS threads), not simulated interleaving.
import { parentPort, workerData } from "node:worker_threads"
import Database from "better-sqlite3"

// Synchronous sleep (Atomics.wait blocks the calling thread — fine here,
// each worker has its own thread). Used only in immediate-tx mode, to prove
// the write lock stays held for the whole window, not to induce a race.
function sleepSync(ms) {
  if (!ms) return
  const sab = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(sab, 0, 0, ms)
}

// Two-phase barrier for the naive mode: rather than betting on a fixed
// delay to widen the check-then-act window, block on a SharedArrayBuffer
// until the orchestrator confirms *both* workers have finished their count.
// This makes the race deterministic by construction (both reads are
// guaranteed to happen before either write) instead of timing-dependent.
function waitForBarrierRelease(barrierBuffer) {
  const view = new Int32Array(barrierBuffer)
  parentPort.postMessage({ type: "count-complete" })
  Atomics.wait(view, 0, 0)
}

const { dbPath, mode, userId, deviceId, publicKey, limit, delayMs, barrierBuffer } = workerData

const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
db.pragma("busy_timeout = 5000")

const countOtherDevices = db.prepare(
  `SELECT COUNT(*) AS n FROM user_device_keys WHERE user_id = ? AND device_id <> ?`
)
const upsert = db.prepare(`
  INSERT INTO user_device_keys (user_id, device_id, public_key, updated_at)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, device_id) DO UPDATE SET
    public_key = excluded.public_key,
    updated_at = datetime('now')
`)

// Mode A: direct port of the Postgres RPC's logic — two standalone
// statements, no wrapping transaction. This is what a literal line-by-line
// port to Drizzle/better-sqlite3 looks like. The barrier below forces both
// workers' counts to land before either insert, so the race is guaranteed,
// not just likely.
function naive() {
  const { n } = countOtherDevices.get(userId, deviceId)
  waitForBarrierRelease(barrierBuffer)
  if (n >= Math.max(limit, 1)) throw new Error("device_limit_reached")
  upsert.run(userId, deviceId, publicKey)
}

// Mode B: the cap check lives in a BEFORE INSERT trigger (schema created by
// the orchestrator), so the whole check+insert is one atomic SQLite
// statement — there is no app-level window to race.
function triggerEnforced() {
  upsert.run(userId, deviceId, publicKey)
}

// Mode C: better-sqlite3's own *synchronous* `.transaction()` wrapper
// (not Drizzle's async db.transaction(), which better-sqlite3 rejects).
// `.immediate()` acquires SQLite's write lock at BEGIN instead of at the
// first write, so the count-then-insert sequence executes under a held
// lock; a concurrent immediate transaction blocks (via busy_timeout) until
// this one commits, then re-reads a fresh count.
function immediateTx() {
  const tx = db.transaction(() => {
    const { n } = countOtherDevices.get(userId, deviceId)
    sleepSync(delayMs)
    if (n >= Math.max(limit, 1)) throw new Error("device_limit_reached")
    upsert.run(userId, deviceId, publicKey)
  })
  tx.immediate()
}

try {
  if (mode === "naive") naive()
  else if (mode === "trigger") triggerEnforced()
  else if (mode === "immediate-tx") immediateTx()
  else throw new Error(`unknown mode ${mode}`)
  parentPort.postMessage({ type: "result", ok: true, deviceId })
} catch (err) {
  parentPort.postMessage({ type: "result", ok: false, deviceId, error: String((err && err.message) || err) })
} finally {
  db.close()
}
