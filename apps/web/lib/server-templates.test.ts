import { describe, expect, it } from "vitest"
import { validateAndNormalizeTemplate } from "@/lib/server-templates"

const baseTemplate = {
  metadata: { source: "test", version: "1", created_by: "qa" },
  roles: [{ name: "@everyone", permissions: ["VIEW_CHANNELS", "SEND_MESSAGES"], is_default: true }],
  categories: [{ name: "General" }],
  channels: [{ name: "chat", category: "General", type: "text" }],
}

describe("validateAndNormalizeTemplate", () => {
  it("rejects malformed template", () => {
    const result = validateAndNormalizeTemplate({ nope: true })
    expect(result.template).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("handles large templates", () => {
    const large = {
      ...baseTemplate,
      channels: Array.from({ length: 300 }, (_, i) => ({ name: `ch-${i}`, type: "text" })),
    }
    const result = validateAndNormalizeTemplate(large)
    expect(result.errors).toEqual([])
    expect(result.template?.channels).toHaveLength(300)
  })

  it("is idempotent for normalized output", () => {
    const first = validateAndNormalizeTemplate(baseTemplate)
    const second = validateAndNormalizeTemplate(first.template)
    expect(second.errors).toEqual([])
    expect(second.template).toEqual(first.template)
  })
})
