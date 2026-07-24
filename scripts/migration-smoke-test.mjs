#!/usr/bin/env node
/**
 * Migration smoke test (static analysis — no database required)
 *
 * The app runs on SQLite via Drizzle (`@vortex/db`); the generated
 * migrations live in packages/db/migrations/ and are tracked by
 * drizzle-kit's journal (meta/_journal.json). This script validates that
 * migration tree's internal consistency so a malformed or half-committed
 * migration is caught in CI before it reaches the `db:migrate` apply step:
 *
 *   1. Every migration filename matches the drizzle-kit NNNN_name.sql pattern
 *   2. No two migration files share the same numeric prefix (version conflict)
 *   3. The journal is consistent with the files on disk:
 *        - every journal entry has a matching .sql file and meta snapshot
 *        - every .sql file is referenced by exactly one journal entry
 *        - entry idx values are 0..N-1 and match the filename prefixes in order
 *        - `when` timestamps are non-decreasing
 *   4. The hand-written FTS5 + triggers SQL (applied after the generated DDL
 *      by migrate.ts) is present and non-empty
 *
 * The CI job additionally applies these migrations to a throwaway SQLite
 * file (`db:migrate`), which is the runtime counterpart to this static pass.
 *
 * Usage (from repo root):
 *   node scripts/migration-smoke-test.mjs
 *
 * Exit code:
 *   0 – all assertions passed
 *   1 – one or more assertions failed (details printed to stderr)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const DB_PKG = new URL("../packages/db/", import.meta.url).pathname
const MIGRATIONS_DIR = join(DB_PKG, "migrations")
const META_DIR = join(MIGRATIONS_DIR, "meta")
const JOURNAL_PATH = join(META_DIR, "_journal.json")
const FTS5_SQL_PATH = join(DB_PKG, "src", "sql", "fts5-and-triggers.sql")

let failures = 0
const fail = (msg) => {
  console.error(`✗  ${msg}`)
  failures++
}

// ── Load migration files ──────────────────────────────────────────────────────
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()

if (files.length === 0) {
  fail(`No .sql migrations found in ${MIGRATIONS_DIR}`)
}

// ── Check 1: filename format ──────────────────────────────────────────────────
// drizzle-kit names migrations NNNN_slug.sql (four-digit zero-padded index).
const FILE_RE = /^\d{4}_\w+\.sql$/
for (const f of files) {
  if (!FILE_RE.test(f)) {
    fail(`Unexpected migration filename: ${f}`)
  }
}

// ── Check 2: no duplicate version prefixes ────────────────────────────────────
const versionsSeen = new Map()
for (const f of files) {
  const version = f.slice(0, 4)
  if (versionsSeen.has(version)) {
    fail(`Duplicate migration version ${version}: ${versionsSeen.get(version)} and ${f}`)
  } else {
    versionsSeen.set(version, f)
  }
}

// ── Check 3: journal consistency ──────────────────────────────────────────────
if (!existsSync(JOURNAL_PATH)) {
  fail(`Missing drizzle journal: ${JOURNAL_PATH}`)
} else {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"))
  const entries = Array.isArray(journal.entries) ? journal.entries : []

  if (entries.length !== files.length) {
    fail(`Journal has ${entries.length} entries but ${files.length} .sql files exist`)
  }

  const filesByPrefix = new Map([...versionsSeen].map(([prefix, f]) => [prefix, f]))
  const referencedFiles = new Set()
  let prevWhen = -Infinity

  entries.forEach((entry, position) => {
    if (entry.idx !== position) {
      fail(`Journal entry ${entry.tag ?? position} has idx ${entry.idx}, expected ${position}`)
    }

    const expectedPrefix = String(position).padStart(4, "0")
    const sqlFile = `${entry.tag}.sql`
    if (!files.includes(sqlFile)) {
      fail(`Journal entry "${entry.tag}" has no matching migration file ${sqlFile}`)
    } else {
      referencedFiles.add(sqlFile)
      if (!sqlFile.startsWith(expectedPrefix)) {
        fail(`Journal entry idx ${position} points at ${sqlFile}, expected prefix ${expectedPrefix}`)
      }
    }

    const snapshot = join(META_DIR, `${expectedPrefix}_snapshot.json`)
    if (!existsSync(snapshot)) {
      fail(`Missing snapshot for "${entry.tag}": ${snapshot}`)
    }

    if (typeof entry.when === "number") {
      if (entry.when < prevWhen) {
        fail(`Journal entry "${entry.tag}" has non-increasing "when" timestamp`)
      }
      prevWhen = entry.when
    }
  })

  for (const f of files) {
    if (!referencedFiles.has(f)) {
      fail(`Migration file ${f} is not referenced by any journal entry`)
    }
  }
}

// ── Check 4: FTS5 + triggers SQL present ──────────────────────────────────────
if (!existsSync(FTS5_SQL_PATH)) {
  fail(`Missing FTS5/triggers SQL: ${FTS5_SQL_PATH}`)
} else if (readFileSync(FTS5_SQL_PATH, "utf8").trim().length === 0) {
  fail(`FTS5/triggers SQL is empty: ${FTS5_SQL_PATH}`)
}

// ── Result ────────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n✗  ${failures} assertion(s) failed.`)
  process.exit(1)
}

console.log(`✓  ${files.length} Drizzle migration files checked`)
console.log(`✓  journal consistent with files and snapshots`)
console.log(`✓  FTS5 + triggers SQL present`)
