import { describe, expect, it } from "vitest"
import { deriveBlockedUserIds, filterBlockedUserIds } from "@/lib/social-block-policy"

describe("social block policy transitions", () => {
  it("filters blocked users across search/mentions/suggestions surfaces", () => {
    const blocked = deriveBlockedUserIds("viewer", [
      { requester_id: "viewer", addressee_id: "blocked-user", status: "blocked" },
      { requester_id: "viewer", addressee_id: "friend", status: "accepted" },
    ])
    expect(blocked.has("blocked-user")).toBe(true)
    expect(blocked.has("friend")).toBe(false)

    const mentionCandidates = ["blocked-user", "friend"]
    expect(mentionCandidates.filter((id) => !blocked.has(id))).toEqual(["friend"])

    const previewCards = [{ author_id: "blocked-user" }, { author_id: "friend" }]
    expect(filterBlockedUserIds(previewCards, (card) => card.author_id, blocked)).toEqual([{ author_id: "friend" }])
  })

  it("allows users again after blocked -> accepted transition", () => {
    const before = deriveBlockedUserIds("viewer", [
      { requester_id: "viewer", addressee_id: "target", status: "blocked" },
    ])
    const after = deriveBlockedUserIds("viewer", [
      { requester_id: "viewer", addressee_id: "target", status: "accepted" },
    ])

    const candidates = [{ id: "target" }]
    expect(filterBlockedUserIds(candidates, (user) => user.id, before)).toEqual([])
    expect(filterBlockedUserIds(candidates, (user) => user.id, after)).toEqual(candidates)
  })
})
