import { DANGEROUS_EXTENSIONS, EXECUTABLE_MIMES } from "@/lib/attachment-security-constants"

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const ALLOWED_MIME_PREFIXES = ["image/", "video/", "audio/"]
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/json",
])

/**
 * Client-side validation of a File object against allowed MIME types,
 * dangerous extensions, and size limits.  Returns an error string or null.
 */
export function validateFileClient(file: File): string | null {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    const maxMB = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))
    return `File too large (max ${maxMB} MB): ${file.name}`
  }

  const ext = file.name.split(".").pop()?.toLowerCase()
  if (ext && DANGEROUS_EXTENSIONS.has(ext)) {
    return `.${ext} files are blocked for safety.`
  }

  const mime = (file.type || "").toLowerCase()
  if (mime) {
    const mimeAllowed =
      ALLOWED_MIME_TYPES.has(mime) ||
      ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
    if (!mimeAllowed) {
      return `Unsupported file type: ${file.name} (${mime})`
    }
  }

  return null
}

/**
 * Magic bytes signatures for server-side MIME type detection.
 * Used to verify that a file's actual content matches its claimed extension/type.
 */
const MAGIC_BYTES: Array<{ bytes: number[]; offset: number; mime: string }> = [
  // Images
  { bytes: [0xFF, 0xD8, 0xFF], offset: 0, mime: "image/jpeg" },
  { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset: 0, mime: "image/png" },
  { bytes: [0x47, 0x49, 0x46, 0x38], offset: 0, mime: "image/gif" },
  { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8, mime: "image/webp" }, // "WEBP" at offset 8 in RIFF container
  // PDF
  { bytes: [0x25, 0x50, 0x44, 0x46], offset: 0, mime: "application/pdf" },
  // ZIP (also covers docx, xlsx, etc.)
  { bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0, mime: "application/zip" },
  // Video
  { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4, mime: "video/mp4" }, // "ftyp" box at offset 4
  { bytes: [0x1A, 0x45, 0xDF, 0xA3], offset: 0, mime: "video/webm" },
  // Audio
  { bytes: [0x49, 0x44, 0x33], offset: 0, mime: "audio/mpeg" }, // ID3 tag
  { bytes: [0xFF, 0xFB], offset: 0, mime: "audio/mpeg" }, // MPEG sync
  { bytes: [0x4F, 0x67, 0x67, 0x53], offset: 0, mime: "audio/ogg" },
  // Executables (to detect masquerading)
  { bytes: [0x4D, 0x5A], offset: 0, mime: "application/x-msdownload" }, // PE/MZ exe
  { bytes: [0x7F, 0x45, 0x4C, 0x46], offset: 0, mime: "application/x-elf" }, // ELF binary
]


/**
 * Map of file extension to expected MIME type prefixes for mismatch detection.
 * If a file claims to be .jpg but magic bytes say it is an executable, reject it.
 */
const EXTENSION_MIME_MAP: Record<string, string[]> = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  pdf: ["application/pdf"],
  mp4: ["video/mp4"],
  webm: ["video/webm"],
  mp3: ["audio/mpeg"],
  ogg: ["audio/ogg"],
  zip: ["application/zip"],
}

export interface AttachmentInput {
  url: string
  filename: string
  size: number
  content_type: string
  width?: number
  height?: number
}

export function validateAttachments(attachments: AttachmentInput[]): { valid: boolean; error?: string } {
  for (const attachment of attachments) {
    if (!attachment.url || !attachment.filename || !attachment.content_type) {
      return { valid: false, error: "Attachment metadata is incomplete." }
    }

    if (!Number.isFinite(attachment.size) || attachment.size <= 0 || attachment.size > MAX_ATTACHMENT_BYTES) {
      return { valid: false, error: `Attachment size must be between 1B and ${MAX_ATTACHMENT_BYTES} bytes.` }
    }

    const ext = attachment.filename.split(".").pop()?.toLowerCase()
    if (ext && DANGEROUS_EXTENSIONS.has(ext)) {
      return { valid: false, error: `.${ext} files are blocked for safety.` }
    }

    const mime = attachment.content_type.toLowerCase()
    const mimeAllowed = ALLOWED_MIME_TYPES.has(mime) || ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
    if (!mimeAllowed) {
      return { valid: false, error: `Unsupported attachment MIME type: ${attachment.content_type}` }
    }
  }

  return { valid: true }
}

/**
 * Detect MIME type from file content using magic bytes.
 * Returns the detected MIME type or null if no match is found.
 */
