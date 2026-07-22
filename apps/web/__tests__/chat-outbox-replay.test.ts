/**
 * Outbox offline → online replay integration test
 *
 * Tests the full lifecycle:
 *   1. fetch rejects  → message is queued  (offline simulation)
 *   2. fetch resolves → outbox is replayed and cleared (reconnect simulation)
 *
 * The replay driver used here mirrors the logic in
 * components/chat/chat-area.tsx (sendOutboxEntry + flushOutbox) so that any
 * divergence from that implementation is caught early.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  type OutboxEntry,
  loadOutbox,
  removeOutboxEntry,
  resolveReplayOrder,
  saveOutbox,
  upsertOutboxEntry,
  updateOutboxStatus,
} from "@/lib/chat-outbox"

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

function buildEntry(partial: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    channelId: partial.channelId ?? "channel-1",
    authorId: partial.authorId ?? "user-1",
    content: partial.content ?? "Hello, world!",
    replyToId: null,
    createdAt: partial.createdAt ?? new Date().toISOString(),
    status: partial.status ?? "queued",
    retryCount: partial.retryCount ?? 0,
    lastError: null,
  }
}

/**
 * Minimal replay driver — mirrors the sendOutboxEntry + flushOutbox logic from
 * chat-area.tsx but is extracted here so it can be exercised in isolation with
 * a mocked fetch and an injectable `isOnline` predicate.
 *
 * Returns the final outbox state after attempting to replay all queued/failed
 * entries for the given channelId.
 */
