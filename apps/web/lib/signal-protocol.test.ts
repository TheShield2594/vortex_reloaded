import { createRequire } from "module"
import { beforeAll, describe, expect, it } from "vitest"
import {
  createIdentity,
  createOutboundSession,
  decryptMessage,
  encryptMessage,
  generateOneTimeKeyBatch,
  getIdentityKeys,
  isValidSignalCiphertext,
  loadOlm,
  parseSignalEnvelope,
  verifyKeyBundleSignature,
  type SerializedAccount,
  type SignalKeyBundle,
} from "./signal-protocol"

const require = createRequire(import.meta.url)
const OLM_WASM_PATH = require.resolve("@matrix-org/olm/olm.wasm")

beforeAll(async () => {
  await loadOlm(OLM_WASM_PATH)
})

async function makeDevice(userId: string, deviceId: string) {
  const { account, publish } = await createIdentity(userId, deviceId)
  return { userId, deviceId, account, publish }
}

/** Builds the SignalKeyBundle a claim endpoint would hand out for this device's fallback key. */
function fallbackBundle(publish: Awaited<ReturnType<typeof makeDevice>>["publish"]): SignalKeyBundle {
  return {
    curve25519IdentityKey: publish.curve25519IdentityKey,
    ed25519IdentityKey: publish.ed25519IdentityKey,
    keyId: publish.fallbackKeyId,
    publicKey: publish.fallbackPublicKey,
    signature: publish.fallbackSignature,
    isFallback: true,
  }
}

function oneTimeKeyBundle(publish: Awaited<ReturnType<typeof makeDevice>>["publish"], index = 0): SignalKeyBundle {
  const otk = publish.oneTimeKeys[index]
  if (!otk) throw new Error("no one-time key at index")
  return {
    curve25519IdentityKey: publish.curve25519IdentityKey,
    ed25519IdentityKey: publish.ed25519IdentityKey,
    keyId: otk.keyId,
    publicKey: otk.publicKey,
    signature: otk.signature,
    isFallback: false,
  }
}

describe("signal-protocol: identity", () => {
  it("creates an identity with a fallback key and one-time keys, all self-signed", async () => {
    const alice = await makeDevice("alice", "device-1")
    expect(alice.publish.curve25519IdentityKey).toBeTruthy()
    expect(alice.publish.ed25519IdentityKey).toBeTruthy()
    expect(alice.publish.fallbackKeyId).toBeTruthy()
    expect(alice.publish.oneTimeKeys.length).toBe(20)

    expect(await verifyKeyBundleSignature("alice", "device-1", fallbackBundle(alice.publish))).toBe(true)
    expect(await verifyKeyBundleSignature("alice", "device-1", oneTimeKeyBundle(alice.publish, 0))).toBe(true)
  })

  it("rejects a bundle signature that doesn't match the claimed identity", async () => {
    const alice = await makeDevice("alice", "device-1")
    const mallory = await makeDevice("mallory", "device-1")

    // Swap in mallory's identity keys but keep alice's signed fallback key —
    // signature won't verify against the substituted identity.
    const forged: SignalKeyBundle = {
      ...fallbackBundle(alice.publish),
      curve25519IdentityKey: mallory.publish.curve25519IdentityKey,
      ed25519IdentityKey: mallory.publish.ed25519IdentityKey,
    }
    expect(await verifyKeyBundleSignature("alice", "device-1", forged)).toBe(false)
  })

  it("rejects a bundle whose signed payload doesn't match the (userId, deviceId) it's claimed for", async () => {
    const alice = await makeDevice("alice", "device-1")
    // Same device's own bundle, but verified against the wrong deviceId —
    // the signed canonical payload embeds (userId, deviceId), so this must fail.
    expect(await verifyKeyBundleSignature("alice", "device-2", fallbackBundle(alice.publish))).toBe(false)
  })

  it("reads identity keys back out of a serialized account without mutating it", async () => {
    const alice = await makeDevice("alice", "device-1")
    const identity = await getIdentityKeys(alice.account)
    expect(identity.curve25519IdentityKey).toBe(alice.publish.curve25519IdentityKey)
    expect(identity.ed25519IdentityKey).toBe(alice.publish.ed25519IdentityKey)
  })

  it("tops up one-time keys and signs the new batch", async () => {
    const alice = await makeDevice("alice", "device-1")
    const { account, oneTimeKeys } = await generateOneTimeKeyBatch(alice.account, "alice", "device-1", 5)
    expect(oneTimeKeys.length).toBe(5)
    // New keyIds, disjoint from the identity-creation batch
    const original = new Set(alice.publish.oneTimeKeys.map((k) => k.keyId))
    for (const key of oneTimeKeys) expect(original.has(key.keyId)).toBe(false)
    for (const key of oneTimeKeys) {
      const bundle: SignalKeyBundle = {
        curve25519IdentityKey: alice.publish.curve25519IdentityKey,
        ed25519IdentityKey: alice.publish.ed25519IdentityKey,
        keyId: key.keyId,
        publicKey: key.publicKey,
        signature: key.signature,
        isFallback: false,
      }
      expect(await verifyKeyBundleSignature("alice", "device-1", bundle)).toBe(true)
    }
    expect(account.pickle).not.toBe(alice.account.pickle)
  })
})

