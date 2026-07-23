import { createHash } from "crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "http"
import { Server, type Socket } from "socket.io"
import { createAdapter } from "@socket.io/redis-adapter"
import { createRemoteJWKSet, jwtVerify } from "jose"
import Redis from "ioredis"
import dotenv from "dotenv"
import pino from "pino"
import { InMemoryRoomManager, type IRoomManager } from "./rooms"
import { RedisRoomManager } from "./redis-rooms"
import { RedisEventBus } from "./event-bus"
import { PresenceManager } from "./presence"
import { initGateway, stopGatewayCleanup, revokeChannelAccess } from "./gateway"
import { SocketRateLimiter } from "./rate-limiter"

dotenv.config()

// ─── Per-socket rate limiter ─────────────────────────────────────────────────

const socketLimiter = new SocketRateLimiter().startCleanup()

// Rate limit presets (limit, windowMs)
const RATE_LIMITS = {
  joinRoom:      { limit: 10, windowMs: 60_000 },   // 10 joins/min
  voiceState:    { limit: 60, windowMs: 60_000 },    // 60 state changes/min
} as const

function checkSocketRate(socketId: string, action: keyof typeof RATE_LIMITS): boolean {
  const { limit, windowMs } = RATE_LIMITS[action]
  return socketLimiter.check(socketId, action, limit, windowMs)
}

// ─── Structured logger ───────────────────────────────────────────────────────

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino-pretty", options: { colorize: true } },
  }),
})

// ─── Env var validation ───────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3001", 10)
const REDIS_URL = process.env.REDIS_URL ?? ""
const rawOrigins = process.env.ALLOWED_ORIGINS ?? ""

if (!rawOrigins || rawOrigins === "*") {
  if (process.env.NODE_ENV === "production") {
    logger.error(
      "ALLOWED_ORIGINS must be set to a specific origin list in production (not '*'). " +
      "Set ALLOWED_ORIGINS=https://your-app.vercel.app in your environment."
    )
    process.exit(1)
  } else {
    logger.warn("ALLOWED_ORIGINS not set — allowing all origins (dev only)")
  }
}

const ALLOWED_ORIGINS = rawOrigins ? rawOrigins.split(",") : "*"

// ─── Better Auth JWKS (handshake auth) ────────────────────────────────────────
// Replaces the old supabase.auth.getUser() round-trip (see
// docs/better-auth-verification-spike.md §3): apps/web's `jwt` plugin
// (lib/auth/better-auth.ts) exposes a public JWKS at this URL; jose fetches
// and caches it internally (its own cooldown/retry, no hand-rolled cache
// needed here), then every handshake JWT is verified locally — no per-socket
// network call once the key set is warm, no shared secret with apps/web.
const AUTH_JWKS_URL = process.env.AUTH_JWKS_URL ?? ""
const AUTH_JWT_ISSUER = process.env.AUTH_JWT_ISSUER ?? ""
const AUTH_JWT_AUDIENCE = process.env.AUTH_JWT_AUDIENCE ?? "vortex-signal"

const jwks = AUTH_JWKS_URL ? createRemoteJWKSet(new URL(AUTH_JWKS_URL)) : null

if (!jwks) {
  logger.warn("AUTH_JWKS_URL not set — handshake auth verification disabled")
}

/**
 * Verifies a Better Auth-issued handshake JWT locally against the cached
 * JWKS. Returns the authenticated user id, or null if the token is missing,
 * expired, malformed, or signed by an unknown key.
 */
async function verifyAuthToken(token: string): Promise<string | null> {
  if (!jwks) return null
  // Deliberately doesn't catch here — jose throws for both "token is
  // invalid/expired" and "JWKS endpoint unreachable" alike, and
  // validateSession's caller already has fallback-to-cached-validation
  // logic for exactly that combined case (same as it did for whatever
  // supabase.auth.getUser() could throw, pre-cutover).
  const { payload } = await jwtVerify(token, jwks, {
    issuer: AUTH_JWT_ISSUER || undefined,
    audience: AUTH_JWT_AUDIENCE,
  })
  return typeof payload.sub === "string" ? payload.sub : null
}

