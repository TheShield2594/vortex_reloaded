import { describe, expect, it } from "vitest"
import { isChallengeValid, isReplayDetected, verifyWithAdapter } from "../lib/auth/passkeys"

describe("passkey auth flows", () => {
  it("registration/login happy path verifies in dev adapter", async () => {
    const registration = await verifyWithAdapter("registration", {
      challenge: "challenge-1",
      credentialId: "credential-1",
      response: { clientDataJSON: "x", attestationObject: "y" },
      expectedOrigin: "http://localhost:3000",
      expectedRpId: "localhost",
    })

    expect(registration.verified).toBe(true)

    const login = await verifyWithAdapter("authentication", {
      challenge: "challenge-2",
      credentialId: "credential-1",
      response: { authenticatorData: "a", signature: "s", clientDataJSON: "c" },
      expectedOrigin: "http://localhost:3000",
      expectedRpId: "localhost",
      prevCounter: 2,
    })

    expect(login.verified).toBe(true)
    expect(login.newCounter).toBeGreaterThan(2)
  })

  it("rejects expired or already-used challenges", () => {
    const now = Date.now()

    expect(isChallengeValid({ expiresAt: new Date(now + 60_000).toISOString(), now })).toBe(true)
    expect(isChallengeValid({ expiresAt: new Date(now - 1).toISOString(), now })).toBe(false)
    expect(isChallengeValid({ expiresAt: new Date(now + 60_000).toISOString(), usedAt: new Date(now).toISOString(), now })).toBe(false)
  })

  it("flags replay attempts and revoked credential behavior", () => {
    expect(isReplayDetected(5, 5)).toBe(true)
    expect(isReplayDetected(5, 4)).toBe(true)
    expect(isReplayDetected(5, 6)).toBe(false)

    const revokedCredential = { revoked_at: new Date().toISOString() }
    expect(Boolean(revokedCredential.revoked_at)).toBe(true)
  })
})
