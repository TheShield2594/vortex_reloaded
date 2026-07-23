import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { NextRequest, NextResponse } from "next/server"
import { avatarsDir, statUploadFile } from "@/lib/storage/local-storage"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FILENAME_RE = /^avatar\.(jpg|jpeg|png|gif|webp)$/

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
}

/**
 * GET /api/avatars/[userId]/[filename]
 *
 * Serves avatar files from local disk. Public, no auth — mirrors the old
 * Supabase `avatars` bucket, which was public too.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; filename: string }> }
): Promise<NextResponse> {
  try {
    const { userId, filename } = await params

    if (!UUID_RE.test(userId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const match = FILENAME_RE.exec(filename)
    if (!match) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const key = `${userId}/${filename}`
    const file = await statUploadFile(avatarsDir(), key)
    if (!file) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream

    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": EXT_TO_CONTENT_TYPE[match[1].toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(file.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch (err) {
    console.error("avatars: unexpected error", { error: err })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
