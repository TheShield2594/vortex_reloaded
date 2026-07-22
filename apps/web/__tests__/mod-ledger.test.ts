import { describe, expect, it } from "vitest"
import {
  applyTimelineFilters,
  mapActionType,
  paginateTimeline,
  sortTimelineEvents,
  type TimelineEvent,
} from "@/lib/mod-ledger"

function makeEvent(index: number, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  const createdAt = new Date(Date.UTC(2025, 0, 1, 12, 0, 0) + index * 1000).toISOString()
  return {
    id: `event-${index}`,
    action: "member_ban",
    action_type: mapActionType("member_ban"),
    created_at: createdAt,
    actor_id: index % 2 === 0 ? "actor-a" : "actor-b",
    target_id: index % 3 === 0 ? "target-a" : "target-b",
    target_type: "user",
    reason: null,
    metadata: null,
    actor: null,
    target: null,
    incident_key: `incident-${Math.floor(index / 10)}`,
    ...overrides,
  }
}

describe("moderation timeline helpers", () => {
  it("orders timeline events by created_at desc and id tie-break desc", () => {
    const sameTime = new Date().toISOString()
    const events = [
      makeEvent(2, { created_at: sameTime, id: "a" }),
      makeEvent(1, { created_at: sameTime, id: "z" }),
      makeEvent(5, { created_at: "2025-01-01T00:00:00.000Z", id: "m" }),
    ]

    const sorted = sortTimelineEvents(events)
    expect(sorted.map((e) => e.id)).toEqual(["z", "a", "m"])
  })

  it("applies actor/target/action/date range filters correctly", () => {
    const events = [
      makeEvent(1, { action: "member_ban", action_type: mapActionType("member_ban"), actor_id: "actor-1", target_id: "target-1", created_at: "2025-01-02T00:00:00.000Z" }),
      makeEvent(2, { action: "member_kick", action_type: mapActionType("member_kick"), actor_id: "actor-2", target_id: "target-1", created_at: "2025-01-03T00:00:00.000Z" }),
      makeEvent(3, { action: "automod_action", action_type: mapActionType("automod_action"), actor_id: "actor-1", target_id: "target-2", created_at: "2025-01-04T00:00:00.000Z" }),
    ]

    const filtered = applyTimelineFilters(events, {
      actorId: "actor-1",
      targetId: "target-2",
      actionTypes: ["automod"],
      from: "2025-01-04T00:00:00.000Z",
      to: "2025-01-04T23:59:59.999Z",
    })

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.id).toBe("event-3")
  })

  it("supports high-volume cursor pagination without duplicates", () => {
    const events = Array.from({ length: 1200 }, (_, i) => makeEvent(i))

    const seen = new Set<string>()
    let cursor: { created_at: string; id: string } | null = null
    let pageCount = 0

    while (true) {
      const { data, nextCursor } = paginateTimeline(events, 125, cursor)
      for (const event of data) {
        expect(seen.has(event.id)).toBe(false)
        seen.add(event.id)
      }

      pageCount += 1
      cursor = nextCursor
      if (!nextCursor) break
    }

    expect(seen.size).toBe(1200)
    expect(pageCount).toBeGreaterThan(5)
  })
})
