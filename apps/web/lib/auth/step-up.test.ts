import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Minimal stand-in for Next's mutable cookie store — enough of `get`/`set` for
 * step-up.ts, plus expiry handling so a cleared cookie really does read back as
 * absent rather than as an empty string the verifier might mis-parse.
 */
class FakeCookieStore {
  private jar = new Map<string, { value: string; options?: { expires?: Date; path?: string } }>()

  set(name: string, value: string, options?: { expires?: Date; path?: string }) {
    this.jar.set(name, { value, options })
  }

  get(name: string) {
    const entry = this.jar.get(name)
    if (!entry) return undefined
    const expires = entry.options?.expires
    if (expires && expires.getTime() <= Date.now()) return undefined
    return { name, value: entry.value }
  }

  raw(name: string) {
    return this.jar.get(name)
  }
}

let cookieStore: FakeCookieStore

vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
}))

const USER = "11111111-1111-4111-8111-111111111111"
const OTHER_USER = "22222222-2222-4222-8222-222222222222"

let stepUp: typeof import("./step-up")

beforeEach(async () => {
  cookieStore = new FakeCookieStore()
  process.env.STEP_UP_SECRET = "test-step-up-secret"
  delete process.env.STEP_UP_SECRET_PREV
  vi.resetModules()
  stepUp = await import("./step-up")
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.STEP_UP_SECRET
  delete process.env.STEP_UP_SECRET_PREV
})

describe("issueStepUpToken / hasValidStepUpToken", () => {
  it("issues a token the same user can verify", async () => {
    await stepUp.issueStepUpToken(USER)
    expect(await stepUp.hasValidStepUpToken(USER)).toBe(true)
  })

  it("reports no token when none was issued", async () => {
    expect(await stepUp.hasValidStepUpToken(USER)).toBe(false)
  })

  it("does not let one user's token authorize another", async () => {
    await stepUp.issueStepUpToken(USER)
    expect(await stepUp.hasValidStepUpToken(OTHER_USER)).toBe(false)
  })

  it("rejects a token whose user id was swapped without re-signing", async () => {
    await stepUp.issueStepUpToken(USER)
    const [, issuedAt, signature] = cookieStore.get("vtx_step_up")!.value.split(":")
    cookieStore.set("vtx_step_up", `${OTHER_USER}:${issuedAt}:${signature}`)

    expect(await stepUp.hasValidStepUpToken(OTHER_USER)).toBe(false)
  })

  it("rejects a token whose issue time was backdated without re-signing", async () => {
    await stepUp.issueStepUpToken(USER)
    const [userId, , signature] = cookieStore.get("vtx_step_up")!.value.split(":")
    cookieStore.set("vtx_step_up", `${userId}:${Date.now() + 60_000}:${signature}`)

    expect(await stepUp.hasValidStepUpToken(USER)).toBe(false)
  })

  it("rejects a garbage signature", async () => {
    cookieStore.set("vtx_step_up", `${USER}:${Date.now()}:not-a-signature`)
    expect(await stepUp.hasValidStepUpToken(USER)).toBe(false)
  })

  it("expires the token after its TTL", async () => {
    vi.useFakeTimers()
    await stepUp.issueStepUpToken(USER)
    vi.advanceTimersByTime(stepUp.STEP_UP_TTL_MS + 1)

    expect(await stepUp.hasValidStepUpToken(USER)).toBe(false)
  })

  it("still verifies a token signed with the previous secret during rotation", async () => {
    await stepUp.issueStepUpToken(USER)

    process.env.STEP_UP_SECRET_PREV = "test-step-up-secret"
    process.env.STEP_UP_SECRET = "rotated-step-up-secret"
    vi.resetModules()
    const rotated = await import("./step-up")

    expect(await rotated.hasValidStepUpToken(USER)).toBe(true)
  })

  it("stops verifying old tokens once the previous secret is dropped", async () => {
    await stepUp.issueStepUpToken(USER)

    process.env.STEP_UP_SECRET = "rotated-step-up-secret"
    vi.resetModules()
    const rotated = await import("./step-up")

    expect(await rotated.hasValidStepUpToken(USER)).toBe(false)
  })
})

describe("clearStepUpToken", () => {
  it("makes a live token stop verifying", async () => {
    await stepUp.issueStepUpToken(USER)
    expect(await stepUp.hasValidStepUpToken(USER)).toBe(true)

    await stepUp.clearStepUpToken()
    expect(await stepUp.hasValidStepUpToken(USER)).toBe(false)
  })

  it("writes an already-expired cookie on the same path the token was set on", async () => {
    await stepUp.issueStepUpToken(USER)
    await stepUp.clearStepUpToken()

    // A mismatched path would leave the original cookie alive in a real
    // browser, so the expiry write has to target the same one.
    const cleared = cookieStore.raw("vtx_step_up")!
    expect(cleared.value).toBe("")
    expect(cleared.options?.path).toBe("/")
    expect(cleared.options?.expires!.getTime()).toBeLessThanOrEqual(Date.now())
  })
})
