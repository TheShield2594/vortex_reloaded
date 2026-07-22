import { NextRequest, NextResponse } from "next/server"

/** Maximum length for shared text to keep redirect URLs under browser limits. */
const MAX_SHARE_TEXT_LENGTH = 1000
const MAX_SHARE_URL_LENGTH = 2000
const MAX_SHARE_TITLE_LENGTH = 200

/** Strip control characters (except newlines) from a string. */
function sanitize(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
}

/** Type-safe extraction of a string field from FormData (rejects File values). */
function getStringField(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  if (value === null) return null
  if (typeof value === "string") return value
  // FormData.get() can return a File object — reject it for string fields
  return null
}

/** Validate that a URL string is a valid http/https URL. Returns the normalized URL or null. */
function validateUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    const normalized = parsed.href
    return normalized.length > MAX_SHARE_URL_LENGTH ? normalized.slice(0, MAX_SHARE_URL_LENGTH) : normalized
  } catch {
    return null
  }
}

/**
 * Web Share Target handler.
 * Receives shared content from the OS share sheet and redirects to the chat view.
 *
 * NOTE: File sharing is not yet implemented. The manifest share_target accepts
 * files so the OS share sheet shows VortexChat for media, but this handler
 * currently redirects with a flag rather than persisting the files.
 * TODO: Upload shared files to blob storage and include references in the
 * redirect URL so the chat input can attach them.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData()
    const title = getStringField(formData, "title")
    const text = getStringField(formData, "text")
    const url = getStringField(formData, "url")
    const files = formData.getAll("media")

    const baseUrl = new URL("/channels/me", req.url)

    if (files.length > 0) {
      // TODO: Upload files to blob storage and pass references in the redirect URL.
      // For now, redirect with a flag so the UI can show a "file sharing coming soon" message.
      baseUrl.searchParams.set("share_files", "1")
      return NextResponse.redirect(baseUrl, 303)
    }

    if (text) {
      const truncated = text.length > MAX_SHARE_TEXT_LENGTH
        ? text.slice(0, MAX_SHARE_TEXT_LENGTH)
        : text
      baseUrl.searchParams.set("share_text", sanitize(truncated))
    }
    if (url) {
      const validUrl = validateUrl(url)
      if (validUrl) {
        baseUrl.searchParams.set("share_url", validUrl)
      }
    }
    if (title) {
      const truncatedTitle = title.length > MAX_SHARE_TITLE_LENGTH
        ? title.slice(0, MAX_SHARE_TITLE_LENGTH)
        : title
      baseUrl.searchParams.set("share_title", sanitize(truncatedTitle))
    }

    return NextResponse.redirect(baseUrl, 303)
  } catch (err) {
    const isClientError = err instanceof TypeError || err instanceof RangeError
    const status = isClientError ? 400 : 500
    const message = isClientError ? "Invalid shared content" : "Failed to process shared content"
    console.error("[api/share] Failed to process shared content:", err)
    return NextResponse.json({ error: message }, { status })
  }
}
