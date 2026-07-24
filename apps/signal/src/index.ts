import { createHash } from "crypto"
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

// Base URL of apps/web, used to authorize DM channel-room subscriptions
// (issue #51). Same host as AUTH_JWKS_URL — reachable from wherever apps/signal
// runs, not necessarily the public browser origin. Trailing slash trimmed.
const WEB_APP_URL = (process.env.WEB_APP_URL ?? "").replace(/\/$/, "")

// Membership authorizer for gateway:subscribe / gateway:resume. When the web
// app URL or shared secret is missing we pass null, which allows DM channels
// with a warning (dev parity with validateSession's JWKS-less skip). In
// production both must be set or DM room subscriptions go unauthorized.
if (process.env.NODE_ENV === "production" && (!WEB_APP_URL || !REVOKE_TOKEN_SECRET)) {
  logger.error(
    "WEB_APP_URL and SIGNAL_REVOKE_SECRET must both be set in production so gateway " +
    "channel subscriptions are authorized (issue #51). DM channel membership is NOT " +
    "enforced until these are configured."
  )
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