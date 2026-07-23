import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { createDb, users } from "@vortex/db"
import { detectMimeFromBytes } from "@/lib/attachment-validation"
import { requireAuth } from "@/lib/utils/api-helpers"
import { avatarsDir, removeAvatarVariants, writeUploadFile } from "@/lib/storage/local-storage"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()

const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]
const ALLOWED_AVATAR_EXTS = ["jpg", "jpeg", "png", "gif", "webp"]
const MAX_AVATAR_SIZE = 5 * 1024 * 1024 // 5 MB

/**
 * POST /api/users/avatar
 *
 * Upload or replace the authenticated user's avatar.
 * Accepts multipart form-data with an `avatar` file field.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const contentType = req.headers.get("content-type") ?? ""
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Request must be multipart/form-data" },
        { status: 400 },
      )
    }

    const formData = await req.formData()
    const avatarVal = formData.get("avatar")

    if (!(avatarVal instanceof File) || avatarVal.size === 0) {
      return NextResponse.json(
        { error: "An avatar file is required" },
        { status: 400 },
      )
    }

    const avatarFile = avatarVal

    // Validate MIME type
    if (!ALLOWED_AVATAR_TYPES.includes(avatarFile.type)) {
      return NextResponse.json(
        { error: "Avatar must be PNG, JPEG, GIF, or WebP" },
        { status: 400 },
      )
    }

    // Validate file extension
    const rawExt = (avatarFile.name.split(".").pop() ?? "").toLowerCase()
    if (!ALLOWED_AVATAR_EXTS.includes(rawExt)) {
      return NextResponse.json(
        { error: "Avatar file extension not allowed" },
        { status: 400 },
      )
    }

    // Validate file size
    if (avatarFile.size > MAX_AVATAR_SIZE) {
      return NextResponse.json(
        { error: "Avatar must be 5 MB or smaller" },
        { status: 400 },
      )
    }

    // Verify magic bytes match claimed type — reject unknown signatures
    const headerSlice = avatarFile.slice(0, 16)
    const headerBytes = new Uint8Array(await headerSlice.arrayBuffer())
    const detectedMime = detectMimeFromBytes(headerBytes)
    if (!detectedMime || !ALLOWED_AVATAR_TYPES.includes(detectedMime)) {
      return NextResponse.json(
        { error: "Avatar file content does not match an allowed image type" },
        { status: 400 },
      )
    }

    // Derive extension from detected MIME, not from client filename
    const mimeToExt: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
    }
    const ext = mimeToExt[detectedMime] ?? "png"
    const storageKey = `${user.id}/avatar.${ext}`

    try {
      // Write the new file first, then prune stale variants with other
      // extensions — if pruning happened first and the write then failed,
      // the user would be left with no avatar file at all.
      const bytes = Buffer.from(await avatarFile.arrayBuffer())
      await writeUploadFile(avatarsDir(), storageKey, bytes)
      await removeAvatarVariants(user.id, ALLOWED_AVATAR_EXTS.filter((otherExt) => otherExt !== ext))
    } catch {
      return NextResponse.json(
        { error: "Avatar upload failed" },
        { status: 500 },
      )
    }

    // Cache-busting query param since the URL path itself is stable per user
    const avatarUrl = `/api/avatars/${storageKey}?t=${Date.now()}`

    // Update the user's avatar_url in the database
    let updatedUser: typeof users.$inferSelect | undefined
    try {
      const rows = await db
        .update(users)
        .set({ avatarUrl })
        .where(eq(users.id, user.id))
        .returning()
      updatedUser = rows[0]
    } catch {
      return NextResponse.json(
        { error: "Failed to update avatar URL" },
        { status: 500 },
      )
    }

    if (!updatedUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 },
      )
    }

    return NextResponse.json(toSnakeCase(updatedUser))
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