// ─── HTTP server + Socket.IO ──────────────────────────────────────────────────

const REVOKE_TOKEN_SECRET = process.env.SIGNAL_REVOKE_SECRET ?? ""

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "ok" }))
    return
  }

  // ─── Token revocation endpoint ───────────────────────────────────────────
  // Called by the web app when a session is revoked (password change, logout,
  // admin action). Accepts { token } in the JSON body. Protected by a shared
  // secret so only the web backend can call it.
  if (req.url === "/revoke-token" && req.method === "POST") {
    try {
      if (!REVOKE_TOKEN_SECRET) {
        logger.warn("POST /revoke-token called but SIGNAL_REVOKE_SECRET is not configured")
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Revocation endpoint not configured" }))
        return
      }

      const authHeader = req.headers.authorization ?? ""
      if (authHeader !== `Bearer ${REVOKE_TOKEN_SECRET}`) {
        res.writeHead(401, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Unauthorized" }))
        return
      }

      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        let totalBytes = 0
        req.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length
          if (totalBytes > 4096) {
            reject(Object.assign(new Error("Body too large"), { statusCode: 413 }))
          } else {
            chunks.push(chunk)
          }
        })
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
        req.on("error", reject)
      })

      const parsed: unknown = JSON.parse(body)
      if (typeof parsed !== "object" || parsed === null) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Invalid JSON body" }))
        return
      }
      const { token } = parsed as { token?: unknown }
      if (typeof token !== "string" || !token) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing or invalid 'token' field" }))
        return
      }

      const persisted = await revokeToken(token)
      if (!persisted) {
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Failed to persist revocation" }))
        return
      }

      // Force-disconnect any sockets currently using this token.
      // io.fetchSockets() is cluster-safe — it enumerates sockets across all
      // replicas when the Redis adapter is attached.
      let disconnected = 0
      const sockets = await io.fetchSockets()
      for (const s of sockets) {
        if (s.handshake.auth?.token === token) {
          sessionValidationCache.delete(s.id)
          s.emit("error", { message: "Session revoked" })
          s.disconnect(true)
          disconnected++
        }
      }

      logger.info({ disconnected }, "token revoked — active sockets disconnected")
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true, disconnected }))
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 413) {
        res.writeHead(413, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Payload too large" }))
      } else {
        logger.error({ err }, "POST /revoke-token error")
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Internal server error" }))
      }
    }
    return
  }

  // ─── Gateway channel access revocation endpoint ─────────────────────────
  // Called by the web app when a user is removed from a DM/group channel, so
  // their already-connected socket(s) stop receiving message/reaction events
  // for it immediately rather than waiting for a reconnect. Protected by the
  // same shared secret as /revoke-token.
  if (req.url === "/revoke-channel-access" && req.method === "POST") {
    try {
      if (!REVOKE_TOKEN_SECRET) {
        logger.warn("POST /revoke-channel-access called but SIGNAL_REVOKE_SECRET is not configured")
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Endpoint not configured" }))
        return
      }

      const authHeader = req.headers.authorization ?? ""
      if (authHeader !== `Bearer ${REVOKE_TOKEN_SECRET}`) {
        res.writeHead(401, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Unauthorized" }))
        return
      }

      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        let totalBytes = 0
        req.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length
          if (totalBytes > 4096) {
            reject(Object.assign(new Error("Body too large"), { statusCode: 413 }))
          } else {
            chunks.push(chunk)
          }
        })
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
        req.on("error", reject)
      })

      const parsed: unknown = JSON.parse(body)
      if (typeof parsed !== "object" || parsed === null) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Invalid JSON body" }))
        return
      }
      const { userId, channelId } = parsed as Record<string, unknown>
      if (typeof userId !== "string" || !userId || typeof channelId !== "string" || !channelId) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing or invalid 'userId' and/or 'channelId' fields" }))
        return
      }

      await revokeChannelAccess(io, userId, channelId)

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 413) {
        res.writeHead(413, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Payload too large" }))
      } else {
        logger.error({ err }, "POST /revoke-channel-access error")
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Internal server error" }))
      }
    }
    return
  }

  // ─── Event publish endpoint ──────────────────────────────────────────
  // Called by API routes after a DB write to push events through the gateway.
  // Accepts a VortexEvent (minus id/timestamp) in the JSON body.
  if (req.url === "/publish-event" && req.method === "POST") {
    try {
      if (!REVOKE_TOKEN_SECRET) {
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Endpoint not configured" }))
        return
      }

      const authHeader = req.headers.authorization ?? ""
      if (authHeader !== `Bearer ${REVOKE_TOKEN_SECRET}`) {
        res.writeHead(401, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Unauthorized" }))
        return
      }

      if (!eventBus) {
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Event bus not available" }))
        return
      }

      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        let totalBytes = 0
        req.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length
          if (totalBytes > 4096) {
            reject(Object.assign(new Error("Body too large"), { statusCode: 413 }))
          } else {
            chunks.push(chunk)
          }
        })
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
        req.on("error", reject)
      })

      const parsed: unknown = JSON.parse(body)
      if (typeof parsed !== "object" || parsed === null) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Invalid JSON body" }))
        return
      }

      const event = parsed as Record<string, unknown>
      if (typeof event.type !== "string" || typeof event.channelId !== "string" || typeof event.actorId !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing required fields: type, channelId, actorId" }))
        return
      }

      const eventId = await eventBus.publish({
        type: event.type as string as import("@vortex/shared").VortexEventType,
        channelId: String(event.channelId),
        serverId: typeof event.serverId === "string" ? event.serverId : null,
        actorId: String(event.actorId),
        data: event.data ?? null,
      })

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true, eventId }))
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 413) {
        res.writeHead(413, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Payload too large" }))
      } else {
        logger.error({ err }, "POST /publish-event error")
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Internal server error" }))
      }
    }
    return
  }

  res.writeHead(404)
  res.end()
})