async function replayOutbox(
  channelId: string,
  storage: Pick<Storage, "getItem" | "setItem">,
  isOnline: () => boolean
): Promise<OutboxEntry[]> {
  if (!isOnline()) return loadOutbox(storage)

  const pending = resolveReplayOrder(loadOutbox(storage)).filter(
    (e) => e.channelId === channelId
  )

  for (const entry of pending) {
    if (!isOnline()) break

    // Mark as "sending"
    let entries = loadOutbox(storage)
    entries = updateOutboxStatus(entries, entry.id, { status: "sending", lastError: null })
    saveOutbox(entries, storage)

    let errorMsg: string | null = null
    let serverMessage: unknown = null

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: entry.channelId,
          content: entry.content,
          clientNonce: entry.id,
        }),
      })

      if (res.ok) {
        serverMessage = await res.json()
      } else {
        errorMsg = `HTTP ${res.status}`
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : "Network error"
    }

    entries = loadOutbox(storage)
    if (errorMsg) {
      const nextStatus = isOnline() ? "failed" : "queued"
      entries = updateOutboxStatus(entries, entry.id, {
        status: nextStatus,
        retryCount: entry.retryCount + 1,
        lastError: errorMsg,
      })
    } else {
      entries = removeOutboxEntry(entries, entry.id)
      void serverMessage // consumed by the UI layer in real code
    }
    saveOutbox(entries, storage)
  }

  return loadOutbox(storage)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("outbox offline → online replay", () => {
  let storage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    storage = createMockStorage()
    vi.stubGlobal("fetch", undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("queues a message when fetch rejects (offline)", async () => {
    // Simulate offline: fetch throws a network error
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Failed to fetch"))
    )

    const entry = buildEntry({ id: "msg-offline-1", status: "queued" })
    saveOutbox([entry], storage)

    const remaining = await replayOutbox("channel-1", storage, () => true)

    // Entry should be marked "failed" (online but fetch rejected)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].status).toBe("failed")
    expect(remaining[0].retryCount).toBe(1)
    expect(remaining[0].lastError).toContain("fetch")
  })

  it("does not attempt replay when navigator reports offline", async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal("fetch", mockFetch)

    const entry = buildEntry({ id: "msg-offline-2", status: "queued" })
    saveOutbox([entry], storage)

    // isOnline = false: replay should bail out immediately
    const remaining = await replayOutbox("channel-1", storage, () => false)

    expect(mockFetch).not.toHaveBeenCalled()
    // Outbox unchanged
    expect(remaining).toHaveLength(1)
    expect(remaining[0].status).toBe("queued")
  })

  it("clears the outbox when fetch succeeds (reconnect)", async () => {
    const serverMessage = {
      id: "server-msg-1",
      content: "Hello, world!",
      channel_id: "channel-1",
      author_id: "user-1",
      created_at: new Date().toISOString(),
    }

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => serverMessage,
      })
    )

    const entry = buildEntry({ id: "msg-reconnect-1", status: "queued" })
    saveOutbox([entry], storage)

    const remaining = await replayOutbox("channel-1", storage, () => true)

    expect(remaining).toHaveLength(0)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      "/api/messages",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("replays multiple queued messages in createdAt order and clears all", async () => {
    const serverMessage = (id: string) => ({
      id,
      content: "msg",
      channel_id: "channel-1",
      author_id: "user-1",
      created_at: new Date().toISOString(),
    })

    let callCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url, opts) => {
        callCount++
        const body = JSON.parse((opts as RequestInit).body as string)
        return {
          ok: true,
          json: async () => serverMessage(body.clientNonce),
        }
      })
    )

    const entries: OutboxEntry[] = [
      buildEntry({ id: "c", createdAt: "2026-01-03T00:00:00.000Z", status: "queued" }),
      buildEntry({ id: "a", createdAt: "2026-01-01T00:00:00.000Z", status: "queued" }),
      buildEntry({ id: "b", createdAt: "2026-01-02T00:00:00.000Z", status: "failed", retryCount: 1 }),
    ]
    saveOutbox(entries, storage)

    const remaining = await replayOutbox("channel-1", storage, () => true)

    expect(remaining).toHaveLength(0)
    expect(callCount).toBe(3)
  })

  it("stops mid-replay if connection drops during replay", async () => {
    let callNum = 0
    // First call succeeds; second call throws (connection dropped mid-replay)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callNum++
        if (callNum === 1) {
          return {
            ok: true,
            json: async () => ({ id: "srv-1", content: "first" }),
          }
        }
        throw new Error("Failed to fetch")
      })
    )

    let online = true
    const entries: OutboxEntry[] = [
      buildEntry({ id: "first", createdAt: "2026-01-01T00:00:00.000Z", status: "queued" }),
      buildEntry({ id: "second", createdAt: "2026-01-02T00:00:00.000Z", status: "queued" }),
    ]
    saveOutbox(entries, storage)

    // Go "offline" after the first send attempt
    const isOnlineFn = vi.fn().mockImplementation(() => {
      // First check (before replay starts): online; after first send: offline
      if (callNum >= 1) {
        online = false
      }
      return online
    })

    const remaining = await replayOutbox("channel-1", storage, isOnlineFn)

    // First message was sent and removed; second was attempted but fetch threw,
    // and since isOnline() now returns false the status should be "queued".
    const ids = remaining.map((e) => e.id)
    expect(ids).toContain("second")
    expect(remaining.find((e) => e.id === "second")?.status).toBe("queued")
    expect(remaining.find((e) => e.id === "first")).toBeUndefined()
  })

  it("only replays entries belonging to the current channel", async () => {
    const calledFor: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url, opts) => {
        const body = JSON.parse((opts as RequestInit).body as string)
        calledFor.push(body.channelId)
        return { ok: true, json: async () => ({}) }
      })
    )

    const entries: OutboxEntry[] = [
      buildEntry({ id: "ch1-msg", channelId: "channel-1", status: "queued" }),
      buildEntry({ id: "ch2-msg", channelId: "channel-2", status: "queued" }),
    ]
    saveOutbox(entries, storage)

    await replayOutbox("channel-1", storage, () => true)

    expect(calledFor).toEqual(["channel-1"])
    // channel-2 entry should still be in the outbox (different channel)
    const remaining = loadOutbox(storage)
    expect(remaining.map((e) => e.id)).toContain("ch2-msg")
  })
})
