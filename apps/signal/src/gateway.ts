/**
 * Unified Socket.IO Real-Time Gateway
 *
 * Adds gateway event handlers to the Socket.IO server for:
 * - Channel subscriptions (join/leave channel rooms for event delivery)
 * - Typing indicators via Socket.IO
 * - Presence via Socket.IO (replaces HTTP heartbeat polling)
 * - Reconnection catch-up via Redis Streams replay
 *
 * #592: Unified Socket.IO Real-Time Gateway
 * #595: WebSocket-Based Presence & Typing
 * #597: Reconnection Catch-Up Protocol
 */

import type { Server, Socket } from "socket.io"
import type { SupabaseClient } from "@supabase/supabase-js"
import pino from "pino"
import type { VortexEvent, UserStatus } from "@vortex/shared"
import {
  MAX_REPLAY_EVENTS,
  TYPING_RATE_LIMIT,
  PRESENCE_RATE_LIMIT,
} from "@vortex/shared"
import type { RedisEventBus } from "./event-bus"
import type { PresenceManager } from "./presence"
import { SocketRateLimiter } from "./rate-limiter"

const log = pino({ name: "gateway" })

// ── Per-socket rate limiter (shared with index.ts) ──────────────────────────
// Instantiated at module scope but cleanup timer is only started inside
// initGateway() so disabled/test processes don't leak intervals.

let gatewayLimiter: SocketRateLimiter | null = null

// ── Gateway socket state ────────────────────────────────────────────────────

interface GatewaySocketState {
  userId: string
  /** Channel IDs this socket is subscribed to for gateway events. */
  subscribedChannels: Set<string>
  /** Server IDs the user belongs to (for presence broadcasts). */
  serverIds: string[]
}

const socketStates = new Map<string, GatewaySocketState>()

// ── Typing state tracking ───────────────────────────────────────────────────

interface TypingEntry {
  userId: string
  displayName: string
  channelId: string
  timer: ReturnType<typeof setTimeout>
}

const activeTyping = new Map<string, TypingEntry>()

function typingKey(userId: string, channelId: string): string {
  return `${userId}:${channelId}`
}

// ── Initialization ──────────────────────────────────────────────────────────

export interface GatewayOptions {
  io: Server
  eventBus: RedisEventBus
  presence: PresenceManager
  supabase: SupabaseClient | null
  validateSession: (socket: Socket) => Promise<boolean>
  getSessionUserId: (socket: Socket) => string | undefined
}

/** Stop the gateway rate-limiter cleanup timer (call during graceful shutdown). */
export function stopGatewayCleanup(): void {
  gatewayLimiter?.stopCleanup()
}