const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 20000,
  pingInterval: 10000,
  perMessageDeflate: true,
})

// ─── Socket.IO Redis adapter (horizontal scaling) ────────────────────────────
// When REDIS_URL is set we attach the Redis adapter so that socket-room
// broadcasts (io.to(channelId).emit) are fanned out to ALL signal-server
// replicas.  Two separate ioredis clients are required: one for publish,
// one for the blocking subscribe channel.

if (REDIS_URL) {
  const pubClient = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 })
  const subClient = pubClient.duplicate()
  io.adapter(createAdapter(pubClient, subClient))
  logger.info("Socket.IO using Redis adapter (multi-instance mode)")
} else {
  logger.info("Socket.IO using in-memory adapter (single-instance mode)")
}

const rooms: IRoomManager = REDIS_URL
  ? new RedisRoomManager(REDIS_URL)
  : new InMemoryRoomManager()

if (REDIS_URL) {
  logger.info("room state backed by Redis")
} else {
  logger.info("room state backed by in-memory Map (set REDIS_URL to enable Redis)")
}

// ─── Gateway: Event Bus + Presence Manager ───────────────────────────────────
// When REDIS_URL is set, initialize the unified real-time gateway that handles
// message delivery, typing indicators, presence, and reconnection catch-up
// via Socket.IO instead of Supabase Realtime.

let eventBus: RedisEventBus | null = null
let presenceManager: PresenceManager | null = null

if (REDIS_URL) {
  eventBus = new RedisEventBus(REDIS_URL)
  presenceManager = new PresenceManager(REDIS_URL)
  logger.info("event bus and presence manager initialized (Redis-backed)")
} else {
  logger.info("event bus and presence manager disabled (no REDIS_URL)")
}

// ─── Session re-validation cache for signaling events ────────────────────────
// Re-validate the auth token periodically instead of on every event.
const SESSION_REVALIDATION_TTL_MS = 10_000
// Maximum age of a cached entry that can be used as fallback on transient auth
// service errors. Kept short to limit the window in which a revoked token
// remains usable when the auth service is unreachable.
const SESSION_FALLBACK_MAX_AGE_MS = 15_000
const sessionValidationCache = new Map<string, { validatedAt: number; userId: string }>()

