import type { SupabaseClient } from "@supabase/supabase-js"
import pino from "pino"

const log = pino({ name: "voice-state-sync" })

type VoiceStatePatch = {
  muted?: boolean
  deafened?: boolean
  speaking?: boolean
  self_stream?: boolean
}

type UpsertPayload = {
  user_id: string
  channel_id: string
  server_id: string
  muted: boolean
  deafened: boolean
  speaking: boolean
  self_stream: boolean
}

interface VoiceStateSync {
  enqueueUpdate: (args: { userId: string; channelId: string; patch: VoiceStatePatch }) => void
  enqueueDelete: (args: { userId: string; channelId: string }) => void
  enqueueUpsert: (payload: UpsertPayload) => void
}

export function createVoiceStateSync(supabase: SupabaseClient, flushIntervalMs = 200): VoiceStateSync {
  const updateQueue = new Map<string, { userId: string; channelId: string; patch: VoiceStatePatch }>()
  const deleteQueue = new Map<string, { userId: string; channelId: string }>()
  const upsertQueue = new Map<string, UpsertPayload>()

  const keyFor = (userId: string, channelId: string) => `${userId}::${channelId}`

  const flush = async () => {
    const upserts = [...upsertQueue.values()]
    const updates = [...updateQueue.values()]
    const deletes = [...deleteQueue.values()]

    upsertQueue.clear()
    updateQueue.clear()
    deleteQueue.clear()

    await Promise.all([
      ...upserts.map((payload) => supabase.from("voice_states").upsert(payload)),
      ...updates.map((entry) => supabase.from("voice_states").update(entry.patch).eq("user_id", entry.userId).eq("channel_id", entry.channelId)),
      ...deletes.map((entry) => supabase.from("voice_states").delete().eq("user_id", entry.userId).eq("channel_id", entry.channelId)),
    ])
  }

  setInterval(() => {
    if (!upsertQueue.size && !updateQueue.size && !deleteQueue.size) return
    flush().catch((error) => {
      log.error({ err: error }, "Flush failed")
    })
  }, flushIntervalMs)

  return {
    enqueueUpdate: ({ userId, channelId, patch }) => {
      const key = keyFor(userId, channelId)
      const existing = updateQueue.get(key)
      updateQueue.set(key, {
        userId,
        channelId,
        patch: { ...(existing?.patch ?? {}), ...patch },
      })
      deleteQueue.delete(key)
      if (upsertQueue.has(key)) {
        const pending = upsertQueue.get(key)!
        upsertQueue.set(key, { ...pending, ...patch })
      }
    },
    enqueueDelete: ({ userId, channelId }) => {
      const key = keyFor(userId, channelId)
      updateQueue.delete(key)
      upsertQueue.delete(key)
      deleteQueue.set(key, { userId, channelId })
    },
    enqueueUpsert: (payload) => {
      const key = keyFor(payload.user_id, payload.channel_id)
      deleteQueue.delete(key)
      updateQueue.delete(key)
      upsertQueue.set(key, payload)
    },
  }
}
