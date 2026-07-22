"use client"

import { create } from "zustand"

export type OutboxStatus = "pending" | "sending" | "failed"

export interface OutboxMessage {
  /** Client-generated ID for tracking */
  clientId: string
  channelId: string
  content: string
  /** ISO timestamp of when the message was queued */
  queuedAt: string
  status: OutboxStatus
  /** Number of retry attempts */
  retries: number
  /** Error message if failed */
  error?: string
}

interface OutboxState {
  messages: OutboxMessage[]
  /** Add a message to the outbox (returns the client ID) */
  enqueue: (channelId: string, content: string) => string
  /** Mark a message as sending */
  markSending: (clientId: string) => void
  /** Mark a message as failed */
  markFailed: (clientId: string, error: string) => void
  /** Remove a successfully sent message */
  markSent: (clientId: string) => void
  /** Cancel / discard a queued or failed message */
  cancel: (clientId: string) => void
  /** Get pending + failed messages for a channel */
  forChannel: (channelId: string) => OutboxMessage[]
}

let counter = 0
function clientId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER
  return `outbox-${Date.now()}-${counter}`
}

const STORAGE_KEY = "vortexchat:zustand-outbox:v1"

const VALID_STATUSES: OutboxStatus[] = ["pending", "sending", "failed"]

function loadPersistedMessages(): OutboxMessage[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (m: Record<string, unknown>) =>
          typeof m.clientId === "string" &&
          typeof m.channelId === "string" &&
          typeof m.content === "string",
      )
      .map((m: Record<string, unknown>): OutboxMessage => ({
        clientId: m.clientId as string,
        channelId: m.channelId as string,
        content: m.content as string,
        queuedAt: typeof m.queuedAt === "string" ? m.queuedAt : new Date().toISOString(),
        status: VALID_STATUSES.includes(m.status as OutboxStatus) ? (m.status as OutboxStatus) : "pending",
        retries: typeof m.retries === "number" && Number.isFinite(m.retries) ? m.retries : 0,
        ...(typeof m.error === "string" ? { error: m.error } : {}),
      }))
  } catch {
    return []
  }
}

function persistMessages(messages: OutboxMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

export const useMessageOutbox = create<OutboxState>((set, get) => ({
  messages: loadPersistedMessages(),

  enqueue(channelId, content) {
    if (!channelId || typeof channelId !== "string") throw new Error("enqueue: channelId is required")
    if (!content || typeof content !== "string" || !content.trim()) throw new Error("enqueue: content must be a non-empty string")
    const id = clientId()
    set((s) => {
      const messages = [
        ...s.messages,
        { clientId: id, channelId, content, queuedAt: new Date().toISOString(), status: "pending" as const, retries: 0 },
      ]
      persistMessages(messages)
      return { messages }
    })
    return id
  },

  markSending(cid) {
    set((s) => {
      const messages = s.messages.map((m) => (m.clientId === cid ? { ...m, status: "sending" as const } : m))
      persistMessages(messages)
      return { messages }
    })
  },

  markFailed(cid, error) {
    set((s) => {
      const messages = s.messages.map((m) =>
        m.clientId === cid ? { ...m, status: "failed" as const, error, retries: m.retries + 1 } : m,
      )
      persistMessages(messages)
      return { messages }
    })
  },

  markSent(cid) {
    set((s) => {
      const messages = s.messages.filter((m) => m.clientId !== cid)
      persistMessages(messages)
      return { messages }
    })
  },

  cancel(cid) {
    set((s) => {
      const messages = s.messages.filter((m) => m.clientId !== cid)
      persistMessages(messages)
      return { messages }
    })
  },

  forChannel(channelId) {
    return get().messages.filter((m) => m.channelId === channelId)
  },
}))

// --- Auto-flush on reconnect (#656) ---

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    // Dispatch a custom event that the chat view can listen for to retry pending messages
    window.dispatchEvent(new CustomEvent("vortex:flush-outbox"))
  })

  // Reset "sending" entries to "pending" when the socket disconnects, so they
  // will be retried on reconnect instead of being stuck in limbo.
  window.addEventListener("vortex:outbox-reset-sending", () => {
    const state = useMessageOutbox.getState()
    const inFlight = state.messages.filter((m) => m.status === "sending")
    if (inFlight.length === 0) return
    useMessageOutbox.setState((s) => {
      const messages = s.messages.map((m) =>
        m.status === "sending" ? { ...m, status: "pending" as const } : m,
      )
      persistMessages(messages)
      return { messages }
    })
  })
}