// ─── Token revocation list (Redis-backed when available) ─────────────────────
// When sessions are revoked (password change, admin action, logout) the web app
// POSTs to /revoke-token so the signal server can immediately reject the token
// without waiting for the next Supabase revalidation cycle.
//
// Tokens are stored as SHA-256 digests — never store raw bearer tokens in Redis
// or process memory to limit blast radius of a key scan or memory dump.
const REVOCATION_PREFIX = "vortex:revoked-token"
const REVOCATION_TTL_SECONDS = 3600 // keep entries for 1 hour then auto-expire

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

let revocationRedis: Redis | null = null
if (REDIS_URL) {
  revocationRedis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 })
  logger.info("token revocation list backed by Redis")
}
// In-memory fallback for single-instance deployments without Redis
const inMemoryRevocations = new Map<string, number>()

async function isTokenRevoked(token: string): Promise<boolean> {
  const digest = hashToken(token)
  try {
    if (revocationRedis) {
      const exists = await revocationRedis.exists(`${REVOCATION_PREFIX}:${digest}`)
      return exists === 1
    }
    const expiresAt = inMemoryRevocations.get(digest)
    if (expiresAt === undefined) return false
    if (Date.now() > expiresAt) {
      inMemoryRevocations.delete(digest)
      return false
    }
    return true
  } catch (err) {
    logger.error({ err }, "revocation check failed — failing closed (denying)")
    return true // fail closed: if we can't check, assume revoked
  }
}

async function revokeToken(token: string): Promise<boolean> {
  const digest = hashToken(token)
  try {
    if (revocationRedis) {
      await revocationRedis.set(
        `${REVOCATION_PREFIX}:${digest}`,
        "1",
        "EX",
        REVOCATION_TTL_SECONDS,
      )
    } else {
      inMemoryRevocations.set(digest, Date.now() + REVOCATION_TTL_SECONDS * 1000)
    }
    return true
  } catch (err) {
    logger.error({ err }, "failed to persist token revocation")
    return false
  }
}

// Periodic cleanup of expired in-memory revocations
setInterval(() => {
  const now = Date.now()
  for (const [digest, expiresAt] of inMemoryRevocations) {
    if (now > expiresAt) inMemoryRevocations.delete(digest)
  }
}, 60_000)


async function validateSession(socket: Socket): Promise<boolean> {
  if (!jwks) return true // skip if no JWKS configured

  const authToken = socket.handshake.auth?.token
  if (!authToken) return false

  // Always check revocation list first — an explicitly revoked token must
  // never be accepted, regardless of cache state. Necessary here in a way it
  // wasn't for Supabase's opaque token: a Better Auth handshake JWT verifies
  // as valid locally right up until its (short, 15-minute) expiry, with no
  // way to invalidate it early on its own — this revocation check is what
  // makes password changes / forced logout / admin actions actually take
  // effect before that expiry (see docs/better-auth-verification-spike.md §3).
  if (await isTokenRevoked(authToken)) {
    logger.warn({ socketId: socket.id }, "session rejected — token is on revocation list")
    sessionValidationCache.delete(socket.id)
    socket.disconnect(true)
    return false
  }

  const cached = sessionValidationCache.get(socket.id)
  if (cached && Date.now() - cached.validatedAt < SESSION_REVALIDATION_TTL_MS) {
    return true
  }

  try {
    const userId = await verifyAuthToken(authToken)
    if (!userId) {
      sessionValidationCache.delete(socket.id)
      return false
    }
    sessionValidationCache.set(socket.id, { validatedAt: Date.now(), userId })
    return true
  } catch (err) {
    // On transient errors (e.g. JWKS endpoint temporarily unreachable),
    // allow only if we have a recent cached validation
    if (cached && Date.now() - cached.validatedAt < SESSION_FALLBACK_MAX_AGE_MS) {
      logger.warn(
        { socketId: socket.id, userId: cached.userId, cachedAgeMs: Date.now() - cached.validatedAt, err },
        "session revalidation failed — using cached validation (session_fallback_used)"
      )
      return true
    }
    // Fallback expired — force disconnect to prevent stale token reuse
    logger.error({ socketId: socket.id, err }, "session revalidation failed — fallback expired, disconnecting")
    sessionValidationCache.delete(socket.id)
    socket.disconnect(true)
    return false
  }
}

