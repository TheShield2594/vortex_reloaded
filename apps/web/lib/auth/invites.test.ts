import { randomUUID } from "node:crypto"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registrationInvites, users, type VortexDb } from "@vortex/db"
import { checkInviteCode, consumeInviteCode, generateInviteCode, normalizeInviteCode } from "./invites"

// A minimal, hand-written schema (not the full migration pipeline) covering
// just what registration_invites' FK and invites.ts's queries touch — keeps
// this test fast and independent of packages/db's migration file layout.
function createTestDb(): { db: VortexDb; sqlite: Database.Database } {
  const sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT
    );
    CREATE TABLE registration_invites (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      use_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
  `)
  return { db: drizzle(sqlite) as unknown as VortexDb, sqlite }
}

async function insertInvite(
  db: VortexDb,
  overrides: Partial<typeof registrationInvites.$inferInsert> = {}
): Promise<string> {
  const id = randomUUID()
  await db.insert(registrationInvites).values({
    id,
    code: overrides.code ?? generateInviteCode(),
    maxUses: overrides.maxUses ?? 1,
    useCount: overrides.useCount ?? 0,
    expiresAt: overrides.expiresAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    createdAt: new Date().toISOString(),
    ...overrides,
  })
  return id
}

describe("invites: code generation", () => {
  it("generates codes from the expected alphabet and length", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode()
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
    }
  })

  it("normalizes lowercase, whitespace, and stray punctuation", () => {
    expect(normalizeInviteCode(" abcd-1234 ")).toBe("ABCD1234")
    expect(normalizeInviteCode("abCD1234")).toBe("ABCD1234")
  })
})

describe("invites: checkInviteCode / consumeInviteCode", () => {
  let db: VortexDb
  let sqlite: Database.Database

  beforeEach(() => {
    const ctx = createTestDb()
    db = ctx.db
    sqlite = ctx.sqlite
  })

  afterEach(() => {
    sqlite.close()
  })

  it("reports not_found for a nonexistent code", async () => {
    expect(await checkInviteCode(db, "NOPE0000")).toEqual({ valid: false, reason: "not_found" })
  })

  it("validates and consumes a fresh single-use code", async () => {
    await insertInvite(db, { code: "GOOD1234", maxUses: 1, useCount: 0 })

    expect(await checkInviteCode(db, "good1234")).toEqual({ valid: true })
    expect(await consumeInviteCode(db, "good1234")).toBe(true)
    expect(await checkInviteCode(db, "GOOD1234")).toEqual({ valid: false, reason: "exhausted" })
  })

  it("rejects a revoked code", async () => {
    await insertInvite(db, { code: "REVOKED1", revokedAt: new Date().toISOString() })
    expect(await checkInviteCode(db, "REVOKED1")).toEqual({ valid: false, reason: "revoked" })
    expect(await consumeInviteCode(db, "REVOKED1")).toBe(false)
  })

  it("rejects an expired code", async () => {
    await insertInvite(db, { code: "EXPIRED1", expiresAt: new Date(Date.now() - 60_000).toISOString() })
    expect(await checkInviteCode(db, "EXPIRED1")).toEqual({ valid: false, reason: "expired" })
    expect(await consumeInviteCode(db, "EXPIRED1")).toBe(false)
  })

  it("accepts a code with a future expiry", async () => {
    await insertInvite(db, { code: "FUTURE01", expiresAt: new Date(Date.now() + 60_000).toISOString() })
    expect(await checkInviteCode(db, "FUTURE01")).toEqual({ valid: true })
  })

  it("allows exactly maxUses consumptions and rejects the next", async () => {
    await insertInvite(db, { code: "MULTIUSE", maxUses: 3, useCount: 0 })

    expect(await consumeInviteCode(db, "MULTIUSE")).toBe(true)
    expect(await consumeInviteCode(db, "MULTIUSE")).toBe(true)
    expect(await consumeInviteCode(db, "MULTIUSE")).toBe(true)
    expect(await consumeInviteCode(db, "MULTIUSE")).toBe(false)
  })

  it("the WHERE-guarded UPDATE caps total successful consumes at maxUses even when fired without sequential awaiting", async () => {
    // better-sqlite3 is synchronous and Node is single-threaded, so this
    // doesn't exercise genuine OS-thread interleaving — it verifies the
    // guard clause itself (use_count < max_uses in the same UPDATE) rather
    // than the driver's transaction isolation, which is what actually
    // prevents two real concurrent requests from both consuming the last
    // use of a maxUses-limited code.
    await insertInvite(db, { code: "RACEONE1", maxUses: 1, useCount: 0 })

    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeInviteCode(db, "RACEONE1"))
    )
    expect(results.filter(Boolean).length).toBe(1)

    const rows = await db.select().from(registrationInvites)
    expect(rows[0]?.useCount).toBe(1)
  })

  it("treats an empty or whitespace-only code as invalid without querying", async () => {
    expect(await checkInviteCode(db, "   ")).toEqual({ valid: false, reason: "not_found" })
    expect(await consumeInviteCode(db, "")).toBe(false)
  })
})
