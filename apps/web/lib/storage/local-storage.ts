import { randomUUID } from "node:crypto"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { resolveUploadsDir } from "@vortex/db"

/**
 * Local disk storage for avatars/attachments (issue #10) — replaces the
 * Supabase `avatars`/`attachments` buckets. Files live under the same
 * mounted volume as the SQLite file (see db-path.ts's `resolveUploadsDir`).
 */

export function avatarsDir(): string {
  return path.join(resolveUploadsDir(), "avatars")
}

export function attachmentsDir(): string {
  return path.join(resolveUploadsDir(), "attachments")
}

/**
 * Resolve `key` against `baseDir`, rejecting any key that would escape it
 * (`..` segments, absolute paths). `key` is either a client-supplied path
 * segment (avatar routes) or a DB column value (attachment download/decay
 * routes) — neither is trustworthy enough to join into a filesystem path
 * without this check.
 */
export function safeResolve(baseDir: string, key: string): string | null {
  if (!key || key.includes("\0")) return null
  const resolved = path.resolve(baseDir, key)
  const relative = path.relative(baseDir, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null
  return resolved
}

/**
 * Writes via a uniquely-named temp file in the same directory, then renames
 * it into place — a concurrent reader (e.g. a GET racing an avatar
 * replacement) never observes a partially-written file, since rename is
 * atomic on the same filesystem.
 */
export async function writeUploadFile(baseDir: string, key: string, data: Buffer): Promise<string> {
  const filePath = safeResolve(baseDir, key)
  if (!filePath) throw new Error(`Refusing to write outside of storage root: ${key}`)
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tempPath = path.join(dir, `.upload-${randomUUID()}.tmp`)
  try {
    await writeFile(tempPath, data)
    await rename(tempPath, filePath)
  } catch (err) {
    await rm(tempPath, { force: true })
    throw err
  }
  return filePath
}

/** True if `err` is a Node filesystem error with the given `code` (e.g. "ENOENT"). */
function isFsErrorCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === code
}

export async function statUploadFile(baseDir: string, key: string): Promise<{ path: string; size: number } | null> {
  const filePath = safeResolve(baseDir, key)
  if (!filePath) return null
  try {
    const stats = await stat(filePath)
    return { path: filePath, size: stats.size }
  } catch (err) {
    if (isFsErrorCode(err, "ENOENT")) return null
    throw err
  }
}

/** Delete a file if present. Missing files are not an error — decay/cron jobs may race with a prior purge. */
export async function deleteUploadFile(baseDir: string, key: string): Promise<void> {
  const filePath = safeResolve(baseDir, key)
  if (!filePath) return
  await rm(filePath, { force: true })
}

/** Remove every file matching an avatar's base name (any allowed extension) before writing a new one. */
export async function removeAvatarVariants(userId: string, exts: readonly string[]): Promise<void> {
  await Promise.all(exts.map((ext) => deleteUploadFile(avatarsDir(), `${userId}/avatar.${ext}`)))
}
