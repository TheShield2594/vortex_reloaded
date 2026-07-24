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

/** Minimal in-memory stand-in for a connected Socket.IO socket. */
class FakeSocket {
  readonly id: string
  data: Record<string, unknown> = {}
  readonly joined = new Set<string>()
  readonly emissions: Emission[] = []
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

  on(event: string, handler: (socket: Socket) => void): this {
    if (event === "connection") this.connectionHandler = handler
    return this
  }

  to(): { emit: () => void } {
    return { emit: () => {} }
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
function makeOptions(granted: string[]): { io: FakeIo; options: GatewayOptions } {
  const io = new FakeIo()
  const grantedSet = new Set(granted)
  const options: GatewayOptions = {
    io: io as unknown as Server,
    eventBus: { subscribe: () => ({ unsubscribe: () => {} }) } as unknown as RedisEventBus,
    presence: { startCleanup: () => {} } as unknown as PresenceManager,
    validateSession: async () => true,
    getSessionUserId: () => "user-a",
    checkChannelAccess: async (_userId, channelIds) =>
      channelIds.filter((id) => grantedSet.has(id)),
  }
  return { io, options }
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
  // window is exhausted the socket is refused instead of hitting the membership
  // endpoint again.
  await check("subscribe is rate limited", async () => {
    const { io, options } = makeOptions(["dm-1"])
    initGateway(options)
    const socket = new FakeSocket("sock-ratelimit")
    io.connect(socket)
    for (let i = 0; i < 30; i++) {
      await socket.trigger("gateway:subscribe", { channelIds: ["dm-1"] })
    }
    const before = socket.emissions.length
    await socket.trigger("gateway:subscribe", { channelIds: ["dm-1"] })
    const err = socket.lastEmission("error") as { message: string } | undefined
    if (!err || !/rate limit/i.test(err.message))
      throw new Error("31st subscribe was not rate limited")
    if (socket.emissions.length === before) throw new Error("no emission on rate-limit rejection")
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
