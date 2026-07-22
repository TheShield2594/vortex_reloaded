import { NextResponse } from "next/server"

export type MessageAttachment = {
  url: string
  filename: string
  size: number
  content_type: string
  width?: number
  height?: number
}

export type PostMessageRequestBody = {
  channelId: string
  content?: string
  replyToId?: string
  mentions?: string[]
  mentionRoleIds?: string[]
  mentionEveryone?: boolean
  attachments?: MessageAttachment[]
  clientNonce?: string
}

export function parsePostMessageRequestBody(body: PostMessageRequestBody) {
  const {
    channelId,
    content,
    replyToId,
    mentions: rawMentions,
    mentionRoleIds: rawMentionRoleIds,
    mentionEveryone = false,
    attachments: rawAttachments,
    clientNonce,
  } = body

  const mentions = rawMentions ?? []
  const mentionRoleIds = rawMentionRoleIds ?? []
  const attachments = rawAttachments ?? []

  if (!Array.isArray(mentions)) {
    return { error: NextResponse.json({ error: "Invalid mentions" }, { status: 400 }) }
  }
  if (!Array.isArray(mentionRoleIds)) {
    return { error: NextResponse.json({ error: "Invalid mentionRoleIds" }, { status: 400 }) }
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!mentionRoleIds.every((id: unknown) => typeof id === "string" && uuidPattern.test(id))) {
    return { error: NextResponse.json({ error: "Invalid mentionRoleIds elements" }, { status: 400 }) }
  }
  if (!Array.isArray(attachments)) {
    return { error: NextResponse.json({ error: "Invalid attachments" }, { status: 400 }) }
  }
  if (!mentions.every((mention) => typeof mention === "string" && mention.trim().length > 0)) {
    return { error: NextResponse.json({ error: "Invalid mention elements" }, { status: 400 }) }
  }
  if (!attachments.every((attachment) => {
    if (!attachment || typeof attachment !== "object") return false
    const candidate = attachment as Record<string, unknown>
    return (
      typeof candidate.url === "string"
      && typeof candidate.filename === "string"
      && typeof candidate.size === "number"
      && typeof candidate.content_type === "string"
    )
  })) {
    return { error: NextResponse.json({ error: "Invalid attachment elements" }, { status: 400 }) }
  }

  if (!channelId) {
    return { error: NextResponse.json({ error: "channelId required" }, { status: 400 }) }
  }
  if (clientNonce !== undefined && (typeof clientNonce !== "string" || clientNonce.trim().length < 6 || clientNonce.trim().length > 100)) {
    return { error: NextResponse.json({ error: "Invalid clientNonce" }, { status: 400 }) }
  }
  if (!content?.trim() && attachments.length === 0) {
    return { error: NextResponse.json({ error: "Message must have content or attachments" }, { status: 400 }) }
  }

  return {
    payload: {
      channelId,
      content,
      replyToId,
      mentions,
      mentionRoleIds,
      mentionEveryone,
      attachments,
      clientNonce,
    },
  }
}
