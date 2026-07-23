import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { importAllTables } from "../import"
import { verifyMigration } from "../verify"
import { FIXTURE_TABLES, MESSAGE_1, writeFixtureDumps } from "./fixtures"

/**
 * A minimal fake `pg.Pool` — verify.ts only ever calls `.query(sql, params)`
 * — backed by the same fixture data used to build the SQLite target, so a
 * clean import reports zero mismatches, and a deliberately corrupted target
 * reports exactly the mismatch introduced.
 */
function fakePool() {
  return {
    async query(sql: string, params: unknown[] = []) {
      const table = sql.match(/"public"\."(\w+)"/)?.[1]
      const rows = table ? (FIXTURE_TABLES[table] ?? []) : []
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: rows.length }] }
      }
      const limit = typeof params[0] === "number" ? params[0] : rows.length
      return { rows: rows.slice(0, limit) }
    },
    async end() {},
  }
}

let workDir: string
let outputDir: string
let targetPath: string

beforeEach(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), "vortex-migration-verify-test-"))
  outputDir = path.join(workDir, "output")
  targetPath = path.join(workDir, "target.db")
  mkdirSync(outputDir, { recursive: true })
  writeFixtureDumps(outputDir)
  await importAllTables(targetPath, outputDir)
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe("verifyMigration", () => {
  it("reports ok with no mismatches against a faithful import", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await verifyMigration(fakePool() as any, targetPath)
    expect(report.ok).toBe(true)
    expect(report.replyToIntegrityIssues).toEqual([])
    for (const t of report.tables) {
      expect(t.countMatches).toBe(true)
      expect(t.sampleMismatches).toEqual([])
    }
  })

  it("catches a row count mismatch", async () => {
    const sqlite = new Database(targetPath)
    sqlite.prepare(`DELETE FROM users WHERE id = ?`).run("11111111-1111-1111-1111-111111111112")
    sqlite.close()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await verifyMigration(fakePool() as any, targetPath)
    expect(report.ok).toBe(false)
    const usersReport = report.tables.find((t) => t.table === "users")
    expect(usersReport?.countMatches).toBe(false)
    expect(usersReport?.sqliteCount).toBe(1)
    expect(usersReport?.postgresCount).toBe(2)
  })

  it("catches a transformed-value mismatch in the sample diff", async () => {
    const sqlite = new Database(targetPath)
    sqlite.prepare(`UPDATE direct_messages SET content = ? WHERE id = ?`).run("tampered", MESSAGE_1)
    sqlite.close()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await verifyMigration(fakePool() as any, targetPath)
    expect(report.ok).toBe(false)
    const dmReport = report.tables.find((t) => t.table === "direct_messages")
    expect(dmReport?.sampleMismatches.some((m) => m.includes("content"))).toBe(true)
  })

  it("catches a reply_to_id pointing at a message in a different dm_channel_id", async () => {
    const sqlite = new Database(targetPath)
    sqlite.pragma("foreign_keys = OFF")
    sqlite
      .prepare(`INSERT INTO dm_channels (id, is_group, is_encrypted, encryption_key_version, encryption_membership_epoch, created_at, updated_at)
                VALUES ('other-channel', 0, 0, 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`)
      .run()
    sqlite.prepare(`UPDATE direct_messages SET dm_channel_id = 'other-channel' WHERE id = ?`).run(MESSAGE_1)
    sqlite.close()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await verifyMigration(fakePool() as any, targetPath)
    expect(report.ok).toBe(false)
    expect(report.replyToIntegrityIssues.length).toBeGreaterThan(0)
  })
})
