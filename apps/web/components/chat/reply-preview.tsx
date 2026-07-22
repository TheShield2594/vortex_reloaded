"use client"

/**
 * Simplified reply-preview renderer.
 *
 * Strips all rich content (embeds, attachments, code blocks, images) and
 * truncates to a safe character limit so reply references stay compact and
 * cheap to render.
 */

const REPLY_PREVIEW_MAX_LENGTH = 128

/** Strip markdown formatting, embeds, and code blocks — returns plain text. */
function stripMarkdown(text: string): string {
  return (
    text
      // Remove fenced code blocks
      .replace(/```[\s\S]*?```/g, "[code]")
      // Remove inline code
      .replace(/`[^`\n]+`/g, "[code]")
      // Remove spoilers markers
      .replace(/\|\|([\s\S]*?)\|\|/g, "[spoiler]")
      // Remove bold / italic / underline / strikethrough markers (keep inner text)
      .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
      .replace(/\*([\s\S]*?)\*/g, "$1")
      .replace(/__([\s\S]*?)__/g, "$1")
      .replace(/~~([\s\S]*?)~~/g, "$1")
      // Remove URLs (keep display text)
      .replace(/https?:\/\/\S+/g, "[link]")
      // Remove [POLL] blocks
      .replace(/\[POLL\][\s\S]*?\[\/POLL\]/gi, "[poll]")
      // Remove custom emoji markers (keep :name:)
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
  )
}

/** Returns a truncated, plain-text preview of a message suitable for reply references. */
export function getReplyPreviewText(content: string | null): string {
  if (!content) return "Message unavailable"
  const stripped = stripMarkdown(content)
  if (stripped.length <= REPLY_PREVIEW_MAX_LENGTH) return stripped
  return stripped.slice(0, REPLY_PREVIEW_MAX_LENGTH) + "…"
}