describe("signal-protocol: pairwise session (1:1)", () => {
  it("establishes a session via a one-time-key bundle and exchanges messages both ways", async () => {
    const alice = await makeDevice("alice", "device-1")
    const bob = await makeDevice("bob", "device-1")

    const { session: aliceSession } = await createOutboundSession(alice.account, oneTimeKeyBundle(bob.publish, 0))

    const enc1 = await encryptMessage(aliceSession, "hello bob")
    expect(enc1.ciphertext.type).toBe(0) // PreKey message — first on this session

    const dec1 = await decryptMessage(bob.account, null, enc1.ciphertext)
    expect(dec1.plaintext).toBe("hello bob")

    // Bob replies using the session decryptMessage just established for him
    const enc2 = await encryptMessage(dec1.session, "hi alice")
    expect(enc2.ciphertext.type).toBe(1) // ordinary Message now that a session exists

    const dec2 = await decryptMessage(alice.account, aliceSession, enc2.ciphertext)
    expect(dec2.plaintext).toBe("hi alice")
  })

  it("establishes a session via the fallback key when one-time keys are unavailable", async () => {
    const alice = await makeDevice("alice", "device-1")
    const bob = await makeDevice("bob", "device-1")

    const { session: aliceSession } = await createOutboundSession(alice.account, fallbackBundle(bob.publish))
    const enc = await encryptMessage(aliceSession, "via fallback")
    const dec = await decryptMessage(bob.account, null, enc.ciphertext)
    expect(dec.plaintext).toBe("via fallback")
  })

  it("ratchets forward across multiple sequential messages in both directions", async () => {
    const alice = await makeDevice("alice", "device-1")
    const bob = await makeDevice("bob", "device-1")

    let aliceSession = (await createOutboundSession(alice.account, oneTimeKeyBundle(bob.publish, 0))).session
    let bobAccount = bob.account
    let bobSession: Awaited<ReturnType<typeof decryptMessage>>["session"] | null = null

    const transcript: string[] = []
    for (let i = 0; i < 6; i++) {
      const fromAlice = i % 2 === 0
      const plaintext = `message ${i}`
      if (fromAlice) {
        const enc = await encryptMessage(aliceSession, plaintext)
        aliceSession = enc.session
        const dec = await decryptMessage(bobAccount, bobSession, enc.ciphertext)
        bobAccount = dec.account
        bobSession = dec.session
        transcript.push(dec.plaintext)
      } else {
        if (!bobSession) throw new Error("bob has no session yet")
        const enc = await encryptMessage(bobSession, plaintext)
        bobSession = enc.session
        const dec = await decryptMessage(alice.account, aliceSession, enc.ciphertext)
        aliceSession = dec.session
        transcript.push(dec.plaintext)
      }
    }
    expect(transcript).toEqual(["message 0", "message 1", "message 2", "message 3", "message 4", "message 5"])
  })

  it("fails to decrypt a tampered ciphertext body", async () => {
    const alice = await makeDevice("alice", "device-1")
    const bob = await makeDevice("bob", "device-1")

    const { session: aliceSession } = await createOutboundSession(alice.account, oneTimeKeyBundle(bob.publish, 0))
    const enc = await encryptMessage(aliceSession, "hello bob")

    const tampered = { ...enc.ciphertext, body: enc.ciphertext.body.slice(0, -4) + (enc.ciphertext.body.slice(-4) === "AAAA" ? "BBBB" : "AAAA") }
    await expect(decryptMessage(bob.account, null, tampered)).rejects.toThrow()
  })

  it("a third party's account cannot decrypt a session it isn't part of", async () => {
    const alice = await makeDevice("alice", "device-1")
    const bob = await makeDevice("bob", "device-1")
    const mallory = await makeDevice("mallory", "device-1")

    const { session: aliceSession } = await createOutboundSession(alice.account, oneTimeKeyBundle(bob.publish, 0))
    const enc = await encryptMessage(aliceSession, "for bob only")

    await expect(decryptMessage(mallory.account, null, enc.ciphertext)).rejects.toThrow()
  })
})

