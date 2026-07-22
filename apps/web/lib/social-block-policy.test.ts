import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { deriveBlockedUserIds, filterBlockedUserIds, getBlockedUserIdsForViewer } from "@/lib/social-block-policy"

function createSupabaseFriendshipMock(rows: Array<{ requester_id: string; addressee_id: string; status: "pending" | "accepted" | "blocked" }>) {
  return {
    from(table: string) {
      if (table !== "friendships") throw new Error(`unexpected table ${table}`)
      const state = { status: "blocked" as string | null, viewer: "" }
      return {
        select() {
          return this
        },
        eq(column: string, value: string) {
          if (column === "status") state.status = value
          return this
        },
        or(expression: string) {
          const viewerMatch = expression.match(/requester_id\.eq\.([^,]+)/) ?? expression.match(/addressee_id\.eq\.([^,\)]+)/)
          if (viewerMatch?.[1]) state.viewer = viewerMatch[1]
          const data = rows.filter((row) => {
            if (state.status && row.status !== state.status) return false
            if (!state.viewer) return true
            return row.requester_id === state.viewer || row.addressee_id === state.viewer
          })
          return Promise.resolve({ data, error: null })
        },
      }
    },
  }
}

describe("social block policy transitions", () => {
  it("filters blocked users across search/mentions/suggestions surfaces", async () => {
    const supabase = createSupabaseFriendshipMock([
      { requester_id: "viewer", addressee_id: "blocked-user", status: "blocked" },
      { requester_id: "viewer", addressee_id: "friend", status: "accepted" },
    ])

    const blocked = await getBlockedUserIdsForViewer(supabase as unknown as SupabaseClient, "viewer", ["blocked-user", "friend"])
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
