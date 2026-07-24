import { createServer, type IncomingMessage, type ServerResponse } from "http"
import { Server, type Socket } from "socket.io"
import { createAdapter } from "@socket.io/redis-adapter"
import { createRemoteJWKSet, jwtVerify } from "jose"
import Redis from "ioredis"
import dotenv from "dotenv"
import pino from "pino"
import { RedisEventBus } from "./event-bus"
import { PresenceManager } from "./presence"
import { initGateway, stopGatewayCleanup, revokeChannelAccess } from "./gateway"
import { createChannelAccessChecker } from "./channel-access"
import { SessionRevocationStore } from "./revocation"

dotenv.config()

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

interface VerifiedClaims {
  userId: string
  /** JWT `iat` (issued-at, epoch seconds). 0 when the token omits it. */
  iat: number
}

/**
 * Verifies a Better Auth-issued handshake JWT locally against the cached
 * JWKS. Returns the authenticated user id and its issued-at, or null if the
 * token is missing, expired, malformed, or signed by an unknown key.
 *
 * `iat` is surfaced so the per-user revocation cutoff (see below) can reject
 * only tokens minted *before* a revocation while still admitting the fresh
 * token a still-authorized device fetches on its reconnect.
 */
async function verifyAuthToken(token: string): Promise<VerifiedClaims | null> {
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
  if (typeof payload.sub !== "string") return null
  return { userId: payload.sub, iat: typeof payload.iat === "number" ? payload.iat : 0 }
}

// ─── HTTP server + Socket.IO ──────────────────────────────────────────────────

const REVOKE_TOKEN_SECRET = process.env.SIGNAL_REVOKE_SECRET ?? ""

// Base URL of apps/web, used to authorize DM channel-room subscriptions
// (issue #51). Same host as AUTH_JWKS_URL — reachable from wherever apps/signal
// runs, not necessarily the public browser origin. Trailing slash trimmed.
const WEB_APP_URL = (process.env.WEB_APP_URL ?? "").replace(/\/$/, "")

// Membership authorizer for gateway:subscribe / gateway:resume. Both the web
// app URL and shared secret are REQUIRED to authorize DM/group channel rooms
// (issue #51). In production, refuse to start when either is missing — running
// with the null checker would deny all DM subscriptions and silently break
// real-time, so fail fast and loud instead (same posture as ALLOWED_ORIGINS
// above). Outside production the null checker is a fail-closed dev fallback.
if (process.env.NODE_ENV === "production" && (!WEB_APP_URL || !REVOKE_TOKEN_SECRET)) {
  logger.error(
    "WEB_APP_URL and SIGNAL_REVOKE_SECRET must both be set in production so gateway " +
    "channel subscriptions can be authorized (issue #51). Refusing to start."
  )
  process.exit(1)
}
const channelAccessChecker = createChannelAccessChecker(
  WEB_APP_URL && REVOKE_TOKEN_SECRET
    ? { webAppUrl: WEB_APP_URL, secret: REVOKE_TOKEN_SECRET }
    : null,
)

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "ok" }))
    return
  }

  // ─── Session revocation endpoint ─────────────────────────────────────────
  // Called by the web app when a user's sessions are invalidated — password
  // change, forced logout / session revocation, or account deletion (see
  // apps/web/lib/auth/better-auth.ts hooks). Accepts { userId } in the JSON
  // body and revokes every gateway token that user holds *now*: their live
  // sockets are force-disconnected and any handshake JWT minted before this
  // moment is rejected until it expires. A device whose Better Auth session
  // is still valid simply reconnects with a freshly-minted token and carries
  // on; a device whose session was revoked can no longer mint one and stays
  // out. Protected by a shared secret so only the web backend can call it.
  if (req.url === "/revoke-sessions" && req.method === "POST") {
    try {
      if (!REVOKE_TOKEN_SECRET) {
        logger.warn("POST /revoke-sessions called but SIGNAL_REVOKE_SECRET is not configured")
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
      const { userId } = parsed as { userId?: unknown }
      if (typeof userId !== "string" || !userId) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing or invalid 'userId' field" }))
        return
      }

      const persisted = await revokeUserSessions(userId)
      if (!persisted) {
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Failed to persist revocation" }))
        return
      }

      // Force-disconnect any of the user's live sockets. io.fetchSockets() is
      // cluster-safe — it enumerates sockets across all replicas when the
      // Redis adapter is attached, and socket.data.userId (set in
      // gateway:init / gateway:subscribe) identifies ownership on sockets this
      // replica doesn't otherwise know about.
      let disconnected = 0
      const sockets = await io.fetchSockets()
      for (const s of sockets) {
        if (s.data?.userId === userId) {
          sessionValidationCache.delete(s.id)
          s.emit("error", { message: "Session revoked" })
          s.disconnect(true)
          disconnected++
        }
      }

      logger.info({ userId, disconnected }, "user sessions revoked — active sockets disconnected")
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true, disconnected }))
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 413) {
        res.writeHead(413, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Payload too large" }))
      } else {
        logger.error({ err }, "POST /revoke-sessions error")
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
  // same shared secret as /revoke-sessions.
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
const sessionValidationCache = new Map<string, { validatedAt: number; userId: string; iat: number }>()

// ─── Per-user session revocation (Redis-backed when available) ───────────────
// When a user's sessions are invalidated (password change, forced logout /
// session revocation, account deletion) the web app POSTs their userId to
// /revoke-sessions. The store records a per-user "revoked before" cutoff so
// any handshake JWT for that user minted before it is rejected on the spot.
// See ./revocation.ts for why this is keyed by user + issued-at rather than by
// token string.
let revocationRedis: Redis | null = null
if (REDIS_URL) {
  revocationRedis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 })
  logger.info("session revocation list backed by Redis")
}
const revocationStore = new SessionRevocationStore(revocationRedis)

