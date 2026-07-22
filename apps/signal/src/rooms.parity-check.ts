import { writeFileSync, mkdirSync } from "node:fs"
import { InMemoryRoomManager } from "./rooms"

async function run() {
  const results: Array<{ name: string; pass: boolean; error?: string }> = []

  try {
    const rooms = new InMemoryRoomManager({ ttlMs: 5 * 60 * 1000 })
    await rooms.join("voice-1", {
      socketId: "socket-a", userId: "user-a", displayName: "A", muted: false, deafened: false, speaking: false, screenSharing: false, joinedAt: new Date(),
    })
    const existing = await rooms.join("voice-1", {
      socketId: "socket-b", userId: "user-b", displayName: "B", muted: false, deafened: false, speaking: false, screenSharing: false, joinedAt: new Date(),
    })
    if (existing.length !== 1 || (await rooms.getRoomSize("voice-1")) !== 2) throw new Error("join lifecycle assertion failed")
    results.push({ name: "join lifecycle", pass: true })
    rooms.destroy()
  } catch (error) {
    results.push({ name: "join lifecycle", pass: false, error: (error as Error).message })
  }

  try {
    const rooms = new InMemoryRoomManager({ ttlMs: 5 * 60 * 1000 })
    await rooms.join("voice-1", {
      socketId: "socket-old", userId: "user-a", displayName: "A", muted: false, deafened: false, speaking: true, screenSharing: false, joinedAt: new Date(),
    })
    await rooms.leave("voice-1", "socket-old")
    await rooms.join("voice-1", {
      socketId: "socket-new", userId: "user-a", displayName: "A", muted: false, deafened: false, speaking: false, screenSharing: false, joinedAt: new Date(),
    })
    if ((await rooms.getPeer("voice-1", "socket-old")) !== undefined) throw new Error("stale socket still exists")
    if ((await rooms.getPeer("voice-1", "socket-new"))?.userId !== "user-a") throw new Error("reconnected socket missing")
    results.push({ name: "reconnect lifecycle", pass: true })
    rooms.destroy()
  } catch (error) {
    results.push({ name: "reconnect lifecycle", pass: false, error: (error as Error).message })
  }

  mkdirSync(".reports", { recursive: true })
  writeFileSync(".reports/voice-parity.json", JSON.stringify({ success: results.every((r) => r.pass), results }, null, 2))
  if (results.some((r) => !r.pass)) process.exit(1)
}

run()
