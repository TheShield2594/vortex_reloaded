import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { generateNtfyTopic } from "./ntfy"

describe("generateNtfyTopic", () => {
  it("is prefixed and long enough to be unguessable", () => {
    const topic = generateNtfyTopic()
    expect(topic.startsWith("vortex-")).toBe(true)
    expect(topic.length).toBe("vortex-".length + 32)
  })

  it("only uses lowercase alphanumeric characters after the prefix", () => {
    const topic = generateNtfyTopic()
    expect(topic.slice("vortex-".length)).toMatch(/^[a-z0-9]{32}$/)
  })

  it("generates distinct topics across calls", () => {
    const topics = new Set(Array.from({ length: 50 }, () => generateNtfyTopic()))
    expect(topics.size).toBe(50)
  })
})

describe("isNtfyConfigured / publishNtfy", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    globalThis.fetch = originalFetch
  })

  it("isNtfyConfigured is false when NTFY_SERVER_URL is unset", async () => {
    vi.stubEnv("NTFY_SERVER_URL", "")
    const { isNtfyConfigured } = await import("./ntfy")
    expect(isNtfyConfigured()).toBe(false)
  })

  it("isNtfyConfigured is true when NTFY_SERVER_URL is set", async () => {
    vi.stubEnv("NTFY_SERVER_URL", "http://ntfy:80")
    const { isNtfyConfigured } = await import("./ntfy")
    expect(isNtfyConfigured()).toBe(true)
  })

  it("publishNtfy is a no-op returning false when unconfigured", async () => {
    vi.stubEnv("NTFY_SERVER_URL", "")
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const { publishNtfy } = await import("./ntfy")

    const ok = await publishNtfy("vortex-sometopic", { title: "Hi", body: "there" })

    expect(ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("publishNtfy posts title/message/click to the configured server", async () => {
    vi.stubEnv("NTFY_SERVER_URL", "http://ntfy:80/")
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const { publishNtfy } = await import("./ntfy")

    const ok = await publishNtfy("vortex-sometopic", {
      title: "New message",
      body: "hello",
      url: "/channels/me/abc",
    })

    expect(ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://ntfy:80/vortex-sometopic")
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      topic: "vortex-sometopic",
      title: "New message",
      message: "hello",
      click: "/channels/me/abc",
    })
  })

  it("publishNtfy returns false when the server responds with an error status", async () => {
    vi.stubEnv("NTFY_SERVER_URL", "http://ntfy:80")
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch
    const { publishNtfy } = await import("./ntfy")

    const ok = await publishNtfy("vortex-sometopic", { title: "Hi", body: "there" })

    expect(ok).toBe(false)
  })

  it("publishNtfy returns false (not throws) when fetch rejects", async () => {
    vi.stubEnv("NTFY_SERVER_URL", "http://ntfy:80")
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch
    const { publishNtfy } = await import("./ntfy")

    const ok = await publishNtfy("vortex-sometopic", { title: "Hi", body: "there" })

    expect(ok).toBe(false)
  })
})
