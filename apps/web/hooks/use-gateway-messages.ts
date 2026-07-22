"use client"

/**
 * Socket.IO–based Real-Time Messages.
 *
 * Drop-in replacement for useRealtimeMessages that receives message events
 * through the unified Socket.IO gateway instead of Supabase postgres_changes.
 * Supports reconnection catch-up via Redis Streams replay (#597).
 *
 * #592: Unified Socket.IO Real-Time Gateway
 * #597: Reconnection Catch-Up Protocol
 */

import { useEffect, useMemo, useRef } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useGatewayContext } from "./use-gateway-context"
import type { MessageWithAuthor, MessageRow, ReactionRow } from "@/types/database"
import type { VortexEvent, GatewayServerEvents } from "@vortex/shared"

export type RealtimeStatus = "connecting" | "connected" | "disconnected"

export function useGatewayMessages(
  channelId: string,
  onInsert: (message: MessageWithAuthor) => void,
  onUpdate: (message: MessageRow) => void,
  onReactionInsert?: (reaction: ReactionRow) => void,
  onReactionDelete?: (reaction: ReactionRow) => void,
  onStatusChange?: (status: RealtimeStatus) => void,
  onReconnect?: () => void,
) {
  const gateway = useGatewayContext()
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const wasConnectedRef = useRef(false)

  useEffect(() => {
    wasConnectedRef.current = false

    // Subscribe to the channel via gateway
    gateway.subscribe([channelId])
    onStatusChange?.("connecting")

    // Handle gateway events for this channel
    const removeEventListener = gateway.addEventListener(channelId, async (event: VortexEvent) => {
      try {
        switch (event.type) {
          case "message.created": {
            // Fetch the full hydrated message from the database
            const messageId = (event.data as { messageId?: string })?.messageId
            if (!messageId) break

            const replyToId = (event.data as { replyToId?: string })?.replyToId ?? null
            const [messageResult, replyResult] = await Promise.all([
              supabase
                .from("messages")
                .select(`*, author:users!messages_author_id_fkey(*), attachments(*), reactions(*)`)
                .eq("id", messageId)
                .single(),
              replyToId
                ? supabase
                    .from("messages")
                    .select(`*, author:users!messages_author_id_fkey(*)`)
                    .eq("id", replyToId)
                    .single()
                : Promise.resolve({ data: null }),
            ])

            const data = messageResult.data
            if (!data) break
            const replyTo = replyResult.data ?? null
            onInsert({ ...data, reply_to: replyTo } as unknown as MessageWithAuthor)
            break
          }

          case "message.updated": {
            const messageData = event.data as MessageRow | undefined
            if (messageData) {
              onUpdate(messageData)
            }
            break
          }

          case "message.deleted": {
            // Treat as update with deleted_at set
            const deletedData = event.data as MessageRow | undefined
            if (deletedData) {
              onUpdate(deletedData)
            }
            break
          }

          case "reaction.added": {
            if (onReactionInsert) {
              const reaction = event.data as ReactionRow | undefined
              if (reaction) onReactionInsert(reaction)
            }
            break
          }

          case "reaction.removed": {
            if (onReactionDelete) {
              const reaction = event.data as ReactionRow | undefined
              if (reaction) onReactionDelete(reaction)
            }
            break
          }
        }
      } catch (err) {
        console.error("[gateway-messages] event handler error:", err)
      }
    })

    // Handle replay events (reconnection catch-up)
    const removeReplayListener = gateway.addReplayListener(
      channelId,
      async (data: GatewayServerEvents["gateway:replay"]) => {
        for (const event of data.events) {
          try {
            if (event.type === "message.created") {
              const messageId = (event.data as { messageId?: string })?.messageId
              if (!messageId) continue

              const { data: msg } = await supabase
                .from("messages")
                .select(`*, author:users!messages_author_id_fkey(*), attachments(*), reactions(*)`)
                .eq("id", messageId)
                .single()

              if (msg) {
                onInsert(msg as unknown as MessageWithAuthor)
              }
            } else if (event.type === "message.updated" || event.type === "message.deleted") {
              const messageData = event.data as MessageRow | undefined
              if (messageData) onUpdate(messageData)
            } else if (event.type === "reaction.added" && onReactionInsert) {
              const reaction = event.data as ReactionRow | undefined
              if (reaction) onReactionInsert(reaction)
            } else if (event.type === "reaction.removed" && onReactionDelete) {
              const reaction = event.data as ReactionRow | undefined
              if (reaction) onReactionDelete(reaction)
            }
          } catch (err) {
            console.error("[gateway-messages] replay event error:", err)
          }
        }

        // If the gap was too large, trigger a full reload
        if (data.hasMore) {
          onReconnect?.()
        }
      },
    )

    // Track connection status
    const unsubscribeStatus = () => {
      const handleConnect = () => {
        if (wasConnectedRef.current) {
          onReconnect?.()
        }
        wasConnectedRef.current = true
        onStatusChange?.("connected")
      }
      const handleDisconnect = () => {
        onStatusChange?.("disconnected")
      }

      window.addEventListener("vortex:realtime-connect", handleConnect)
      window.addEventListener("vortex:realtime-disconnect", handleDisconnect)

      return () => {
        window.removeEventListener("vortex:realtime-connect", handleConnect)
        window.removeEventListener("vortex:realtime-disconnect", handleDisconnect)
      }
    }

    const cleanupStatus = unsubscribeStatus()

    // Mark as connected if gateway is already connected
    if (gateway.status === "connected") {
      wasConnectedRef.current = true
      onStatusChange?.("connected")
    }

    return () => {
      removeEventListener()
      removeReplayListener()
      cleanupStatus()
      gateway.unsubscribe([channelId])
    }
  }, [channelId])
}
