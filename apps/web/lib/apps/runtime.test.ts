import { describe, expect, it, vi } from "vitest"
import {
  AppInteractionRuntime,
  redactCredentials,
  validateInstallPermissions,
} from "@/lib/apps/runtime"

describe("apps runtime", () => {
  it("registers and executes slash-like commands", async () => {
    const runtime = new AppInteractionRuntime()
    runtime.registerCommand({
      name: "/status",
      appId: "app-1",
      execute: ({ payload }) => ({ ok: true, message: String(payload?.text ?? "ok") }),
    })

    const result = await runtime.executeCommand("/status", {
      appId: "app-1",
      serverId: "server-1",
      actorId: "user-1",
      payload: { text: "green" },
    })

    expect(result.ok).toBe(true)
    expect(result.message).toBe("green")
  })

  it("fails unregistered commands", async () => {
    const runtime = new AppInteractionRuntime()
    const result = await runtime.executeCommand("/missing", {
      appId: "app-1",
      serverId: "server-1",
      actorId: "user-1",
    })
    expect(result.ok).toBe(false)
  })

  it("isolates commands by app id", async () => {
    const runtime = new AppInteractionRuntime()
    runtime.registerCommand({
      name: "/status",
      appId: "app-1",
      execute: () => ({ ok: true, message: "ok" }),
    })

    const result = await runtime.executeCommand("/status", {
      appId: "app-2",
      serverId: "server-1",
      actorId: "user-1",
    })

    expect(result.ok).toBe(false)
  })

  it("tracks event subscriptions", () => {
    const runtime = new AppInteractionRuntime()
    runtime.subscribeToEvent({
      appInstallId: "install-1",
      appId: "app-1",
      eventKey: "message.created",
      enabled: true,
    })

    expect(runtime.getSubscribers("message.created")).toHaveLength(1)
  })

  it("enforces per-app rate limits", async () => {
    const runtime = new AppInteractionRuntime()
    runtime.registerCommand({
      name: "/ping",
      appId: "app-1",
      execute: () => ({ ok: true, message: "pong" }),
    })

    const rule = { requestsPerMinute: 1 }
    const first = await runtime.executeCommand("/ping", { appId: "app-1", serverId: "s1", actorId: "u1" }, rule)
    const second = await runtime.executeCommand("/ping", { appId: "app-1", serverId: "s1", actorId: "u1" }, rule)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(second.message).toContain("Rate limit")
  })

  it("resets rate limit after window", async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"))
      const runtime = new AppInteractionRuntime()
      runtime.registerCommand({
        name: "/ping",
        appId: "app-1",
        execute: () => ({ ok: true, message: "pong" }),
      })

      const rule = { requestsPerMinute: 1 }
      const first = await runtime.executeCommand("/ping", { appId: "app-1", serverId: "s1", actorId: "u1" }, rule)
      const second = await runtime.executeCommand("/ping", { appId: "app-1", serverId: "s1", actorId: "u1" }, rule)

      vi.setSystemTime(new Date("2024-01-01T00:01:01Z"))
      const third = await runtime.executeCommand("/ping", { appId: "app-1", serverId: "s1", actorId: "u1" }, rule)

      expect(first.ok).toBe(true)
      expect(second.ok).toBe(false)
      expect(third.ok).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns safe error when command execution throws", async () => {
    const runtime = new AppInteractionRuntime()
    const logger = { error: vi.fn() }

    runtime.registerCommand({
      name: "/boom",
      appId: "app-1",
      execute: () => {
        throw new Error("kaboom")
      },
    })

    const result = await runtime.executeCommand("/boom", {
      appId: "app-1",
      serverId: "s1",
      actorId: "u1",
      logger,
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain("App command failed")
    expect(logger.error).toHaveBeenCalled()
  })

  it("validates install permissions and redacts credentials for webhook compatibility", () => {
    expect(validateInstallPermissions(["SEND_MESSAGES"], ["SEND_MESSAGES", "MANAGE_MESSAGES"]))
      .toBe(true)
    expect(validateInstallPermissions(["ADMINISTRATOR"], ["SEND_MESSAGES"]))
      .toBe(false)

    expect(redactCredentials({ webhook_token: "secret", api_key: "abc" })).toEqual({
      webhook_token: "••••••",
      api_key: "••••••",
    })
  })
})
