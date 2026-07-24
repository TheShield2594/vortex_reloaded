import { createRequire } from "module"
import { beforeAll, describe, expect, it } from "vitest"
import { loadOlm } from "./olm-protocol"
import { verifyOneTimeKeySignature, verifyFallbackKeySignature, type ValidatedOneTimeKey } from "./olm-key-validation"

const require = createRequire(import.meta.url)

beforeAll(async () => {
  await loadOlm(require.resolve("@matrix-org/olm/olm.wasm"))
})

// Build a real device the way a client publishes one: an Olm account plus a
// one-time key signed by that account's ed25519 identity over the canonical
// payload the server re-derives (see olm-protocol.ts's canonicalOneTimeKeyPayload).
async function makeDevice(userId: string, deviceId: string) {
  const Olm = await loadOlm()
  const acc = new Olm.Account()
  try {
    acc.create()
    const ed25519 = (JSON.parse(acc.identity_keys()) as { ed25519: string }).ed25519
    acc.generate_one_time_keys(1)
    const [entry] = Object.entries(JSON.parse(acc.one_time_keys()).curve25519 as Record<string, string>)
    const [keyId, publicKey] = entry
    const signature = acc.sign(JSON.stringify({ userId, deviceId, keyId, publicKey }))
    return { ed25519, key: { keyId, publicKey, signature } satisfies ValidatedOneTimeKey }
  } finally {
    acc.free()
  }
}

// Build a real device fallback ("last resort") key the way a client publishes
// one — signed over the fallback canonical payload (note `kind: "fallback"`).
async function makeFallback(userId: string, deviceId: string) {
  const Olm = await loadOlm()
  const acc = new Olm.Account()
  try {
    acc.create()
    const ed25519 = (JSON.parse(acc.identity_keys()) as { ed25519: string }).ed25519
    acc.generate_fallback_key()
    const [entry] = Object.entries(JSON.parse(acc.unpublished_fallback_key()).curve25519 as Record<string, string>)
    const [keyId, publicKey] = entry
    const signature = acc.sign(JSON.stringify({ userId, deviceId, keyId, publicKey, kind: "fallback" }))
    return { ed25519, keyId, publicKey, signature }
  } finally {
    acc.free()
  }
}

describe("verifyOneTimeKeySignature (issue #60 top-up, CWE-347)", () => {
  it("accepts a key correctly signed by the device's ed25519 identity", async () => {
    const { ed25519, key } = await makeDevice("alice", "dev-1")
    expect(verifyOneTimeKeySignature(ed25519, "alice", "dev-1", key)).toBe(true)
  })

  it("rejects a key signed by a different account (forged top-up for one's own device)", async () => {
    const victim = await makeDevice("alice", "dev-1")
    const attacker = await makeDevice("alice", "dev-1") // fresh account, same ids, different identity key
    expect(verifyOneTimeKeySignature(victim.ed25519, "alice", "dev-1", attacker.key)).toBe(false)
  })

  it("rejects when the signed (userId, deviceId) context doesn't match", async () => {
    const { ed25519, key } = await makeDevice("alice", "dev-1")
    expect(verifyOneTimeKeySignature(ed25519, "alice", "dev-OTHER", key)).toBe(false)
    expect(verifyOneTimeKeySignature(ed25519, "mallory", "dev-1", key)).toBe(false)
  })

  it("rejects a tampered public key", async () => {
    const { ed25519, key } = await makeDevice("alice", "dev-1")
    const tampered = { ...key, publicKey: `AAAA${key.publicKey.slice(4)}` }
    expect(verifyOneTimeKeySignature(ed25519, "alice", "dev-1", tampered)).toBe(false)
  })

  it("returns false (never throws) on malformed identity key material", async () => {
    const { key } = await makeDevice("alice", "dev-1")
    expect(verifyOneTimeKeySignature("not valid base64 !!", "alice", "dev-1", key)).toBe(false)
    expect(verifyOneTimeKeySignature("AAAA", "alice", "dev-1", key)).toBe(false) // decodes to 3 bytes, not 32
  })
})

describe("verifyFallbackKeySignature (full-publish path, CWE-347)", () => {
  it("accepts a fallback key correctly signed by the device's ed25519 identity", async () => {
    const fb = await makeFallback("alice", "dev-1")
    expect(verifyFallbackKeySignature(fb.ed25519, "alice", "dev-1", fb.keyId, fb.publicKey, fb.signature)).toBe(true)
  })

  it("rejects a fallback key signed by a different account (forged publish)", async () => {
    const victim = await makeFallback("alice", "dev-1")
    const attacker = await makeFallback("alice", "dev-1")
    expect(verifyFallbackKeySignature(victim.ed25519, "alice", "dev-1", attacker.keyId, attacker.publicKey, attacker.signature)).toBe(false)
  })

  it("rejects a fallback signature replayed with the one-time-key payload (kind binding)", async () => {
    // A one-time key signed WITHOUT the `kind: "fallback"` field must not pass
    // as a fallback key, and vice-versa — the payloads are deliberately distinct.
    const { ed25519, key } = await makeDevice("alice", "dev-1")
    expect(verifyFallbackKeySignature(ed25519, "alice", "dev-1", key.keyId, key.publicKey, key.signature)).toBe(false)
  })
})
