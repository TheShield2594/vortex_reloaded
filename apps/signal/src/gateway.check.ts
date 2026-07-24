import { writeFileSync, mkdirSync } from "node:fs"
import type { Server, Socket } from "socket.io"
import { initGateway, stopGatewayCleanup, type GatewayOptions } from "./gateway"
import type { RedisEventBus } from "./event-bus"
import type { PresenceManager } from "./presence"

/**
 * Assertions for the real-time gateway's subscribe-authorization path
 * (apps/signal/src/gateway.ts — the code index.ts actually loads in production).
 * Run with `tsx src/gateway.check.ts`.
 *
 * The gateway registers its handlers on `io.on("connection")`. We drive it with
 * an in-memory Socket.IO double so the genuine handler logic — membership
 * gating (issue #51), rate limiting, and payload validation — runs unchanged.
 */

interface Emission {
  event: string
  payload: unknown
}

interface Broadcast {
  room: string
  event: string
  payload: unknown
}

/** Minimal in-memory stand-in for a connected Socket.IO socket. */
class FakeSocket {
  readonly id: string
  data: Record<string, unknown> = {}
  readonly joined = new Set<string>()
  readonly emissions: Emission[] = []
  /** Room-scoped broadcasts made via socket.to(room).emit(...). */
  readonly broadcasts: Broadcast[] = []
  /**
   * The raw room argument of every socket.to(...) call, so tests can assert
   * that a fan-out was a single multi-room broadcast (which Socket.IO
   * deduplicates) rather than one emit per room.
   */
  readonly toCalls: Array<string | string[]> = []
  private readonly handlers = new Map<string, (data: unknown) => unknown>()

  constructor(id: string) {
    this.id = id
  }

  on(event: string, handler: (data: unknown) => unknown): this {
    this.handlers.set(event, handler)
    return this
  }

  emit(event: string, payload?: unknown): boolean {
    this.emissions.push({ event, payload })
    return true
  }

  /**
   * socket.to(room).emit(event, payload) — record the room-scoped broadcast.
   * Accepts an array of rooms, which is how the gateway fans presence out in a
   * single deduplicated broadcast; each room is recorded separately so tests
   * can assert per-room delivery.
   */
  to(room: string | string[]): { emit: (event: string, payload?: unknown) => boolean } {
    this.toCalls.push(room)
    const rooms = Array.isArray(room) ? room : [room]
    return {
      emit: (event: string, payload?: unknown): boolean => {
        for (const r of rooms) this.broadcasts.push({ room: r, event, payload })
        return true
      },
    }
  }

  /** Broadcasts to a given room, in the order they were emitted (oldest first). */
  broadcastsTo(room: string): Broadcast[] {
    return this.broadcasts.filter((b) => b.room === room)
  }

  join(room: string): void {
    this.joined.add(room)
  }

  leave(room: string): void {
    this.joined.delete(room)
  }

  /** Invoke a registered incoming-event handler as if the client emitted it. */
  async trigger(event: string, data: unknown): Promise<void> {
    const handler = this.handlers.get(event)
    if (!handler) throw new Error(`no handler registered for ${event}`)
    await handler(data)
  }

  /** The payload of the last emission with the given event name, if any. */
  lastEmission(event: string): unknown {
    for (let i = this.emissions.length - 1; i >= 0; i--) {
      if (this.emissions[i].event === event) return this.emissions[i].payload
    }
    return undefined
  }
}

/** Minimal in-memory stand-in for the Socket.IO server. */
class FakeIo {
  private connectionHandler: ((socket: Socket) => void) | null = null
  /**
   * Server-scoped room broadcasts (io.to(room).emit). The disconnect handler
   * fans "offline" out this way — rather than via socket.to() — because the
   * socket has already left its rooms by then, so these are only visible here.
   */
  readonly broadcasts: Broadcast[] = []
  /** Sockets io.fetchSockets() reports; drives the "last socket" check. */
  connectedSockets: Array<{ data?: Record<string, unknown> }> = []

