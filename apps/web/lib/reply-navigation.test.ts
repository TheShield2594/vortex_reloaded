import { describe, expect, it } from "vitest"
import { buildReplyJumpPath, shouldHandleReturnToContextShortcut } from "@/lib/reply-navigation"

describe("reply navigation", () => {
  it("builds a jump path while preserving unrelated params", () => {
    const path = buildReplyJumpPath("/channels/s1/c1", "thread=t1&foo=bar", "m-42")
    expect(path).toBe("/channels/s1/c1?foo=bar&message=m-42")
  })

  it("adds the message query when no existing params are present", () => {
    const path = buildReplyJumpPath("/channels/s1/c1", "", "m-42")
    expect(path).toBe("/channels/s1/c1?message=m-42")
  })

  it("only handles bare escape for return-to-context", () => {
    expect(shouldHandleReturnToContextShortcut(true, { key: "Escape" })).toBe(true)
    expect(shouldHandleReturnToContextShortcut(false, { key: "Escape" })).toBe(false)
    expect(shouldHandleReturnToContextShortcut(true, { key: "Escape", metaKey: true })).toBe(false)
    expect(shouldHandleReturnToContextShortcut(true, { key: "Enter" })).toBe(false)
  })
})
