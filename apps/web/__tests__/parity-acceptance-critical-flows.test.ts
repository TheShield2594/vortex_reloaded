import { describe, expect, it } from "vitest"
import { computePermissions, hasPermission, PERMISSIONS } from "@vortex/shared"
import { validateChannelTypeMessagePolicy } from "@/lib/messages/channel-type-policy"
import { evaluateAllRules, shouldBlockMessage } from "@/lib/automod"

describe("parity acceptance critical flows", () => {
  it("message lifecycle: enforces media channel attachment policy", () => {
    const blocked = validateChannelTypeMessagePolicy({
      channelType: "media",
      hasSendPermission: true,
      content: "",
      attachments: [],
    })
    const accepted = validateChannelTypeMessagePolicy({
      channelType: "media",
      hasSendPermission: true,
      content: "release notes",
      attachments: [{
        url: "https://cdn.test/asset.png",
        filename: "asset.png",
        size: 1024,
        content_type: "image/png",
      }],
    })

    expect(blocked.status).toBe(400)
    expect(accepted.status).toBe(200)
  })

  it("permissions: honors CONNECT_VOICE and SPEAK bits", () => {
    const permissions = computePermissions([PERMISSIONS.VIEW_CHANNELS, PERMISSIONS.CONNECT_VOICE])
    expect(hasPermission(permissions, "CONNECT_VOICE")).toBe(true)
    expect(hasPermission(permissions, "SPEAK")).toBe(false)
  })

  it("moderation: blocks messages when automod rule triggers", () => {
    const violations = evaluateAllRules(
      [{
        id: "rule-1",
        name: "Block invite links",
        enabled: true,
        trigger_type: "keyword_filter",
        config: { keywords: ["discord.gg"], regex_patterns: [] },
        actions: [{ type: "block_message" }],
        conditions: null,
        priority: 1,
      }] as any,
      "join us on discord.gg/private"
    )

    expect(violations).toHaveLength(1)
    expect(shouldBlockMessage(violations)).toBe(true)
  })
})