  on(event: string, handler: (socket: Socket) => void): this {
    if (event === "connection") this.connectionHandler = handler
    return this
  }

  to(room: string | string[]): { emit: (event: string, payload?: unknown) => void } {
    const rooms = Array.isArray(room) ? room : [room]
    return {
      emit: (event: string, payload?: unknown): void => {
        for (const r of rooms) this.broadcasts.push({ room: r, event, payload })
      },
    }
  }

  async fetchSockets(): Promise<Array<{ data?: Record<string, unknown> }>> {
    return this.connectedSockets
  }

  /** Broadcasts to a given room, in the order they were emitted (oldest first). */
  broadcastsTo(room: string): Broadcast[] {
    return this.broadcasts.filter((b) => b.room === room)
  }

  /** Simulate a socket connecting so the gateway registers its handlers. */
  connect(socket: FakeSocket): void {
    if (!this.connectionHandler) throw new Error("no connection handler registered")
    this.connectionHandler(socket as unknown as Socket)
  }
}

function sortedEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}

/**
 * Build gateway options whose channel-access checker grants exactly `granted`.
 * The event bus / presence managers are inert stubs — init only subscribes and
 * schedules a cleanup callback on them.
 */
function makeOptions(
  granted: string[]
): { io: FakeIo; options: GatewayOptions; stats: { channelAccessCalls: number } } {
  const io = new FakeIo()
  const grantedSet = new Set(granted)
  const stats = { channelAccessCalls: 0 }
  const options: GatewayOptions = {
    io: io as unknown as Server,
    eventBus: {
      subscribe: () => ({ unsubscribe: () => {} }),
      replay: async () => [],
    } as unknown as RedisEventBus,
    presence: {
      startCleanup: () => {},
      setOnline: async () => {},
      updateStatus: async () => {},
      setOffline: async () => {},
    } as unknown as PresenceManager,
    validateSession: async () => true,
    getSessionUserId: () => "user-a",
    checkChannelAccess: async (_userId, channelIds) => {
      stats.channelAccessCalls++
      return channelIds.filter((id) => grantedSet.has(id))
    },
  }
  return { io, options, stats }
}

