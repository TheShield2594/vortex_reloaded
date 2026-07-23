import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { importAllTables } from "../import"
import { DM_CHANNEL, FIXTURE_TABLES, MESSAGE_1, MESSAGE_2, USER_ALICE, USER_BOB, writeFixtureDumps } from "./fixtures"

let workDir: string
let outputDir: string
let targetPath: string

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "vortex-migration-import-test-"))
  outputDir = path.join(workDir, "output")
  targetPath = path.join(workDir, "target.db")
  mkdirSync(outputDir, { recursive: true })
  writeFixtureDumps(outputDir)
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe("importAllTables", () => {
  it("refuses to import into a file that already exists", async () => {
    writeFileSync(targetPath, "")
    await expect(importAllTables(targetPath, outputDir)).rejects.toThrow(/already exists/)
  })

  it("imports every fixture table with the correct row counts", async () => {
    const { counts } = await importAllTables(targetPath, outputDir)
    for (const [table, rows] of Object.entries(FIXTURE_TABLES)) {
      expect(counts[table]).toBe(rows.length)
    }
    // Tables with no dump file (nothing written by writeFixtureDumps) import as zero rows.
    expect(counts.friendships).toBe(0)
  })

  it("round-trips type conversions faithfully", async () => {
    await importAllTables(targetPath, outputDir)
    const sqlite = new Database(targetPath, { readonly: true })
    try {
      const alice = sqlite.prepare(`SELECT * FROM users WHERE id = ?`).get(USER_ALICE) as Record<string, unknown>

      // TIMESTAMPTZ -> ISO-8601 TEXT
      expect(alice.created_at).toBe("2026-01-01T00:00:00.000Z")
      // BOOLEAN -> 0/1
      expect(alice.discoverable).toBe(1)
      // JSONB -> JSON text, round-trippable
      expect(JSON.parse(alice.appearance_settings as string)).toEqual({ customCss: "" })
      // TEXT[] -> JSON-array text
      expect(JSON.parse(alice.interests as string)).toEqual(["gaming", "music"])
      // UUID passthrough
      expect(alice.id).toBe(USER_ALICE)
    } finally {
      sqlite.close()
    }
  })

  it("preserves the self-referential reply_to_id relationship", async () => {
    await importAllTables(targetPath, outputDir)
    const sqlite = new Database(targetPath, { readonly: true })
    try {
      const reply = sqlite.prepare(`SELECT * FROM direct_messages WHERE id = ?`).get(MESSAGE_2) as Record<
        string,
        unknown
      >
      expect(reply.reply_to_id).toBe(MESSAGE_1)
      expect(reply.dm_channel_id).toBe(DM_CHANNEL)
    } finally {
      sqlite.close()
    }
  })

  it("does not let dm_channel_members/direct_messages bulk-load side-effect dm_channels via triggers", async () => {
    await importAllTables(targetPath, outputDir)
    const sqlite = new Database(targetPath, { readonly: true })
    try {
      const channel = sqlite.prepare(`SELECT * FROM dm_channels WHERE id = ?`).get(DM_CHANNEL) as Record<
        string,
        unknown
      >
      // Source dm_channels.updated_at, not "bumped to import time" by
      // dm_message_bump_trigger firing on every imported direct_message.
      expect(channel.updated_at).toBe("2026-01-02T00:00:00.000Z")
      expect(channel.encryption_key_version).toBe(1)
    } finally {
      sqlite.close()
    }
  })

  it("backfills the FTS5 index so imported message content is searchable", async () => {
    await importAllTables(targetPath, outputDir)
    const sqlite = new Database(targetPath, { readonly: true })
    try {
      const hits = sqlite
        .prepare(
          `SELECT dm.id FROM direct_messages_fts
           JOIN direct_messages dm ON dm.rowid = direct_messages_fts.rowid
           WHERE direct_messages_fts MATCH ?`
        )
        .all("hello") as { id: string }[]
      expect(hits.map((h) => h.id)).toEqual([MESSAGE_1])
    } finally {
      sqlite.close()
    }
  })

  it("applies triggers only after import, so they take effect for writes that happen afterward", async () => {
    await importAllTables(targetPath, outputDir)
    const sqlite = new Database(targetPath)
    sqlite.pragma("foreign_keys = ON")
    try {
      const before = sqlite.prepare(`SELECT updated_at FROM dm_channels WHERE id = ?`).get(DM_CHANNEL) as {
        updated_at: string
      }

      sqlite
        .prepare(
          `INSERT INTO direct_messages (id, sender_id, receiver_id, content, dm_channel_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run("55555555-5555-5555-5555-555555555555", USER_BOB, USER_ALICE, "new message", DM_CHANNEL, new Date().toISOString())

      const after = sqlite.prepare(`SELECT updated_at FROM dm_channels WHERE id = ?`).get(DM_CHANNEL) as {
        updated_at: string
      }
      // dm_message_bump_trigger fires on this real post-import insert.
      expect(after.updated_at).not.toBe(before.updated_at)

      const hits = sqlite
        .prepare(`SELECT rowid FROM direct_messages_fts WHERE direct_messages_fts MATCH ?`)
        .all("new") as unknown[]
      expect(hits.length).toBe(1)
    } finally {
      sqlite.close()
    }
  })
})
