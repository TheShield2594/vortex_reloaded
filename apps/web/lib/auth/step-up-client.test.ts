import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getStepUpStatus, submitStepUp } from "./step-up-client"

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe("getStepUpStatus", () => {
  it("reads verification state and available factors", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { verified: false, methods: { password: true, totp: true } }),
    )

    expect(await getStepUpStatus()).toEqual({
      verified: false,
      methods: { password: true, totp: true },
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/step-up", { cache: "no-store" })
  })

  it("defaults missing factors to unavailable rather than dropping them", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { verified: true, methods: { totp: true } }))

    // A partial `methods` must not leave `password` undefined — the prompt
    // branches on it, and `undefined` would render neither field nor the
    // no-factor fallback.
    expect(await getStepUpStatus()).toEqual({
      verified: true,
      methods: { password: false, totp: true },
    })
  })

  it("returns null on a non-OK response", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "Unauthorized" }))
    expect(await getStepUpStatus()).toBeNull()
  })

  it("returns null when the request throws", async () => {
    fetchMock.mockRejectedValue(new Error("offline"))
    expect(await getStepUpStatus()).toBeNull()
  })
})

describe("submitStepUp", () => {
  it("posts the submitted factor as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

    expect(await submitStepUp({ password: "hunter22hunter22" })).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/step-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "hunter22hunter22" }),
    })
  })

  it("surfaces the server's refusal when the account has no factor to challenge", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: "Set a password or enable two-factor authentication…" }),
    )

    // The session alone is never sufficient proof for step-up, so an empty
    // submission has to come back as a failure rather than a minted token.
    expect(await submitStepUp()).toEqual({
      ok: false,
      error: "Set a password or enable two-factor authentication…",
    })
    expect(fetchMock.mock.calls[0][1].body).toBe("{}")
  })

  it("surfaces the server's error message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "Verification failed" }))
    expect(await submitStepUp({ totpCode: "000000" })).toEqual({
      ok: false,
      error: "Verification failed",
    })
  })

  it("falls back to a generic message when the body carries none", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {}))
    expect(await submitStepUp({ password: "x" })).toEqual({
      ok: false,
      error: "Verification failed",
    })
  })

  it("reports failure rather than throwing when the request throws", async () => {
    fetchMock.mockRejectedValue(new Error("offline"))
    expect(await submitStepUp({ password: "x" })).toEqual({
      ok: false,
      error: "Verification failed",
    })
  })
})
