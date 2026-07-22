import { describe, expect, it } from "vitest"

import { getAutoExpandedCategoryIds, resolveExpandedCategoryIds } from "@/components/layout/channel-sidebar"

function makeChannel(id: string, parentId?: string | null) {
  return {
    id,
    parent_id: parentId ?? null,
    name: id,
    type: parentId === undefined ? "category" : "text",
    position: 0,
  } as any
}

describe("sidebar navigation regression", () => {
  it("auto-expands active, voice, and unread categories in stable priority order", () => {
    const channels = [
      makeChannel("cat-a"),
      makeChannel("cat-b"),
      makeChannel("cat-c"),
      makeChannel("a-1", "cat-a"),
      makeChannel("b-1", "cat-b"),
      makeChannel("c-1", "cat-c"),
    ]

    const expanded = getAutoExpandedCategoryIds(
      channels,
      "b-1",
      new Set(["c-1"]),
      "a-1"
    )

    expect(Array.from(expanded)).toEqual(["cat-b", "cat-a", "cat-c"])
  })

  it("honors explicit collapse/expand overrides to preserve dense-tree context", () => {
    const result = resolveExpandedCategoryIds(
      ["cat-a", "cat-b", "cat-c"],
      new Set(["cat-a", "cat-b"]),
      { "cat-a": false, "cat-c": true }
    )

    expect(Array.from(result)).toEqual(["cat-b", "cat-c"])
  })

  it("bounds auto-expansion for large server trees", () => {
    const channels = Array.from({ length: 40 }).flatMap((_, index) => {
      const categoryId = `cat-${index}`
      return [makeChannel(categoryId), makeChannel(`chan-${index}`, categoryId)]
    })

    const unread = new Set(Array.from({ length: 40 }, (_, index) => `chan-${index}`))
    const expanded = getAutoExpandedCategoryIds(channels, null, unread, null)

    expect(expanded.size).toBeLessThanOrEqual(18)
  })
})
