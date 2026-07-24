import { randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type VortexDb } from "@vortex/db"
import { getStepUpMethods, verifyStepUpPassword } from "./step-up-verify"

// Hand-written schema covering only the columns these two queries touch —
// same approach as invites.test.ts, so the test doesn't depend on packages/db's
// migration file layout.
function createTestDb(): { db: VortexDb; sqlite: Database.Database } {
  const sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT,
      two_factor_enabled INTEGER DEFAULT 0
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      password TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  return { db: drizzle(sqlite) as unknown as VortexDb, sqlite }
}

let db: VortexDb
let sqlite: Database.Database

beforeEach(() => {
  ;({ db, sqlite } = createTestDb())
})

afterEach(() => {
  sqlite.close()
})

// Inserted with raw SQL rather than through Drizzle: a Drizzle insert names
// every column of the mapped table, which would force this fixture to
// reproduce all ~25 columns of `users` instead of the four these queries read.
function insertUser(twoFactorEnabled = false): string {
  const id = randomUUID()
  sqlite
    .prepare("INSERT INTO users (id, username, email, two_factor_enabled) VALUES (?, ?, ?, ?)")
    .run(id, `user-${id.slice(0, 8)}`, `${id.slice(0, 8)}@example.test`, twoFactorEnabled ? 1 : 0)
  return id
}

function insertAccount(userId: string, providerId: string, password: string | null): void {
  const now = Math.floor(Date.now() / 1000)
  sqlite
    .prepare(
      "INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(randomUUID(), userId, `${providerId}-${userId}`, providerId, password, now, now)
}

const insertCredential = (userId: string, password: string | null): void =>
  insertAccount(userId, "credential", password)

const insertOAuthAccount = (userId: string, providerId: string): void =>
  insertAccount(userId, providerId, null)

describe("getStepUpMethods", () => {
  it("offers password for an account with a credential row", async () => {
    const userId = insertUser()
    insertCredential(userId, await bcrypt.hash("correct horse battery", 4))

    expect(await getStepUpMethods(db, userId)).toEqual({ password: true, totp: false })
  })

  it("offers TOTP once 2FA is enrolled", async () => {
    const userId = insertUser(true)
    insertCredential(userId, await bcrypt.hash("correct horse battery", 4))

    expect(await getStepUpMethods(db, userId)).toEqual({ password: true, totp: true })
  })

  it("offers nothing for an OAuth-only account with no 2FA", async () => {
    const userId = insertUser()
    insertOAuthAccount(userId, "github")

    // This is the lockout case the route's escape hatch exists for — there is
    // genuinely no credential to re-prove, so it must report neither factor
    // rather than a password the account doesn't have.
    expect(await getStepUpMethods(db, userId)).toEqual({ password: false, totp: false })
  })

  it("ignores a credential row whose password is null", async () => {
    const userId = insertUser()
    insertCredential(userId, null)

    expect(await getStepUpMethods(db, userId)).toEqual({ password: false, totp: false })
  })

  it("does not leak another user's factors", async () => {
    const other = insertUser(true)
    insertCredential(other, await bcrypt.hash("correct horse battery", 4))
    const userId = insertUser()

    expect(await getStepUpMethods(db, userId)).toEqual({ password: false, totp: false })
  })
})

describe("verifyStepUpPassword", () => {
  it("accepts the correct password", async () => {
    const userId = insertUser()
    insertCredential(userId, await bcrypt.hash("correct horse battery", 4))

    expect(await verifyStepUpPassword(db, userId, "correct horse battery")).toBe(true)
  })

  it("rejects a wrong password", async () => {
    const userId = insertUser()
    insertCredential(userId, await bcrypt.hash("correct horse battery", 4))

    expect(await verifyStepUpPassword(db, userId, "correct horse batterz")).toBe(false)
  })

  it("rejects an empty password against a real hash", async () => {
    const userId = insertUser()
    insertCredential(userId, await bcrypt.hash("correct horse battery", 4))

    expect(await verifyStepUpPassword(db, userId, "")).toBe(false)
  })

  it("rejects when the account has no credential row", async () => {
    const userId = insertUser()
    insertOAuthAccount(userId, "github")

    expect(await verifyStepUpPassword(db, userId, "anything")).toBe(false)
  })

  it("does not match another user's password", async () => {
    const other = insertUser()
    insertCredential(other, await bcrypt.hash("correct horse battery", 4))
    const userId = insertUser()
    insertCredential(userId, await bcrypt.hash("a totally different one", 4))

    expect(await verifyStepUpPassword(db, userId, "correct horse battery")).toBe(false)
  })
})
