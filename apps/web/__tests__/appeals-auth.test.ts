import { describe, expect, it } from "vitest"
import { computeAntiAbuseScore, sanitizeEvidenceAttachments } from "../lib/appeals"

describe("appeal anti-abuse and payload boundaries", () => {
  it("caps attachment list to 10 and removes non-strings", () => {
    const attachments = sanitizeEvidenceAttachments([
      "https://a.test",
      "javascript:alert(1)",
      "not-a-url",
      "",
      3,
      ...new Array(20).fill("https://evidence.test"),
    ])

    expect(attachments.length).toBe(10)
    expect(attachments.every((item) => typeof item === "string")).toBe(true)
    expect(attachments.some((item) => item.startsWith("javascript:"))).toBe(false)
  })

  it("produces higher anti-abuse scores for suspicious appeals", () => {
    const normal = computeAntiAbuseScore({
      statement: "I understand the rules and I am requesting another review for context and evidence.",
      evidenceAttachments: ["https://a.test"],
      recentAppealCount: 0,
    })

    const suspicious = computeAntiAbuseScore({
      statement: "pls",
      evidenceAttachments: new Array(9).fill("https://spam.test"),
      recentAppealCount: 5,
    })

    expect(suspicious).toBeGreaterThan(normal)
    expect(suspicious).toBeGreaterThanOrEqual(50)
  })
})
