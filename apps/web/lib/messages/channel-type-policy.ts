import type { MessageAttachment } from "@/lib/messages/validators"

export type SupportedMessageChannelType = "text" | "announcement" | "forum" | "media"

export function validateChannelTypeMessagePolicy({
  channelType,
  hasSendPermission,
  content,
  attachments,
}: {
  channelType: SupportedMessageChannelType
  hasSendPermission: boolean
  content?: string
  attachments: MessageAttachment[]
}) {
  if (!hasSendPermission) {
    return { error: "Missing SEND_MESSAGES permission", status: 403 }
  }

  if (channelType === "media" && attachments.length === 0) {
    return { error: "Media channels require at least one attachment.", status: 400 }
  }

  if (!content?.trim() && attachments.length === 0) {
    return { error: "Message must include content or an attachment.", status: 400 }
  }

  return { error: null as string | null, status: 200 }
}
