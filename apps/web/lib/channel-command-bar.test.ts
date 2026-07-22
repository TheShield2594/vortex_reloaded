import { describe, expect, it } from "vitest"
import { resolveCommandBarLayout, type CommandActionDescriptor } from "@/lib/channel-command-bar"

const ACTIONS: CommandActionDescriptor[] = [
  { id: "search", group: "search", priority: 1 },
  { id: "pins", group: "pins", priority: 2 },
  { id: "threads", group: "threads", priority: 3 },
  { id: "inbox", group: "inbox", priority: 4 },
  { id: "voice", group: "voice", priority: 5 },
  { id: "help", group: "help", priority: 6 },
  { id: "members", group: "threads", priority: 7 },
  { id: "summary", group: "help", priority: 8 },
]

describe("resolveCommandBarLayout", () => {
  it("keeps all actions visible on ultra-wide desktop", () => {
    const layout = resolveCommandBarLayout(1600, ACTIONS)
    expect(layout.visibleActionIds).toEqual(["search", "pins", "threads", "inbox", "voice", "help", "members", "summary"])
    expect(layout.overflowActionIds).toEqual([])
  })

  it("moves lower-priority actions into overflow on large desktop", () => {
    const layout = resolveCommandBarLayout(1200, ACTIONS)
    expect(layout.visibleActionIds).toEqual(["search", "pins", "threads", "inbox", "voice", "help"])
    expect(layout.overflowActionIds).toEqual(["members", "summary"])
  })

  it("shows only top priorities on tablet widths", () => {
    const layout = resolveCommandBarLayout(820, ACTIONS)
    expect(layout.visibleActionIds).toEqual(["search", "pins", "threads", "inbox", "voice"])
    expect(layout.overflowActionIds).toEqual(["help", "members", "summary"])
  })
})
