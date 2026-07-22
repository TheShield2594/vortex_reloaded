import sharp from "sharp"
import { createServiceRoleClient } from "@/lib/supabase/server"

/** Supported image MIME types for processing */
const PROCESSABLE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
])

/** Variant dimensions */
const THUMBNAIL_WIDTH = 200
const STANDARD_WIDTH = 1200
const BLUR_SIZE = 16 // tiny image for blur placeholder

export interface ImageVariant {
  path: string
  width: number
  height: number
  size: number
}

export interface ProcessingResult {
  blurHash: string // base64-encoded tiny WEBP (~50-200 bytes)
  variants: {
    thumbnail?: ImageVariant
    standard?: ImageVariant
  }
  originalWidth: number
  originalHeight: number
}

/** Check if a content type is processable */
export function isProcessableImage(contentType: string): boolean {
  return PROCESSABLE_TYPES.has(contentType)
}

/**
 * Process an uploaded image: generate blur placeholder, thumbnail, and standard variants.
 * Uploads variants to Supabase Storage and returns metadata.
 *
 * @param storagePath - The original file's path in the attachments bucket
 * @param contentType - MIME type of the original image
 */
export async function processImage(
  storagePath: string,
  contentType: string,
): Promise<ProcessingResult> {
  const supabase = await createServiceRoleClient()

  // Download the original image from storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("attachments")
    .download(storagePath)

  if (downloadError || !fileData) {
    throw new Error(`Failed to download image for processing: ${downloadError?.message ?? "no data"}`)
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())
  const image = sharp(buffer)
  const metadata = await image.metadata()

  const originalWidth = metadata.width ?? 0
  const originalHeight = metadata.height ?? 0

  if (originalWidth === 0 || originalHeight === 0) {
    throw new Error("Could not determine image dimensions")
  }

  // Derive the base path (without extension) for variants
  const lastDot = storagePath.lastIndexOf(".")
  const basePath = lastDot > 0 ? storagePath.slice(0, lastDot) : storagePath

  // 1. Generate blur placeholder — tiny WEBP encoded as base64 data URI
  const blurBuffer = await sharp(buffer)
    .resize(BLUR_SIZE, BLUR_SIZE, { fit: "inside" })
    .webp({ quality: 20 })
    .toBuffer()
  const blurHash = `data:image/webp;base64,${blurBuffer.toString("base64")}`

  const variants: ProcessingResult["variants"] = {}

  // 2. Generate thumbnail (200px wide, WEBP) — only if original is larger
  if (originalWidth > THUMBNAIL_WIDTH) {
    const thumbBuffer = await sharp(buffer)
      .resize(THUMBNAIL_WIDTH, undefined, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer()

    const thumbMeta = await sharp(thumbBuffer).metadata()
    const thumbPath = `${basePath}_thumb.webp`

    const { error: thumbUploadError } = await supabase.storage
      .from("attachments")
      .upload(thumbPath, thumbBuffer, {
        contentType: "image/webp",
        upsert: true,
      })

    if (thumbUploadError) {
      console.error(`Failed to upload thumbnail variant for ${storagePath} (${contentType}):`, thumbUploadError.message)
    } else {
      variants.thumbnail = {
        path: thumbPath,
        width: thumbMeta.width ?? THUMBNAIL_WIDTH,
        height: thumbMeta.height ?? 0,
        size: thumbBuffer.length,
      }
    }
  }

  // 3. Generate standard variant (1200px wide, WEBP) — only if original is larger
  if (originalWidth > STANDARD_WIDTH) {
    const stdBuffer = await sharp(buffer)
      .resize(STANDARD_WIDTH, undefined, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()

    const stdMeta = await sharp(stdBuffer).metadata()
    const stdPath = `${basePath}_standard.webp`

    const { error: stdUploadError } = await supabase.storage
      .from("attachments")
      .upload(stdPath, stdBuffer, {
        contentType: "image/webp",
        upsert: true,
      })

    if (stdUploadError) {
      console.error(`Failed to upload standard variant for ${storagePath} (${contentType}):`, stdUploadError.message)
    } else {
      variants.standard = {
        path: stdPath,
        width: stdMeta.width ?? STANDARD_WIDTH,
        height: stdMeta.height ?? 0,
        size: stdBuffer.length,
      }
    }
  }

  return {
    blurHash,
    variants,
    originalWidth,
    originalHeight,
  }
}

/**
 * Process an attachment image and update the database record with variant info.
 * This is a fire-and-forget operation — failures are logged but do not block.
 */
export async function processAttachmentImage(
  attachmentId: string,
  storagePath: string,
  contentType: string,
): Promise<void> {
  const supabase = await createServiceRoleClient()

  try {
    // Mark as processing — abort if the attachment was deleted or update fails
    const { error: markProcessingError } = await supabase
      .from("attachments")
      .update({ processing_state: "processing" })
      .eq("id", attachmentId)

    if (markProcessingError) {
      console.error(`processAttachmentImage: failed to mark as processing ${attachmentId}`, markProcessingError.message)
      return
    }

    const result = await processImage(storagePath, contentType)

    // Update the attachment record with variants and blur hash
    const { error: updateError } = await supabase
      .from("attachments")
      .update({
        blur_hash: result.blurHash,
        variants: JSON.parse(JSON.stringify(result.variants)),
        width: result.originalWidth,
        height: result.originalHeight,
        processing_state: "completed",
      })
      .eq("id", attachmentId)

    if (updateError) {
      console.error(`processAttachmentImage: failed to update attachment ${attachmentId}`, updateError.message)
    }
  } catch (err) {
    console.error(`processAttachmentImage: failed for attachment ${attachmentId}`, err)
    await supabase
      .from("attachments")
      .update({ processing_state: "failed" })
      .eq("id", attachmentId)
      .then(({ error: markError }) => {
        if (markError) console.error(`processAttachmentImage: failed to mark as failed ${attachmentId}`, markError.message)
      })
  }
}
