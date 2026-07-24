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
import pino from "pino"
import type { VortexEvent, UserStatus } from "@vortex/shared"
import {
  MAX_REPLAY_EVENTS,
  TYPING_RATE_LIMIT,
  PRESENCE_RATE_LIMIT,
  CALL_SIGNAL_RATE_LIMIT,
  SUBSCRIBE_RATE_LIMIT,
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
  validateSession: (socket: Socket) => Promise<boolean>
  getSessionUserId: (socket: Socket) => string | undefined
  /**
   * Returns the subset of requested channel IDs the user is authorized to
   * join (membership check — issue #51). See ./channel-access.ts.
   */
  checkChannelAccess: (userId: string, channelIds: string[]) => Promise<string[]>
}

/** Stop the gateway rate-limiter cleanup timer (call during graceful shutdown). */
export function stopGatewayCleanup(): void {
  gatewayLimiter?.stopCleanup()
}

export function initGateway(options: GatewayOptions): void {
  gatewayLimiter = (gatewayLimiter ?? new SocketRateLimiter()).startCleanup()
  const { io, eventBus, presence, validateSession, getSessionUserId, checkChannelAccess } = options

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

        // Throttle before the membership check's network round-trip so a
        // client can't amplify load against the internal endpoint by spamming
        // subscribe.
        if (!gatewayLimiter!.check(socket.id, "subscribe", SUBSCRIBE_RATE_LIMIT, 60_000)) {
          socket.emit("error", { message: "Rate limit exceeded for gateway:subscribe" })
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

        // Membership authorization (issue #51): only join rooms the user is
        // actually a member of. `user:{id}` channels are owner-only; DM
        // channels are checked against the web app's membership records.
        // Re-checked on every subscribe so a removed member can't rejoin a
        // room by re-emitting gateway:subscribe.
        const validChannels = await checkChannelAccess(userId, channelIds as string[])
        const grantedSet = new Set(validChannels)
        const deniedChannels = (channelIds as string[]).filter((id) => !grantedSet.has(id))

        // Initialize socket state
        let state = socketStates.get(socket.id)
        if (!state) {
          const serverIds: string[] = []
          state = { userId, subscribedChannels: new Set(), serverIds }
          socketStates.set(socket.id, state)
          // Exposed cross-replica via the Redis adapter's fetchSockets(), so
          // revokeChannelAccess() can identify which remote sockets belong to
          // a given user without a shared socketStates map.
          socket.data.userId = userId

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

        socket.emit("gateway:subscribed", { channelIds: validChannels, denied: deniedChannels })
        if (deniedChannels.length > 0) {
          log.warn({ userId, denied: deniedChannels.length }, "gateway subscribe denied channels")
        }
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

        const displayName = "Unknown"

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

    // ── Gateway: DM/group call ring signaling ─────────────────────────────
    // Ephemeral invite/cancel/accept/decline handshake, relayed verbatim to
    // the other subscriber(s) of the DM channel room. Not persisted — the
    // call itself is transported over LiveKit once accepted.
    socket.on("gateway:call-signal", async (data: unknown) => {
      try {
        if (typeof data !== "object" || data === null) return

        const { channelId, type, withVideo, callerName, callerAvatar } = data as {
          channelId?: unknown
          type?: unknown
          withVideo?: unknown
          callerName?: unknown
          callerAvatar?: unknown
        }
        if (typeof channelId !== "string" || !channelId) return

        const validTypes = ["invite", "cancel", "accept", "decline"]
        if (typeof type !== "string" || !validTypes.includes(type)) return

        if (!gatewayLimiter!.check(socket.id, "call-signal", CALL_SIGNAL_RATE_LIMIT, 60_000)) return
        if (!(await validateSession(socket))) return

        const state = socketStates.get(socket.id)
        if (!state) return

        // Must be subscribed to the channel
        if (!state.subscribedChannels.has(channelId)) return

        socket.to(`gateway:${channelId}`).emit("gateway:call-signal", {
          channelId,
          type,
          userId: state.userId,
          withVideo: typeof withVideo === "boolean" ? withVideo : undefined,
          callerName: typeof callerName === "string" ? callerName : undefined,
          callerAvatar: typeof callerAvatar === "string" || callerAvatar === null ? callerAvatar : undefined,
        })
      } catch (err) {
        log.error({ socketId: socket.id, err }, "gateway:call-signal error")
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

        // Same throttle as gateway:subscribe — resume also authorizes every
        // channel via the internal endpoint before rejoining rooms.
        if (!gatewayLimiter!.check(socket.id, "resume", SUBSCRIBE_RATE_LIMIT, 60_000)) {
          socket.emit("error", { message: "Rate limit exceeded for gateway:resume" })
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

        // Authorize before rejoining any room (issue #51): resume must not be
        // a bypass around gateway:subscribe's membership check.
        const requestedChannelIds = entries
          .filter(([channelId, lastEventId]) => typeof channelId === "string" && typeof lastEventId === "string")
          .map(([channelId]) => channelId)
        const allowedChannels = new Set(await checkChannelAccess(userId, requestedChannelIds))

        const successChannels: string[] = []
        const gapTooLarge: string[] = []

        for (const [channelId, lastEventId] of entries) {
          if (typeof channelId !== "string" || typeof lastEventId !== "string") continue

          // Skip rooms the user is no longer authorized for.
          if (!allowedChannels.has(channelId)) continue

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
        const serverIds: string[] = []

        // Initialize socket state
        const state: GatewaySocketState = {
          userId,
          subscribedChannels: new Set(),
          serverIds,
        }
        socketStates.set(socket.id, state)
        socket.data.userId = userId

        // Set presence
        await presence.setOnline(userId, socket.id, status, serverIds)

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

/**
 * Force a user's socket(s) to leave a channel's gateway room, so a DM
 * member removal takes effect immediately instead of waiting for the
 * socket to reconnect — a still-connected socket would otherwise keep
 * receiving message/reaction events for a channel it was just removed from.
 *
 * Cluster-safe: io.in(room).fetchSockets() enumerates sockets on every
 * replica via the Redis adapter, and RemoteSocket.leave() works the same
 * way whether the socket is local or on another replica. socket.data.userId
 * (set in gateway:subscribe / gateway:init above) is what makes ownership
 * checkable on sockets this replica doesn't otherwise know about.
 */
export async function revokeChannelAccess(
  io: Server,
  targetUserId: string,
  channelId: string,
): Promise<void> {
  const room = `gateway:${channelId}`
  try {
    const sockets = await io.in(room).fetchSockets()
    for (const s of sockets) {
      if (s.data?.userId !== targetUserId) continue
      s.leave(room)
    }
  } catch (err) {
    log.error({ err, targetUserId, channelId }, "revokeChannelAccess error")
  }

  // Best-effort local bookkeeping — only reaches sockets on this replica;
  // harmless no-op for sockets that live elsewhere since room membership
  // (already revoked above) is what actually gates event delivery.
  for (const state of socketStates.values()) {
    if (state.userId === targetUserId) state.subscribedChannels.delete(channelId)
  }
}

/**
 * Publish a VortexEvent through the event bus.
 * Called from API routes when data is written to the database.
 */
export { RedisEventBus } from "./event-bus"
