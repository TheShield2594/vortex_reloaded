import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
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

export async function writeUploadFile(baseDir: string, key: string, data: Buffer): Promise<string> {
  const filePath = safeResolve(baseDir, key)
  if (!filePath) throw new Error(`Refusing to write outside of storage root: ${key}`)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, data)
  return filePath
}

export async function readUploadFile(baseDir: string, key: string): Promise<Buffer | null> {
  const filePath = safeResolve(baseDir, key)
  if (!filePath) return null
  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

export async function statUploadFile(baseDir: string, key: string): Promise<{ path: string; size: number } | null> {
  const filePath = safeResolve(baseDir, key)
  if (!filePath) return null
  try {
    const stats = await stat(filePath)
    return { path: filePath, size: stats.size }
  } catch {
    return null
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
