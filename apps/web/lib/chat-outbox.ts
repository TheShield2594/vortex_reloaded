export type OutboxStatus = "queued" | "sending" | "failed"

export interface OutboxEntry {
  id: string
  channelId: string
  authorId: string
  content: string
  replyToId: string | null
  createdAt: string
  status: OutboxStatus
  retryCount: number
  lastError: string | null
  attachments?: Array<{
    url: string
    filename: string
    size: number
    content_type: string
    storage_path?: string
  }>
}

const OUTBOX_KEY = "vortexchat:chat:outbox:v1"
const DRAFTS_KEY = "vortexchat:chat:drafts:v1"

function safeParse<T>(value: string | null, fallback: T, isValid?: (candidate: unknown) => candidate is T): T {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value) as unknown
    if (isValid && !isValid(parsed)) {
      console.warn("[chat-outbox] Ignoring persisted data with invalid shape")
      return fallback
    }
    return parsed as T
  } catch {
    return fallback
  }
}

function isOutboxEntry(candidate: unknown): candidate is OutboxEntry {
  if (!candidate || typeof candidate !== "object") return false
  const value = candidate as Partial<OutboxEntry>
  return (
    typeof value.id === "string" &&
    typeof value.channelId === "string" &&
    typeof value.authorId === "string" &&
    typeof value.content === "string" &&
    (typeof value.replyToId === "string" || value.replyToId === null) &&
    typeof value.createdAt === "string" &&
    (value.status === "queued" || value.status === "sending" || value.status === "failed") &&
    typeof value.retryCount === "number" &&
    (typeof value.lastError === "string" || value.lastError === null) &&
    (
      value.attachments === undefined ||
      (Array.isArray(value.attachments) && value.attachments.every((attachment) =>
        !!attachment &&
        typeof attachment.url === "string" &&
        typeof attachment.filename === "string" &&
        typeof attachment.size === "number" &&
        typeof attachment.content_type === "string" &&
        (attachment.storage_path === undefined || typeof attachment.storage_path === "string")
      ))
    )
  )
}

function isOutboxEntryArray(candidate: unknown): candidate is OutboxEntry[] {
  return Array.isArray(candidate) && candidate.every(isOutboxEntry)
}

function isDraftMap(candidate: unknown): candidate is Record<string, string> {
  return !!candidate && typeof candidate === "object" && !Array.isArray(candidate) &&
    Object.values(candidate as Record<string, unknown>).every((value) => typeof value === "string")
}

export function loadOutbox(storage: Pick<Storage, "getItem"> = window.localStorage): OutboxEntry[] {
  return safeParse<OutboxEntry[]>(storage.getItem(OUTBOX_KEY), [], isOutboxEntryArray)
}

export function saveOutbox(entries: OutboxEntry[], storage: Pick<Storage, "setItem"> = window.localStorage) {
  try {
    storage.setItem(OUTBOX_KEY, JSON.stringify(entries))
  } catch (error) {
    console.warn("[chat-outbox] Failed to persist outbox", error)
  }
}

export function upsertOutboxEntry(entries: OutboxEntry[], entry: OutboxEntry): OutboxEntry[] {
  const existingIndex = entries.findIndex((candidate) => candidate.id === entry.id)
  if (existingIndex === -1) return [...entries, entry]
  const next = [...entries]
  next[existingIndex] = entry
  return next
}

export function removeOutboxEntry(entries: OutboxEntry[], id: string): OutboxEntry[] {
  return entries.filter((entry) => entry.id !== id)
}

export function updateOutboxStatus(
  entries: OutboxEntry[],
  id: string,
  patch: Partial<Pick<OutboxEntry, "status" | "retryCount" | "lastError">>
): OutboxEntry[] {
  return entries.map((entry) => {
    if (entry.id !== id) return entry
    return { ...entry, ...patch }
  })
}

/**
 * Replay protocol: queued/failed entries are replayed by client creation time.
 * Ties are broken by deterministic id ordering to keep retries idempotent.
 */
export function resolveReplayOrder(entries: OutboxEntry[]): OutboxEntry[] {
  return entries
    .filter((entry) => entry.status === "queued" || entry.status === "failed")
    .sort((left, right) => {
      const byTime = left.createdAt.localeCompare(right.createdAt)
      if (byTime !== 0) return byTime
      return left.id.localeCompare(right.id)
    })
}

export function loadDraftMap(storage: Pick<Storage, "getItem"> = window.localStorage): Record<string, string> {
  return safeParse<Record<string, string>>(storage.getItem(DRAFTS_KEY), {}, isDraftMap)
}

export function saveDraftMap(drafts: Record<string, string>, storage: Pick<Storage, "setItem"> = window.localStorage) {
  try {
    storage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch (error) {
    console.warn("[chat-outbox] Failed to persist drafts", error)
  }
}

export function setDraft(
  channelId: string,
  value: string,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage
): Record<string, string> {
  const drafts = loadDraftMap(storage)
  if (value.trim().length === 0) {
    delete drafts[channelId]
  } else {
    drafts[channelId] = value
  }
  saveDraftMap(drafts, storage)
  return drafts
}

export function getDraft(channelId: string, storage: Pick<Storage, "getItem"> = window.localStorage): string {
  const drafts = loadDraftMap(storage)
  return drafts[channelId] ?? ""
}