// ─── Initialize Gateway (unified real-time event delivery) ──────────────────
if (eventBus && presenceManager) {
  initGateway({
    io,
    eventBus,
    presence: presenceManager,
    validateSession: async (socket: Socket) => validateSession(socket),
    getSessionUserId: (socket: Socket) => sessionValidationCache.get(socket.id)?.userId,
  })
}

io.on("connection", (socket: Socket) => {
  logger.info({ socketId: socket.id }, "client connected")

  // ─── Join a voice room ──────────────────────────────────────────────────────
  socket.on("join-room", async (data: unknown) => {
    try {
      if (typeof data !== "object" || data === null) {
        socket.emit("error", { message: "Invalid join-room payload" })
        return
      }

      const payload = data as Record<string, unknown>
      const channelId = payload.channelId
      const clientUserId = payload.userId
      let displayName = payload.displayName
      let avatarUrl = payload.avatarUrl

      if (typeof channelId !== "string" || !channelId || typeof clientUserId !== "string" || !clientUserId) {
        socket.emit("error", { message: "channelId and userId are required" })
        return
      }

      if (!checkSocketRate(socket.id, "joinRoom")) {
        socket.emit("error", { message: "Rate limited — too many join requests" })
        return
      }

      // Type guard and length validation for displayName / avatarUrl
      if (displayName !== undefined && typeof displayName !== "string") {
        socket.emit("error", { message: "displayName must be a string" })
        return
      }
      if (avatarUrl !== undefined && typeof avatarUrl !== "string") {
        socket.emit("error", { message: "avatarUrl must be a string" })
        return
      }
      if (displayName && displayName.length > 100) {
        socket.emit("error", { message: "displayName must not exceed 100 characters" })
        return
      }
      if (avatarUrl && avatarUrl.length > 2048) {
        socket.emit("error", { message: "avatarUrl must not exceed 2048 characters" })
        return
      }

      if (!(await validateSession(socket))) {
        socket.emit("error", { message: "Unauthorized" })
        return
      }

      // Prefer the Better Auth-verified session userId over the
      // client-supplied one — never trust client-provided identity when a
      // verified session is available (see #45 review).
      const userId = sessionValidationCache.get(socket.id)?.userId ?? clientUserId

      // Join socket.io room
      socket.join(channelId)

      // Register peer in room manager
      const existingPeers = await rooms.join(channelId, {
        socketId: socket.id,
        userId,
        displayName,
        avatarUrl,
        muted: false,
        deafened: false,
        speaking: false,
        screenSharing: false,
        joinedAt: new Date(),
      })

      // Send existing peers to new joiner
      socket.emit("room-peers", existingPeers.map((p) => ({
        peerId: p.socketId,
        userId: p.userId,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        muted: p.muted,
        deafened: p.deafened,
        screenSharing: p.screenSharing,
      })))

      // Notify existing peers about new joiner
      socket.to(channelId).emit("peer-joined", {
        peerId: socket.id,
        userId,
        displayName,
        avatarUrl,
      })

      logger.info({ userId, channelId, peers: await rooms.getRoomSize(channelId) }, "user joined room")
    } catch (err) {
      logger.error({ socketId: socket.id, err }, "join-room handler error")
      socket.emit("error", { message: "Internal server error" })
    }
  })

  // ─── Voice state events ─────────────────────────────────────────────────────

  socket.on("speaking", async (payload: unknown) => {
    try {
      if (typeof payload !== "object" || payload === null) return
      const { speaking } = payload as { speaking?: unknown }
      if (typeof speaking !== "boolean") return
      if (!checkSocketRate(socket.id, "voiceState")) return
      if (!(await validateSession(socket))) return
      const peer = await findPeerRoom(socket.id)
      if (!peer) return

      await rooms.updatePeer(peer.channelId, socket.id, { speaking })
      socket.to(peer.channelId).emit("peer-speaking", { peerId: socket.id, speaking })
    } catch (err) {
      logger.error({ socketId: socket.id, event: "speaking", err }, "voice state handler error")
    }
  })

  socket.on("toggle-mute", async (payload: unknown) => {
    try {
      if (typeof payload !== "object" || payload === null) return
      const { muted } = payload as { muted?: unknown }
      if (typeof muted !== "boolean") return
      if (!checkSocketRate(socket.id, "voiceState")) return
      if (!(await validateSession(socket))) return
      const peer = await findPeerRoom(socket.id)
      if (!peer) return

      await rooms.updatePeer(peer.channelId, socket.id, { muted })
      socket.to(peer.channelId).emit("peer-muted", { peerId: socket.id, muted })
    } catch (err) {
      logger.error({ socketId: socket.id, event: "toggle-mute", err }, "voice state handler error")
    }
  })

  socket.on("toggle-deafen", async (payload: unknown) => {
    try {
      if (typeof payload !== "object" || payload === null) return
      const { deafened } = payload as { deafened?: unknown }
      if (typeof deafened !== "boolean") return
      if (!checkSocketRate(socket.id, "voiceState")) return
      if (!(await validateSession(socket))) return
      const peer = await findPeerRoom(socket.id)
      if (!peer) return

      await rooms.updatePeer(peer.channelId, socket.id, { deafened })
      socket.to(peer.channelId).emit("peer-deafened", { peerId: socket.id, deafened })
    } catch (err) {
      logger.error({ socketId: socket.id, event: "toggle-deafen", err }, "voice state handler error")
    }
  })

  socket.on("screen-share", async (payload: unknown) => {
    try {
      if (typeof payload !== "object" || payload === null) return
      const { sharing } = payload as { sharing?: unknown }
      if (typeof sharing !== "boolean") return
      if (!checkSocketRate(socket.id, "voiceState")) return
      if (!(await validateSession(socket))) return
      const peer = await findPeerRoom(socket.id)
      if (!peer) return

      await rooms.updatePeer(peer.channelId, socket.id, { screenSharing: sharing })
      socket.to(peer.channelId).emit("peer-screen-share", { peerId: socket.id, sharing })
    } catch (err) {
      logger.error({ socketId: socket.id, event: "screen-share", err }, "voice state handler error")
    }
  })

  // ─── Leave room explicitly ──────────────────────────────────────────────────
  socket.on("leave-room", async (payload: unknown) => {
    try {
      if (typeof payload !== "object" || payload === null) return
      const { channelId } = payload as { channelId?: unknown }
      if (typeof channelId !== "string" || !channelId) return
      await handleLeave(socket, channelId)
    } catch (err) {
      logger.error({ socketId: socket.id, err }, "leave-room handler error")
    }
  })

  // ─── Room TTL refresh ────────────────────────────────────────────────────────
  // Periodically refresh Redis key TTLs so active sessions don't expire while
  // stale keys from crashed processes auto-evict after the TTL window.
  const ttlRefreshInterval = rooms.refreshTtl
    ? setInterval(() => {
        rooms.refreshTtl!(socket.id).catch((err) => {
          logger.warn({ socketId: socket.id, err }, "room TTL refresh failed")
        })
      }, 120_000) // every 2 minutes (well within the 5-minute default TTL)
    : null

  // ─── Disconnect ─────────────────────────────────────────────────────────────
  socket.on("disconnect", async (reason: string) => {
    logger.info({ socketId: socket.id, reason }, "client disconnected")
    if (ttlRefreshInterval) clearInterval(ttlRefreshInterval)
    socketLimiter.remove(socket.id)
    sessionValidationCache.delete(socket.id)
    try {
      const left = await rooms.leaveAll(socket.id)

      for (const { channelId, userId } of left) {
        socket.to(channelId).emit("peer-left", { peerId: socket.id, userId })
      }
    } catch (err) {
      logger.error({ socketId: socket.id, reason, err }, "disconnect cleanup error")
    }
  })

  // ─── Helper ─────────────────────────────────────────────────────────────────
  async function findPeerRoom(socketId: string): Promise<{ channelId: string; userId: string } | null> {
    try {
      const socketRooms = Array.from(socket.rooms).filter((r) => r !== socket.id)
      for (const channelId of socketRooms) {
        const peer = await rooms.getPeer(channelId, socketId)
        if (peer) return { channelId, userId: peer.userId }
      }
      return null
    } catch (err) {
      logger.error({ socketId, err }, "findPeerRoom error")
      return null
    }
  }

  async function handleLeave(socket: Socket, channelId: string): Promise<void> {
    try {
      const peer = await rooms.getPeer(channelId, socket.id)
      if (!peer) return

      await rooms.leave(channelId, socket.id)
      socket.leave(channelId)
      socket.to(channelId).emit("peer-left", { peerId: socket.id, userId: peer.userId })

      logger.info({ userId: peer.userId, channelId }, "user left room")
    } catch (err) {
      logger.error({ socketId: socket.id, channelId, err }, "handleLeave error")
    }
  }
})

httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, "Vortex WebRTC signaling server listening")
})

// ─── Graceful shutdown with connection draining ────────────────────────────
// When SIGTERM is received (e.g. during deployment), stop accepting new
// connections immediately but give existing connections up to 30 seconds
// to finish in-flight signaling before forcefully closing them.

const DRAIN_TIMEOUT_MS = 30_000

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal, drainTimeoutMs: DRAIN_TIMEOUT_MS }, "graceful shutdown initiated — draining connections")

  // 0. Stop rate-limiter cleanup timers so they don't keep the event loop alive
  socketLimiter.stopCleanup()
  stopGatewayCleanup()

  // 1. Stop accepting new HTTP connections and wait for in-flight requests
  //    to complete.
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve())
  })

  // 2. Notify connected clients that the server is going down so they can
  //    reconnect to another replica.  Socket.IO clients handle "disconnect"
  //    events with automatic reconnection by default.
  const connectedSockets = [...io.of("/").sockets.values()]
  const socketCount = connectedSockets.length
  logger.info({ socketCount }, "notifying connected clients of pending shutdown")

  // Emit a custom event so smart clients can start reconnecting to other replicas
  for (const socket of connectedSockets) {
    try {
      socket.emit("server-shutdown", { drainMs: DRAIN_TIMEOUT_MS })
    } catch {
      // Best-effort notification — socket may already be closing
    }
  }

  // 3. Wait for connections to drain naturally (clients disconnect after
  //    receiving the shutdown notice) up to the drain timeout.
  const drainStart = Date.now()
  await new Promise<void>((resolve) => {
    const checkInterval = setInterval(async () => {
      const remaining = [...io.of("/").sockets.values()]
      const elapsed = Date.now() - drainStart

      if (remaining.length === 0) {
        logger.info({ elapsedMs: elapsed }, "all connections drained cleanly")
        clearInterval(checkInterval)
        resolve()
        return
      }

      if (elapsed >= DRAIN_TIMEOUT_MS) {
        logger.warn(
          { remainingConnections: remaining.length, elapsedMs: elapsed },
          "drain timeout reached — forcefully closing remaining connections"
        )
        clearInterval(checkInterval)
        resolve()
        return
      }
    }, 1_000)
  })

  // 4. Force-close remaining sockets — this triggers each socket's
  //    "disconnect" handler which calls rooms.leaveAll() with full
  //    side-effects (peer-left emit).
  io.close()

  // 5. Close Redis room manager connections
  if (rooms && "redis" in rooms) {
    try {
      await (rooms as { redis: Redis }).redis.quit()
    } catch {
      // Best-effort cleanup
    }
  }
  if (revocationRedis) {
    try {
      await revocationRedis.quit()
    } catch {
      // Best-effort cleanup
    }
  }

  // 6. Shut down event bus and presence manager
  if (eventBus) {
    try {
      await eventBus.destroy()
    } catch {
      // Best-effort cleanup
    }
  }
  if (presenceManager) {
    try {
      await presenceManager.destroy()
    } catch {
      // Best-effort cleanup
    }
  }

  logger.info("shutdown complete")
  process.exit(0)
}

process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch((err) => {
    logger.error({ err }, "graceful shutdown failed")
    process.exit(1)
  })
})
process.on("SIGINT", () => {
  gracefulShutdown("SIGINT").catch((err) => {
    logger.error({ err }, "graceful shutdown failed")
    process.exit(1)
  })
})