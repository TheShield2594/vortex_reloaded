import { describe, expect, it } from "vitest"
import { validateChannelTypeMessagePolicy } from "@/lib/messages/channel-type-policy"

describe("message channel-type policy", () => {
  it("requires attachments in media channels", () => {
    const result = validateChannelTypeMessagePolicy({
      channelType: "media",
      hasSendPermission: true,
      content: "caption only",
      attachments: [],
    })

    expect(result).toEqual({ error: "Media channels require at least one attachment.", status: 400 })
  })

  it("allows forum posts with content", () => {
    const result = validateChannelTypeMessagePolicy({
      channelType: "forum",
      hasSendPermission: true,
      content: "new thread",
      attachments: [],
    })

    expect(result).toEqual({ error: null, status: 200 })
  })

  it("enforces SEND_MESSAGES regardless of channel type", () => {
    const result = validateChannelTypeMessagePolicy({
      channelType: "forum",
      hasSendPermission: false,
      content: "new thread",
      attachments: [],
    })

    expect(result).toEqual({ error: "Missing SEND_MESSAGES permission", status: 403 })
  })

  it("rejects empty text channel messages without attachments", () => {
    const result = validateChannelTypeMessagePolicy({
      channelType: "text",
      hasSendPermission: true,
      content: "   ",
      attachments: [],
    })

    expect(result).toEqual({ error: "Message must include content or an attachment.", status: 400 })
  })
})