describe("signal-protocol: group DM (pairwise fan-out, no sender-key ratchet — see issue #3)", () => {
  it("encrypts one ciphertext per member device and each device decrypts independently", async () => {
    const alice = await makeDevice("alice", "device-1")
    const bob = await makeDevice("bob", "device-1")
    const bobLaptop = await makeDevice("bob", "device-2")
    const carol = await makeDevice("carol", "device-1")

    const recipients = [bob, bobLaptop, carol]
    const sessionsAndCiphertexts = await Promise.all(
      recipients.map(async (recipient) => {
        const { session } = await createOutboundSession(alice.account, oneTimeKeyBundle(recipient.publish, 0))
        const enc = await encryptMessage(session, "group hello")
        return { recipient, ciphertext: enc.ciphertext }
      })
    )

    for (const { recipient, ciphertext } of sessionsAndCiphertexts) {
      const dec = await decryptMessage(recipient.account, null, ciphertext)
      expect(dec.plaintext).toBe("group hello")
    }

    // Every recipient device got a distinct ciphertext body (independent
    // sessions/ephemeral keys) even though the plaintext is identical.
    const bodies = new Set(sessionsAndCiphertexts.map((r) => r.ciphertext.body))
    expect(bodies.size).toBe(recipients.length)
  })
})

describe("signal-protocol: envelope helpers", () => {
  it("parses a well-formed envelope", () => {
    const envelope = { kind: "dm-signal", v: 1, senderDeviceId: "device-1", ciphertexts: { "alice:device-1": { type: 1, body: "abc" } } }
    expect(parseSignalEnvelope(JSON.stringify(envelope))).toEqual(envelope)
  })

  it("rejects malformed or non-envelope content", () => {
    expect(parseSignalEnvelope(null)).toBeNull()
    expect(parseSignalEnvelope("not json")).toBeNull()
    expect(parseSignalEnvelope(JSON.stringify({ kind: "dm-e2ee", version: 1 }))).toBeNull()
    expect(parseSignalEnvelope(JSON.stringify({ kind: "dm-signal", v: 1, senderDeviceId: "device-1", ciphertexts: [] }))).toBeNull()
    expect(parseSignalEnvelope(JSON.stringify({ kind: "dm-signal", v: 1, ciphertexts: { "a:b": { type: 1, body: "x" } } }))).toBeNull()
  })

  it("validates individual ciphertext shape", () => {
    expect(isValidSignalCiphertext({ type: 0, body: "abc" })).toBe(true)
    expect(isValidSignalCiphertext({ type: 1, body: "abc" })).toBe(true)
    expect(isValidSignalCiphertext({ type: 2, body: "abc" })).toBe(false)
    expect(isValidSignalCiphertext({ type: 1, body: "" })).toBe(false)
    expect(isValidSignalCiphertext(null)).toBe(false)
    expect(isValidSignalCiphertext("abc")).toBe(false)
  })
})

describe("signal-protocol: account pickling", () => {
  it("round-trips a pickled account through unpickle without losing identity", async () => {
    const alice = await makeDevice("alice", "device-1")
    const identityBefore = await getIdentityKeys(alice.account)
    // generateOneTimeKeyBatch internally unpickles + re-pickles — confirms
    // that round trip preserves the same identity.
    const { account: reserialized } = await generateOneTimeKeyBatch(alice.account, "alice", "device-1", 1)
    const identityAfter = await getIdentityKeys(reserialized as SerializedAccount)
    expect(identityAfter).toEqual(identityBefore)
  })
})