/**
 * True when the token predates a revocation of the user's sessions. Fails
 * closed (treats as revoked) if the backing store can't be reached, matching
 * the pre-existing posture.
 */
async function isSessionRevoked(userId: string, tokenIatSeconds: number): Promise<boolean> {
  try {
    return await revocationStore.isRevoked(userId, tokenIatSeconds)
  } catch (err) {
    logger.error({ err }, "revocation check failed — failing closed (denying)")
    return true // fail closed: if we can't check, assume revoked
  }
}

async function revokeUserSessions(userId: string): Promise<boolean> {
  const persisted = await revocationStore.revoke(userId)
  if (!persisted) logger.error({ userId }, "failed to persist session revocation")
  return persisted
}

// Periodic cleanup of expired in-memory revocations
setInterval(() => revocationStore.pruneExpired(), 60_000)


/**
 * Disconnects a socket whose session has been revoked and clears its cache
 * entry. A Better Auth handshake JWT verifies as valid locally right up until
 * its (short, 15-minute) expiry, with no way to invalidate it early on its
 * own — this per-user revocation check is what makes password changes /
 * forced logout / account deletion actually take effect before that expiry
 * (see docs/better-auth-verification-spike.md §3 and the /revoke-sessions
 * endpoint above).
 */
function rejectRevokedSession(socket: Socket): false {
  logger.warn({ socketId: socket.id }, "session rejected — user sessions revoked")
  sessionValidationCache.delete(socket.id)
  socket.disconnect(true)
  return false
}

async function validateSession(socket: Socket): Promise<boolean> {
  if (!jwks) return true // skip if no JWKS configured

  const authToken = socket.handshake.auth?.token
  if (!authToken) return false

  const cached = sessionValidationCache.get(socket.id)

  // Fast path: recently validated. Still re-check the per-user revocation
  // cutoff on every call (a single cheap store read) so a revocation that
  // lands mid-cache-window takes effect immediately rather than after the
  // 10s revalidation TTL. The cutoff is keyed by user and compared against
  // the token's issued-at, so this must run against the token's own claims —
  // hence caching userId + iat alongside the validation timestamp.
  if (cached && Date.now() - cached.validatedAt < SESSION_REVALIDATION_TTL_MS) {
    if (await isSessionRevoked(cached.userId, cached.iat)) return rejectRevokedSession(socket)
    return true
  }

  try {
    const claims = await verifyAuthToken(authToken)
    if (!claims) {
      sessionValidationCache.delete(socket.id)
      return false
    }
    if (await isSessionRevoked(claims.userId, claims.iat)) return rejectRevokedSession(socket)
    sessionValidationCache.set(socket.id, { validatedAt: Date.now(), userId: claims.userId, iat: claims.iat })
    return true
  } catch (err) {
    // On transient errors (e.g. JWKS endpoint temporarily unreachable),
    // allow only if we have a recent cached validation — but never admit a
    // token whose user has since been revoked.
    if (cached && Date.now() - cached.validatedAt < SESSION_FALLBACK_MAX_AGE_MS) {
      if (await isSessionRevoked(cached.userId, cached.iat)) return rejectRevokedSession(socket)
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
    checkChannelAccess: channelAccessChecker,
  })
}

io.on("connection", (socket: Socket) => {
  logger.info({ socketId: socket.id }, "client connected")

  socket.on("disconnect", (reason: string) => {
    logger.info({ socketId: socket.id, reason }, "client disconnected")
    sessionValidationCache.delete(socket.id)
  })
})

httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, "Vortex signal server listening")
})

// ─── Graceful shutdown with connection draining ────────────────────────────
// When SIGTERM is received (e.g. during deployment), stop accepting new
// connections immediately but give existing connections up to 30 seconds
// to finish in-flight signaling before forcefully closing them.

const DRAIN_TIMEOUT_MS = 30_000

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal, drainTimeoutMs: DRAIN_TIMEOUT_MS }, "graceful shutdown initiated — draining connections")

  // 0. Stop rate-limiter cleanup timers so they don't keep the event loop alive
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
  //    "disconnect" handler.
  io.close()

  // 5. Close Redis connections
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