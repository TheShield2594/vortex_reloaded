import { DANGEROUS_EXTENSIONS } from "@/lib/attachment-security-constants"

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
