import { NextRequest, NextResponse } from "next/server"
import { detectMimeFromBytes } from "@/lib/attachment-validation"
import { requireAuth } from "@/lib/utils/api-helpers"

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
    const { supabase, user, error: authError } = await requireAuth()
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
    const storagePath = `${user.id}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(storagePath, avatarFile, { upsert: true })

    if (uploadError) {
      return NextResponse.json(
        { error: "Avatar upload failed" },
        { status: 500 },
      )
    }

    // Get the public URL with cache-busting query param
    const { data: urlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(storagePath)

    const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`

    // Update the user's avatar_url in the database
    const { data: updatedUser, error: dbError } = await supabase
      .from("users")
      .update({ avatar_url: avatarUrl })
      .eq("id", user.id)
      .select()
      .single()

    if (dbError) {
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

    return NextResponse.json(updatedUser)
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