async function run(): Promise<void> {
  const results: Array<{ name: string; pass: boolean; error?: string }> = []

  async function check(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
      results.push({ name, pass: true })
    } catch (error) {
      results.push({ name, pass: false, error: (error as Error).message })
    }
  }

  // Only the channels the membership check grants are joined; the rest are
  // reported back as denied so the client can reconcile (issue #51).
  await check("subscribe joins only authorized channels", async () => {
    const { io, options } = makeOptions(["dm-1", "user:user-a"])
    initGateway(options)
    const socket = new FakeSocket("sock-authz")
    io.connect(socket)
    await socket.trigger("gateway:subscribe", {
      channelIds: ["dm-1", "dm-2", "user:user-a"],
    })

    if (!socket.joined.has("gateway:dm-1")) throw new Error("did not join granted dm-1")
    if (!socket.joined.has("gateway:user:user-a")) throw new Error("did not join granted user channel")
    if (socket.joined.has("gateway:dm-2")) throw new Error("joined denied dm-2")

    const ack = socket.lastEmission("gateway:subscribed") as
      | { channelIds: string[]; denied: string[] }
      | undefined
    if (!ack) throw new Error("no gateway:subscribed ack emitted")
    if (!sortedEqual(ack.channelIds, ["dm-1", "user:user-a"]))
      throw new Error(`granted ${JSON.stringify(ack.channelIds)}`)
    if (!sortedEqual(ack.denied, ["dm-2"]))
      throw new Error(`denied ${JSON.stringify(ack.denied)}`)
  })

  // When the membership check grants nothing, no room is joined at all.
  await check("subscribe joins nothing when all denied", async () => {
    const { io, options } = makeOptions([])
    initGateway(options)
    const socket = new FakeSocket("sock-denyall")
    io.connect(socket)
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-9", "dm-8"] })

    if (socket.joined.size !== 0) throw new Error(`joined ${JSON.stringify([...socket.joined])}`)
    const ack = socket.lastEmission("gateway:subscribed") as
      | { channelIds: string[]; denied: string[] }
      | undefined
    if (!ack || ack.channelIds.length !== 0) throw new Error("granted a denied channel")
    if (!sortedEqual(ack.denied, ["dm-9", "dm-8"])) throw new Error(`denied ${JSON.stringify(ack?.denied)}`)
  })

  // A non-array channelIds payload is rejected with an error, never joined.
  await check("subscribe rejects malformed payload", async () => {
    const { io, options } = makeOptions(["dm-1"])
    initGateway(options)
    const socket = new FakeSocket("sock-badpayload")
    io.connect(socket)
    await socket.trigger("gateway:subscribe", { channelIds: "dm-1" })

    if (socket.joined.size !== 0) throw new Error("joined on malformed payload")
    const err = socket.lastEmission("error") as { message: string } | undefined
    if (!err) throw new Error("no error emitted for malformed payload")
  })

  // The subscribe path is rate limited (SUBSCRIBE_RATE_LIMIT = 30/min): once the
  // window is exhausted the socket is refused *before* the membership check runs,
  // so a client can't amplify load against the internal endpoint by spamming
  // subscribe.
  await check("subscribe is rate limited", async () => {
    const { io, options, stats } = makeOptions(["dm-1"])
    initGateway(options)
    const socket = new FakeSocket("sock-ratelimit")
    io.connect(socket)
    for (let i = 0; i < 30; i++) {
      await socket.trigger("gateway:subscribe", { channelIds: ["dm-1"] })
    }
    const callsAfter30 = stats.channelAccessCalls
    if (callsAfter30 !== 30)
      throw new Error(`expected 30 membership checks in-window, got ${callsAfter30}`)

    const before = socket.emissions.length
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-1"] })
    const err = socket.lastEmission("error") as { message: string } | undefined
    if (!err || !/rate limit/i.test(err.message))
      throw new Error("31st subscribe was not rate limited")
    if (socket.emissions.length === before) throw new Error("no emission on rate-limit rejection")
    // The rejected request must short-circuit before the membership check.
    if (stats.channelAccessCalls !== callsAfter30)
      throw new Error("rate-limited subscribe still hit the membership check")
  })

  // Presence fan-out (issue #58 §1): once gateway:init has supplied an
  // authoritative status, subscribing announces it to the DM rooms just joined
  // so co-members see the user come online.
  await check("subscribe fans presence out to joined DM rooms", async () => {
    const { io, options } = makeOptions(["dm-1", "dm-2"])
    initGateway(options)
    const socket = new FakeSocket("sock-presence-sub")
    io.connect(socket)
    await socket.trigger("gateway:init", { status: "online" })
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-1", "dm-2"] })

    for (const room of ["gateway:dm-1", "gateway:dm-2"]) {
      const pres = socket.broadcastsTo(room).find((b) => b.event === "gateway:presence")
      if (!pres) throw new Error(`no presence broadcast to ${room}`)
      const payload = pres.payload as { userId: string; status: string }
      if (payload.userId !== "user-a") throw new Error("presence userId wrong")
      if (payload.status !== "online") throw new Error(`presence status ${payload.status}`)
    }
  })

  // Nothing about a user's status may be broadcast before gateway:init
  // establishes it — otherwise a subscribe that wins the connect-time race
  // would announce an assumed "online" for a user who is actually invisible.
  await check("subscribe before init announces nothing", async () => {
    const { io, options } = makeOptions(["dm-1"])
    initGateway(options)
    const socket = new FakeSocket("sock-presence-preinit")
    io.connect(socket)
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-1"] })

    const pres = socket.broadcastsTo("gateway:dm-1").filter((b) => b.event === "gateway:presence")
    if (pres.length > 0)
      throw new Error(`announced presence before init: ${JSON.stringify(pres[0].payload)}`)
  })

  // The invisible-status race: subscribe wins, then init lands as "invisible".
  // The only presence ever broadcast must be "offline" — never a fabricated
  // "online" from the pre-init placeholder.
  await check("invisible init after subscribe never leaks online", async () => {
    const { io, options } = makeOptions(["dm-1"])
    initGateway(options)
    const socket = new FakeSocket("sock-presence-invis")
    io.connect(socket)
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-1"] })
    await socket.trigger("gateway:init", { status: "invisible" })

    const pres = socket.broadcastsTo("gateway:dm-1").filter((b) => b.event === "gateway:presence")
    if (pres.length === 0) throw new Error("init did not announce to already-joined room")
    for (const p of pres) {
      const status = (p.payload as { status: string }).status
      if (status !== "offline") throw new Error(`leaked status ${status} for invisible user`)
    }
  })

  // gateway:presence updates fan out to every subscribed DM room, and
  // "invisible" is masked to "offline" before it leaves the server.
  await check("presence update fans out to subscribed rooms; invisible→offline", async () => {
    const { io, options } = makeOptions(["dm-1"])
    initGateway(options)
    const socket = new FakeSocket("sock-presence-upd")
    io.connect(socket)
    await socket.trigger("gateway:init", { status: "online" })
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-1"] })
    socket.broadcasts.length = 0 // drop the on-join announce
    await socket.trigger("gateway:presence", { status: "invisible" })

    const pres = socket.broadcastsTo("gateway:dm-1").find((b) => b.event === "gateway:presence")
    if (!pres) throw new Error("no presence broadcast on status change")
    const payload = pres.payload as { status: string }
    if (payload.status !== "offline") throw new Error(`invisible not masked, got ${payload.status}`)
  })

  // Presence fans out in ONE broadcast across all rooms, so Socket.IO's union
  // delivers a single event to a co-member who shares several channels.
  await check("presence fan-out is a single broadcast across rooms", async () => {
    const { io, options } = makeOptions(["dm-1", "dm-2", "dm-3"])
    initGateway(options)
    const socket = new FakeSocket("sock-presence-single")
    io.connect(socket)
    await socket.trigger("gateway:init", { status: "online" })
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-1", "dm-2", "dm-3"] })
    socket.broadcasts.length = 0
    socket.toCalls.length = 0
    await socket.trigger("gateway:presence", { status: "idle" })

    const presenceCalls = socket.toCalls.filter((c) => Array.isArray(c) && c.length === 3)
    if (presenceCalls.length !== 1)
      throw new Error(`expected 1 multi-room broadcast, got ${JSON.stringify(socket.toCalls)}`)
  })

  // Typing relays only the authenticated userId — never a client-supplied
  // display name, which would let a member type under someone else's label.
  await check("typing broadcast carries userId and no displayName", async () => {
    const { io, options } = makeOptions(["dm-1"])
    initGateway(options)
    const socket = new FakeSocket("sock-typing")
    io.connect(socket)
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-1"] })
    await socket.trigger("gateway:typing", {
      channelId: "dm-1",
      isTyping: true,
      displayName: "Someone Else",
    })

    const typing = socket.broadcastsTo("gateway:dm-1").find((b) => b.event === "gateway:typing")
    if (!typing) throw new Error("no typing broadcast")
    const payload = typing.payload as Record<string, unknown>
    if (payload.userId !== "user-a") throw new Error(`typing userId ${String(payload.userId)}`)
    if ("displayName" in payload)
      throw new Error("typing broadcast relayed a client-supplied displayName")
  })

  // Disconnect fans "offline" to the user's DM rooms via io.to() (the socket
  // has already left its rooms by then) — but only when it was their LAST
  // socket, so closing one of two tabs doesn't mark the user offline.
  await check("disconnect announces offline when it is the user's last socket", async () => {
    const { io, options } = makeOptions(["dm-1"])
    initGateway(options)
    const socket = new FakeSocket("sock-disc-last")
    io.connect(socket)
    await socket.trigger("gateway:init", { status: "online" })
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-1"] })
    io.connectedSockets = [] // no sibling sockets remain
    await socket.trigger("disconnect", undefined)

    const pres = io.broadcastsTo("gateway:dm-1").find((b) => b.event === "gateway:presence")
    if (!pres) throw new Error("no offline broadcast on last-socket disconnect")
    if ((pres.payload as { status: string }).status !== "offline")
      throw new Error("disconnect broadcast was not offline")
  })

  await check("disconnect stays silent while another socket for the user remains", async () => {
    const { io, options } = makeOptions(["dm-1"])
    initGateway(options)
    const socket = new FakeSocket("sock-disc-sibling")
    io.connect(socket)
    await socket.trigger("gateway:init", { status: "online" })
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-1"] })
    // A second tab for the same user is still connected.
    io.connectedSockets = [{ data: { userId: "user-a" } }]
    await socket.trigger("disconnect", undefined)

    const pres = io.broadcastsTo("gateway:dm-1").filter((b) => b.event === "gateway:presence")
    if (pres.length > 0)
      throw new Error("marked user offline while another socket was still connected")
  })

  // Resume re-announces presence only to the rooms it actually rejoined.
  await check("resume re-announces presence to rejoined rooms only", async () => {
    const { io, options } = makeOptions(["dm-1", "dm-2"])
    initGateway(options)
    const socket = new FakeSocket("sock-resume")
    io.connect(socket)
    await socket.trigger("gateway:init", { status: "online" })
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-1"] })
    socket.broadcasts.length = 0
    // dm-1 is already joined; only dm-2 is newly rejoined by this resume.
    await socket.trigger("gateway:resume", { channels: { "dm-1": "0-0", "dm-2": "0-0" } })

    const toDm2 = socket.broadcastsTo("gateway:dm-2").filter((b) => b.event === "gateway:presence")
    const toDm1 = socket.broadcastsTo("gateway:dm-1").filter((b) => b.event === "gateway:presence")
    if (toDm2.length === 0) throw new Error("resume did not announce to newly rejoined dm-2")
    if (toDm1.length > 0) throw new Error("resume re-announced to already-joined dm-1")
  })

  // Init/subscribe race (issue #58 §4): a gateway:init arriving AFTER
  // gateway:subscribe must not wipe the already-joined subscribedChannels, or
  // subsequent typing/call-signal would be silently rejected by the guard.
  await check("gateway:init after subscribe preserves subscribedChannels", async () => {
    const { io, options } = makeOptions(["dm-1"])
    initGateway(options)
    const socket = new FakeSocket("sock-race")
    io.connect(socket)
    // subscribe wins the race first
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-1"] })
    // init lands afterwards — must not clobber
    await socket.trigger("gateway:init", { status: "online" })
    socket.broadcasts.length = 0

    // typing only broadcasts if the channel is still in subscribedChannels
    await socket.trigger("gateway:typing", { channelId: "dm-1", isTyping: true, displayName: "Grace" })
    const typing = socket.broadcastsTo("gateway:dm-1").find((b) => b.event === "gateway:typing")
    if (!typing) throw new Error("init clobbered subscribedChannels — typing was rejected")
  })

  stopGatewayCleanup()

  mkdirSync(".reports", { recursive: true })
  writeFileSync(
    ".reports/gateway.json",
    JSON.stringify({ success: results.every((r) => r.pass), results }, null, 2)
  )
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.error ? ` — ${r.error}` : ""}`)
  }
  if (results.some((r) => !r.pass)) process.exit(1)
}

run()