export function detectMimeFromBytes(buffer: Uint8Array): string | null {
  for (const sig of MAGIC_BYTES) {
    if (buffer.length < sig.offset + sig.bytes.length) continue
    let match = true
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[sig.offset + i] !== sig.bytes[i]) {
        match = false
        break
      }
    }
    if (match) return sig.mime
  }
  return null
}

/**
 * Server-side validation of attachment content using magic bytes.
 * Fetches the first bytes of each attachment URL and verifies:
 * 1. The detected MIME type is not an executable
 * 2. If the extension has a known MIME mapping, the actual content matches
 *
 * Returns { valid: true } if all attachments pass, or { valid: false, error } on failure.
 *
 * NOTE: This function should only be called server-side. It fetches attachment content
 * from signed URLs to inspect the file headers.
 */
export async function validateAttachmentContent(
  attachments: AttachmentInput[]
): Promise<{ valid: boolean; error?: string; failedFilename?: string }> {
  for (const attachment of attachments) {
    try {
      const HEADER_SIZE = 16
      const abortController = new AbortController()

      // Attempt range request first for efficiency
      const response = await fetch(attachment.url, {
        headers: { Range: "bytes=0-15" },
        signal: abortController.signal,
      })

      let headerBytes: Uint8Array

      if (response.ok && response.body) {
        // Whether the server returned 206 (partial) or 200 (full), stream only the header
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let totalRead = 0
        try {
          while (totalRead < HEADER_SIZE) {
            const { done, value } = await reader.read()
            if (done || !value) break
            chunks.push(value)
            totalRead += value.length
          }
        } finally {
          reader.cancel()
          abortController.abort()
        }
        headerBytes = new Uint8Array(HEADER_SIZE)
        let offset = 0
        for (const chunk of chunks) {
          const toCopy = Math.min(chunk.length, HEADER_SIZE - offset)
          headerBytes.set(chunk.subarray(0, toCopy), offset)
          offset += toCopy
        }
      } else if (!response.ok) {
        // Range request rejected — retry without Range header
        abortController.abort()
        const fallbackController = new AbortController()
        const fallbackResponse = await fetch(attachment.url, { signal: fallbackController.signal })
        if (!fallbackResponse.ok || !fallbackResponse.body) {
          return {
            valid: false,
            error: `Unable to verify attachment content: ${attachment.filename}`,
            failedFilename: attachment.filename,
          }
        }
        const reader = fallbackResponse.body.getReader()
        const chunks: Uint8Array[] = []
        let totalRead = 0
        try {
          while (totalRead < HEADER_SIZE) {
            const { done, value } = await reader.read()
            if (done || !value) break
            chunks.push(value)
            totalRead += value.length
          }
        } finally {
          reader.cancel()
          fallbackController.abort()
        }
        headerBytes = new Uint8Array(HEADER_SIZE)
        let offset = 0
        for (const chunk of chunks) {
          const toCopy = Math.min(chunk.length, HEADER_SIZE - offset)
          headerBytes.set(chunk.subarray(0, toCopy), offset)
          offset += toCopy
        }
      } else {
        // response.ok but no body — cannot verify
        return {
          valid: false,
          error: `Unable to verify attachment content: ${attachment.filename}`,
          failedFilename: attachment.filename,
        }
      }

      const result = checkBytes(headerBytes, attachment)
      if (!result.valid) return result
    } catch (err) {
      return {
        valid: false,
        error: `Unable to verify attachment content: ${attachment.filename}${err instanceof Error ? ` (${err.message})` : ""}`,
        failedFilename: attachment.filename,
      }
    }
  }

  return { valid: true }
}

function checkBytes(
  buffer: Uint8Array,
  attachment: AttachmentInput
): { valid: boolean; error?: string; failedFilename?: string } {
  const detectedMime = detectMimeFromBytes(buffer)

  // Block executables masquerading as other file types
  if (detectedMime && EXECUTABLE_MIMES.has(detectedMime)) {
    return {
      valid: false,
      error: `File "${attachment.filename}" appears to be an executable and has been rejected for safety.`,
      failedFilename: attachment.filename,
    }
  }

  // Check extension/content mismatch
  const ext = attachment.filename.split(".").pop()?.toLowerCase()
  if (ext && detectedMime && EXTENSION_MIME_MAP[ext]) {
    const expectedMimes = EXTENSION_MIME_MAP[ext]
    if (!expectedMimes.some((expected) => detectedMime.startsWith(expected))) {
      return {
        valid: false,
        error: `File "${attachment.filename}" content does not match its extension (.${ext}). Detected: ${detectedMime}`,
        failedFilename: attachment.filename,
      }
    }
  }

  return { valid: true }
}