export function initGateway(options: GatewayOptions): void {
  gatewayLimiter = (gatewayLimiter ?? new SocketRateLimiter()).startCleanup()
  const { io, eventBus, presence, supabase, validateSession, getSessionUserId } = options

  // Subscribe to event bus to fan out events to connected sockets
  eventBus.subscribe({}, (event: VortexEvent) => {
    // Emit to the Socket.IO room for this channel
    io.to(`gateway:${event.channelId}`).emit("gateway:event", event)
  })

  // Start presence cleanup
  presence.startCleanup((userId, serverIds) => {
    // Broadcast offline status to relevant servers
    for (const serverId of serverIds) {
      io.to(`presence:${serverId}`).emit("gateway:presence", {
        userId,
        status: "offline" as UserStatus,
        updatedAt: new Date().toISOString(),
      })
    }
  })

  io.on("connection", (socket: Socket) => {
    // ── Gateway: Subscribe to channels ────────────────────────────────────
    socket.on("gateway:subscribe", async (data: unknown) => {
      try {
        if (typeof data !== "object" || data === null) {
          socket.emit("error", { message: "Invalid gateway:subscribe payload" })
          return
        }

        if (!(await validateSession(socket))) return

        const userId = getSessionUserId(socket)
        if (!userId) {
          socket.emit("error", { message: "Authentication required" })
          return
        }

        const { channelIds } = data as { channelIds?: unknown }
        if (!Array.isArray(channelIds) || channelIds.length === 0) {
          socket.emit("error", { message: "channelIds must be a non-empty array" })
          return
        }

        // Cap the number of channels per subscribe call
        if (channelIds.length > 100) {
          socket.emit("error", { message: "Cannot subscribe to more than 100 channels at once" })
          return
        }

        // Validate all channelIds are strings
        for (const id of channelIds) {
          if (typeof id !== "string" || !id) {
            socket.emit("error", { message: "Each channelId must be a non-empty string" })
            return
          }
        }

        // Verify channel membership for each channel
        const validChannels: string[] = []
        if (supabase) {
          for (const channelId of channelIds) {
            const isMember = await checkChannelAccess(supabase, userId, channelId)
            if (isMember) {
              validChannels.push(channelId)
            }
          }
        } else {
          validChannels.push(...channelIds)
        }

        // Initialize socket state
        let state = socketStates.get(socket.id)
        if (!state) {
          const serverIds = supabase ? await getUserServerIds(supabase, userId) : []
          state = { userId, subscribedChannels: new Set(), serverIds }
          socketStates.set(socket.id, state)

          // Join presence rooms for all user's servers
          for (const serverId of serverIds) {
            socket.join(`presence:${serverId}`)
          }
        }

        // Join Socket.IO rooms for each valid channel
        for (const channelId of validChannels) {
          socket.join(`gateway:${channelId}`)
          state.subscribedChannels.add(channelId)
        }

        socket.emit("gateway:subscribed", { channelIds: validChannels })
        log.info({ userId, channels: validChannels.length }, "gateway subscribed")
      } catch (err) {
        log.error({ socketId: socket.id, err }, "gateway:subscribe error")
        socket.emit("error", { message: "Internal server error" })
      }
    })

    // ── Gateway: Unsubscribe from channels ────────────────────────────────
    socket.on("gateway:unsubscribe", async (data: unknown) => {
      try {
        if (typeof data !== "object" || data === null) return

        const { channelIds } = data as { channelIds?: unknown }
        if (!Array.isArray(channelIds)) return

        const state = socketStates.get(socket.id)
        if (!state) return

        for (const channelId of channelIds) {
          if (typeof channelId !== "string") continue
          socket.leave(`gateway:${channelId}`)
          state.subscribedChannels.delete(channelId)
        }
      } catch (err) {
        log.error({ socketId: socket.id, err }, "gateway:unsubscribe error")
      }
    })

    // ── Gateway: Typing indicators ────────────────────────────────────────
    socket.on("gateway:typing", async (data: unknown) => {
      try {
        if (typeof data !== "object" || data === null) return

        const { channelId, isTyping } = data as { channelId?: unknown; isTyping?: unknown }
        if (typeof channelId !== "string" || !channelId) return
        if (typeof isTyping !== "boolean") return

        if (!gatewayLimiter!.check(socket.id, "typing", TYPING_RATE_LIMIT, 60_000)) return
        if (!(await validateSession(socket))) return

        const state = socketStates.get(socket.id)
        if (!state) return

        // Must be subscribed to the channel
        if (!state.subscribedChannels.has(channelId)) return

        // Get display name for the typing indicator
        let displayName = "Unknown"
        if (supabase) {
          try {
            const { data: user } = await supabase
              .from("users")
              .select("display_name, username")
              .eq("id", state.userId)
              .maybeSingle()
            if (user) {
              displayName = user.display_name || user.username || "Unknown"
            }
          } catch {
            // Use default
          }
        }

        const key = typingKey(state.userId, channelId)

        if (isTyping) {
          // Clear existing timer
          const existing = activeTyping.get(key)
          if (existing?.timer) clearTimeout(existing.timer)

          // Auto-stop after 5 seconds
          const timer = setTimeout(() => {
            activeTyping.delete(key)
            io.to(`gateway:${channelId}`).emit("gateway:typing", {
              channelId,
              userId: state.userId,
              displayName,
              isTyping: false,
            })
          }, 5_000)

          activeTyping.set(key, { userId: state.userId, displayName, channelId, timer })
        } else {
          const existing = activeTyping.get(key)
          if (existing?.timer) clearTimeout(existing.timer)
          activeTyping.delete(key)
        }

        // Broadcast to channel (except sender)
        socket.to(`gateway:${channelId}`).emit("gateway:typing", {
          channelId,
          userId: state.userId,
          displayName,
          isTyping,
        })
      } catch (err) {
        log.error({ socketId: socket.id, err }, "gateway:typing error")
      }
    })

    // ── Gateway: Presence heartbeat ───────────────────────────────────────
    socket.on("gateway:presence", async (data: unknown) => {
      try {
        if (typeof data !== "object" || data === null) return

        const { status } = data as { status?: unknown }
        if (typeof status !== "string") return

        const validStatuses: UserStatus[] = ["online", "idle", "dnd", "invisible", "offline"]
        if (!validStatuses.includes(status as UserStatus)) return

        if (!gatewayLimiter!.check(socket.id, "presence", PRESENCE_RATE_LIMIT, 60_000)) return
        if (!(await validateSession(socket))) return

        const state = socketStates.get(socket.id)
        if (!state) return

        const userStatus = status as UserStatus
        await presence.updateStatus(state.userId, userStatus)

        // Persist status change to DB so Supabase Realtime presence
        // and subsequent page loads reflect the correct status (#presence-fix)
        if (supabase) {
          try {
            const now = new Date().toISOString()
            const { error: dbErr } = await supabase
              .from("users")
              .update({ status: userStatus, last_heartbeat_at: now, updated_at: now })
              .eq("id", state.userId)
            if (dbErr) {
              log.error({ err: dbErr, userId: state.userId }, "gateway:presence DB status update failed")
            }
          } catch (err) {
            log.error({ err, userId: state.userId }, "gateway:presence DB status update threw")
          }
        }

        // Broadcast to all servers the user belongs to.
        // Uses socket.to() which is cluster-aware via the Redis adapter,
        // ensuring recipients on other replicas also receive the update.
        // Socket.IO deduplicates when a socket is in multiple targeted rooms.
        const broadcastStatus = userStatus === "invisible" ? "offline" : userStatus
        const presencePayload = {
          userId: state.userId,
          status: broadcastStatus,
          updatedAt: new Date().toISOString(),
        }
        for (const serverId of state.serverIds) {
          socket.to(`presence:${serverId}`).emit("gateway:presence", presencePayload)
        }
      } catch (err) {
        log.error({ socketId: socket.id, err }, "gateway:presence error")
      }
    })

    // ── Gateway: Resume (reconnection catch-up) ───────────────────────────
    socket.on("gateway:resume", async (data: unknown) => {
      try {
        if (typeof data !== "object" || data === null) {
          socket.emit("error", { message: "Invalid gateway:resume payload" })
          return
        }

        if (!(await validateSession(socket))) return

        const userId = getSessionUserId(socket)
        if (!userId) return

        const { channels } = data as { channels?: unknown }
        if (typeof channels !== "object" || channels === null) {
          socket.emit("error", { message: "channels must be a Record<channelId, lastEventId>" })
          return
        }

        const channelMap = channels as Record<string, string>
        const entries = Object.entries(channelMap)

        if (entries.length > 100) {
          socket.emit("error", { message: "Cannot resume more than 100 channels at once" })
          return
        }

        const successChannels: string[] = []
        const gapTooLarge: string[] = []

        for (const [channelId, lastEventId] of entries) {
          if (typeof channelId !== "string" || typeof lastEventId !== "string") continue

          // Verify access
          if (supabase) {
            const hasAccess = await checkChannelAccess(supabase, userId, channelId)
            if (!hasAccess) continue
          }

          // Re-subscribe to the channel room
          socket.join(`gateway:${channelId}`)
          const state = socketStates.get(socket.id)
          if (state) state.subscribedChannels.add(channelId)

          // Replay missed events
          try {
            const events = await eventBus.replay({
              channelId,
              afterEventId: lastEventId,
              limit: MAX_REPLAY_EVENTS,
            })

            if (events.length > 0) {
              socket.emit("gateway:replay", {
                channelId,
                events,
                hasMore: events.length >= MAX_REPLAY_EVENTS,
              })
            }

            successChannels.push(channelId)
          } catch (err) {
            log.error({ err, channelId }, "replay failed")
            gapTooLarge.push(channelId)
          }
        }

        socket.emit("gateway:resume-complete", {
          channels: successChannels,
          gapTooLarge,
        })

        log.info(
          { userId, resumed: successChannels.length, gapped: gapTooLarge.length },
          "gateway resume complete",
        )
      } catch (err) {
        log.error({ socketId: socket.id, err }, "gateway:resume error")
        socket.emit("error", { message: "Internal server error" })
      }
    })

    // ── Gateway: Connection setup ─────────────────────────────────────────
    // When a gateway-enabled client connects, it should emit gateway:subscribe
    // and optionally gateway:presence. We auto-register presence on connect
    // if we can derive the user ID.
    socket.on("gateway:init", async (data: unknown) => {
      try {
        if (!(await validateSession(socket))) return

        const userId = getSessionUserId(socket)
        if (!userId) return

        let status: UserStatus = "online"
        if (typeof data === "object" && data !== null) {
          const payload = data as { status?: unknown }
          if (typeof payload.status === "string") {
            const validStatuses: UserStatus[] = ["online", "idle", "dnd", "invisible", "offline"]
            if (validStatuses.includes(payload.status as UserStatus)) {
              status = payload.status as UserStatus
            }
          }
        }

        // Get user's server memberships
        const serverIds = supabase ? await getUserServerIds(supabase, userId) : []

        // Initialize socket state
        const state: GatewaySocketState = {
          userId,
          subscribedChannels: new Set(),
          serverIds,
        }
        socketStates.set(socket.id, state)

        // Set presence
        await presence.setOnline(userId, socket.id, status, serverIds)

        // Persist status to DB so Supabase Realtime presence and page
        // loads reflect the correct status (#presence-fix)
        if (supabase) {
          try {
            const now = new Date().toISOString()
            const { error: dbErr } = await supabase
              .from("users")
              .update({ status, last_heartbeat_at: now, updated_at: now })
              .eq("id", userId)
            if (dbErr) {
              log.error({ err: dbErr, userId }, "gateway:init DB status update failed")
            }
          } catch (err) {
            log.error({ err, userId }, "gateway:init DB status update threw")
          }
        }

        // Join presence rooms
        for (const serverId of serverIds) {
          socket.join(`presence:${serverId}`)
        }

        // Broadcast online status to all servers
        const broadcastStatus = status === "invisible" ? "offline" : status
        for (const serverId of serverIds) {
          socket.to(`presence:${serverId}`).emit("gateway:presence", {
            userId,
            status: broadcastStatus,
            updatedAt: new Date().toISOString(),
          })
        }

        log.info({ userId, servers: serverIds.length }, "gateway initialized")
      } catch (err) {
        log.error({ socketId: socket.id, err }, "gateway:init error")
      }
    })

    // ── Gateway: Disconnect cleanup ───────────────────────────────────────
    socket.on("disconnect", async () => {
      try {
        const state = socketStates.get(socket.id)
        if (!state) return

        // Clean up typing state
        for (const channelId of state.subscribedChannels) {
          const key = typingKey(state.userId, channelId)
          const entry = activeTyping.get(key)
          if (entry) {
            clearTimeout(entry.timer)
            activeTyping.delete(key)
            // Broadcast typing stop
            io.to(`gateway:${channelId}`).emit("gateway:typing", {
              channelId,
              userId: state.userId,
              displayName: entry.displayName,
              isTyping: false,
            })
          }
        }

        // Set offline and broadcast
        const serverIds = await presence.setOffline(state.userId)

        // Persist offline status to DB (#presence-fix)
        if (supabase) {
          try {
            const now = new Date().toISOString()
            const { error: dbErr } = await supabase
              .from("users")
              .update({ status: "offline", last_online_at: now, updated_at: now })
              .eq("id", state.userId)
            if (dbErr) {
              log.error({ err: dbErr, userId: state.userId }, "disconnect DB status update failed")
            }
          } catch (err) {
            log.error({ err, userId: state.userId }, "disconnect DB status update threw")
          }
        }

        for (const serverId of serverIds) {
          io.to(`presence:${serverId}`).emit("gateway:presence", {
            userId: state.userId,
            status: "offline" as UserStatus,
            updatedAt: new Date().toISOString(),
          })
        }

        gatewayLimiter!.remove(socket.id)
        socketStates.delete(socket.id)
      } catch (err) {
        log.error({ socketId: socket.id, err }, "gateway disconnect cleanup error")
      }
    })
  })

  log.info("gateway handlers initialized")
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function checkChannelAccess(
  supabase: SupabaseClient,
  userId: string,
  channelId: string,
): Promise<boolean> {
  try {
    // Check if this is a DM channel first
    const { data: dmChannel } = await supabase
      .from("dm_channels")
      .select("id")
      .eq("id", channelId)
      .maybeSingle()

    if (dmChannel) {
      // For DM channels, check if the user is a participant
      const { data: participant } = await supabase
        .from("dm_channel_members")
        .select("user_id")
        .eq("channel_id", channelId)
        .eq("user_id", userId)
        .maybeSingle()
      return !!participant
    }

    // Server channel — check server membership
    const { data: channel } = await supabase
      .from("channels")
      .select("server_id")
      .eq("id", channelId)
      .maybeSingle()

    if (!channel) return false

    const { data: member } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", channel.server_id)
      .eq("user_id", userId)
      .maybeSingle()

    return !!member
  } catch (err) {
    log.error({ err, userId, channelId }, "checkChannelAccess error — failing closed")
    return false
  }
}

async function getUserServerIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  try {
    const { data: memberships, error } = await supabase
      .from("server_members")
      .select("server_id")
      .eq("user_id", userId)

    if (error || !memberships) return []
    return memberships.map((m: { server_id: string }) => m.server_id)
  } catch (err) {
    log.error({ err, userId }, "getUserServerIds error")
    return []
  }
}

/**
 * Publish a VortexEvent through the event bus.
 * Called from API routes when data is written to the database.
 */
export { RedisEventBus } from "./event-bus"
