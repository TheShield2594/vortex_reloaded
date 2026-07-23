import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"
import Database from "better-sqlite3"
import { resolveDbPath, resolveUploadsDir } from "../db-path"

/**
 * Step (issue #10): move avatar/attachment files out of Supabase Storage
 * and onto local disk, rewriting the SQLite rows that reference them.
 *
 * Runs against the already-migrated SQLite target (i.e. after import.ts),
 * not the source Postgres database — the row data is already local by the
 * time this runs; only the file bytes and the URL/path columns pointing at
 * them still need to move.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the same
 * Supabase project credentials apps/web uses) to read the source buckets.
 *
 * Usage:
 *   tsx src/migration/storage.ts                    # target defaults to DATABASE_URL (db-path.ts)
 *   tsx src/migration/storage.ts --target /data/vortex.db
 */

interface Report {
  avatars: { migrated: number; failed: number }
  attachments: { migrated: number; failed: number }
  dmAttachments: { migrated: number; failed: number }
}

function createSourceStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (the source Supabase project's Storage)")
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

type SupabaseStorageClient = ReturnType<typeof createSourceStorageClient>

/** Extract the storage path from a Supabase public/signed URL for a given bucket. */
function extractStoragePath(url: string, bucket: string): string | null {
  try {
    const parsed = new URL(url)
    const re = new RegExp(`/(?:storage/v1/)?object/(?:public|sign)/${bucket}/(.+)`)
    const match = parsed.pathname.match(re)
    return match?.[1] ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

/**
 * Resolve `storagePath` (decoded from a source row's URL — not to be
 * trusted blindly) against `subDir` under `uploadsDir`, rejecting anything
 * that would escape it via `..` segments or an absolute path.
 */
function safeDestPath(uploadsDir: string, subDir: string, storagePath: string): string | null {
  const base = path.join(uploadsDir, subDir)
  const resolved = path.resolve(base, storagePath)
  const relative = path.relative(base, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null
  return resolved
}

async function migrateAvatars(
  supabase: SupabaseStorageClient,
  db: Database.Database,
  uploadsDir: string,
): Promise<{ migrated: number; failed: number }> {
  const rows = db
    .prepare(`SELECT id, avatar_url FROM users WHERE avatar_url IS NOT NULL AND avatar_url LIKE '%supabase%'`)
    .all() as Array<{ id: string; avatar_url: string }>
  const update = db.prepare(`UPDATE users SET avatar_url = ? WHERE id = ?`)

  let migrated = 0
  let failed = 0
  for (const row of rows) {
    const storagePath = extractStoragePath(row.avatar_url, "avatars")
    if (!storagePath) {
      console.warn(`[storage] avatars: could not parse URL for user ${row.id}`)
      failed++
      continue
    }

    const destPath = safeDestPath(uploadsDir, "avatars", storagePath)
    if (!destPath) {
      console.error(`[storage] avatars: storage path escapes uploads dir, skipping user ${row.id}: ${storagePath}`)
      failed++
      continue
    }

    try {
      const { data, error } = await supabase.storage.from("avatars").download(storagePath)
      if (error || !data) {
        console.error(`[storage] avatars: download failed for user ${row.id}: ${error?.message ?? "no data"}`)
        failed++
        continue
      }

      mkdirSync(path.dirname(destPath), { recursive: true })
      writeFileSync(destPath, Buffer.from(await data.arrayBuffer()))
      update.run(`/api/avatars/${storagePath}`, row.id)
      migrated++
    } catch (err) {
      console.error(`[storage] avatars: unexpected error for user ${row.id}: ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  }

  return { migrated, failed }
}

async function migrateAttachmentTable(
  supabase: SupabaseStorageClient,
  db: Database.Database,
  uploadsDir: string,
  table: "attachments" | "dm_attachments",
): Promise<{ migrated: number; failed: number }> {
  const rows = db
    .prepare(`SELECT id, url FROM ${table} WHERE url LIKE '%supabase%' AND purged_at IS NULL`)
    .all() as Array<{ id: string; url: string }>
  const update = db.prepare(`UPDATE ${table} SET url = ? WHERE id = ?`)

  let migrated = 0
  let failed = 0
  for (const row of rows) {
    const storagePath = extractStoragePath(row.url, "attachments")
    if (!storagePath) {
      console.warn(`[storage] ${table}: could not parse URL for row ${row.id}`)
      failed++
      continue
    }

    const destPath = safeDestPath(uploadsDir, "attachments", storagePath)
    if (!destPath) {
      console.error(`[storage] ${table}: storage path escapes uploads dir, skipping row ${row.id}: ${storagePath}`)
      failed++
      continue
    }

    try {
      const { data, error } = await supabase.storage.from("attachments").download(storagePath)
      if (error || !data) {
        console.error(`[storage] ${table}: download failed for row ${row.id}: ${error?.message ?? "no data"}`)
        failed++
        continue
      }

      mkdirSync(path.dirname(destPath), { recursive: true })
      writeFileSync(destPath, Buffer.from(await data.arrayBuffer()))
      update.run(storagePath, row.id)
      migrated++
    } catch (err) {
      console.error(`[storage] ${table}: unexpected error for row ${row.id}: ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  }

  return { migrated, failed }
}

export async function migrateStorage(targetPath: string): Promise<Report> {
  const supabase = createSourceStorageClient()
  const db = new Database(targetPath)
  const uploadsDir = resolveUploadsDir()

  try {
    const avatars = await migrateAvatars(supabase, db, uploadsDir)
    const attachments = await migrateAttachmentTable(supabase, db, uploadsDir, "attachments")
    const dmAttachments = await migrateAttachmentTable(supabase, db, uploadsDir, "dm_attachments")
    return { avatars, attachments, dmAttachments }
  } finally {
    db.close()
  }
}

async function main() {
  const args = process.argv.slice(2)
  const targetArg = args.includes("--target") ? args[args.indexOf("--target") + 1] : undefined
  const targetPath = targetArg ?? resolveDbPath()

  console.log(`[storage] target database: ${targetPath}`)
  console.log(`[storage] uploads dir: ${resolveUploadsDir()}`)

  const report = await migrateStorage(targetPath)

  console.log(`[storage] avatars: ${report.avatars.migrated} migrated, ${report.avatars.failed} failed`)
  console.log(`[storage] attachments: ${report.attachments.migrated} migrated, ${report.attachments.failed} failed`)
  console.log(`[storage] dm_attachments: ${report.dmAttachments.migrated} migrated, ${report.dmAttachments.failed} failed`)

  const totalFailed = report.avatars.failed + report.attachments.failed + report.dmAttachments.failed
  if (totalFailed > 0) {
    console.error(`\n${totalFailed} file(s) failed to migrate — see warnings above.`)
    process.exitCode = 1
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
