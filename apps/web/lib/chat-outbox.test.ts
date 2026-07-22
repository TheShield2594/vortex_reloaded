import { describe, expect, it } from "vitest"
import {
  getDraft,
  loadOutbox,
  removeOutboxEntry,
  resolveReplayOrder,
  saveOutbox,
  setDraft,
  updateOutboxStatus,
  upsertOutboxEntry,
  type OutboxEntry,
} from "./chat-outbox"

function buildEntry(partial: Partial<OutboxEntry>): OutboxEntry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    channelId: partial.channelId ?? "channel-1",
    authorId: partial.authorId ?? "user-1",
    content: partial.content ?? "hello",
    replyToId: partial.replyToId ?? null,
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    status: partial.status ?? "queued",
    retryCount: partial.retryCount ?? 0,
    lastError: partial.lastError ?? null,
  }
}

function createMockStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
    removeItem(key: string) {
      map.delete(key)
    },
    dump() {
      return Object.fromEntries(map.entries())
    },
  }
}

describe("chat outbox replay ordering", () => {
  it("replays queued/failed items by createdAt and id", () => {
    const entries: OutboxEntry[] = [
      buildEntry({ id: "b", createdAt: "2026-01-01T00:00:00.000Z", status: "failed" }),
      buildEntry({ id: "a", createdAt: "2026-01-01T00:00:00.000Z", status: "queued" }),
      buildEntry({ id: "d", createdAt: "2026-01-02T00:00:00.000Z", status: "sending" }),
      buildEntry({ id: "c", createdAt: "2026-01-03T00:00:00.000Z", status: "queued" }),
    ]

    expect(resolveReplayOrder(entries).map((entry) => entry.id)).toEqual(["a", "b", "c"])
  })
})

describe("chat outbox dedupe/idempotency helpers", () => {
  it("upserts by message id for idempotent retry bookkeeping", () => {
    const first = buildEntry({ id: "same-id", status: "queued", retryCount: 0 })
    const second = buildEntry({ id: "same-id", status: "failed", retryCount: 2, lastError: "timeout" })

    const once = upsertOutboxEntry([], first)
    const twice = upsertOutboxEntry(once, second)

    expect(twice).toHaveLength(1)
    expect(twice[0].status).toBe("failed")
    expect(twice[0].retryCount).toBe(2)
    expect(twice[0].lastError).toBe("timeout")
  })

  it("marks conflict-or-ack style completion by removing the id", () => {
    const entries = [buildEntry({ id: "msg-1" }), buildEntry({ id: "msg-2" })]

    expect(removeOutboxEntry(entries, "msg-1").map((entry) => entry.id)).toEqual(["msg-2"])
  })

  it("supports conflict fallback state updates", () => {
    const entries = [buildEntry({ id: "msg-1", status: "sending", retryCount: 0 })]
    const failed = updateOutboxStatus(entries, "msg-1", { status: "failed", retryCount: 1, lastError: "500" })

    expect(failed[0]).toMatchObject({ status: "failed", retryCount: 1, lastError: "500" })
  })
})

describe("chat outbox persistence", () => {
  it("loadOutbox returns [] for null and invalid JSON", () => {
    const emptyStorage = createMockStorage()
    expect(loadOutbox(emptyStorage)).toEqual([])

    const invalidStorage = createMockStorage()
    saveOutbox([buildEntry({ id: "seed" })], invalidStorage)
    const [outboxKey] = Object.keys(invalidStorage.dump())
    invalidStorage.setItem(outboxKey, "{bad-json")
    expect(loadOutbox(invalidStorage)).toEqual([])

    invalidStorage.setItem(outboxKey, "{}")
    expect(loadOutbox(invalidStorage)).toEqual([])
  })

  it("saveOutbox + loadOutbox round-trip", () => {
    const storage = createMockStorage()
    const entries = [buildEntry({ id: "persisted" })]
    saveOutbox(entries, storage)

    expect(loadOutbox(storage)).toEqual(entries)
  })

  it("saveOutbox + loadOutbox round-trip with attachments", () => {
    const storage = createMockStorage()
    const entries = [
      buildEntry({
        id: "with-attachment",
        attachments: [
          {
            url: "https://cdn.example.com/file.png",
            filename: "file.png",
            size: 42,
            content_type: "image/png",
            storage_path: "channel/file.png",
          },
        ],
      }),
    ]

    saveOutbox(entries, storage)
    expect(loadOutbox(storage)).toEqual(entries)
  })

  it("setDraft stores non-empty values and clears whitespace-only values", () => {
    const storage = createMockStorage()

    setDraft("channel-1", "hello", storage)
    expect(getDraft("channel-1", storage)).toBe("hello")

    setDraft("channel-1", "   ", storage)
    expect(getDraft("channel-1", storage)).toBe("")
  })

  it("getDraft returns empty string for unknown channels", () => {
    const storage = createMockStorage()
    expect(getDraft("missing-channel", storage)).toBe("")
  })
})
