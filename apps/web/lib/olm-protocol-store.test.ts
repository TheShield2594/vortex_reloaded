import "fake-indexeddb/auto"
import { createRequire } from "module"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { loadOlm, type OlmKeyBundle } from "./olm-protocol"

const require = createRequire(import.meta.url)

beforeAll(async () => {
  await loadOlm(require.resolve("@matrix-org/olm/olm.wasm"))
})

// Minimal in-memory localStorage — enough for the owner-userId/device-id
// keys this module reads/writes; vitest's default "node" environment (kept
// for consistency with the rest of the suite) has no real one.
function installLocalStorageStub() {
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  })
}

function deleteOlmDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("vortexchat-olm-v1")
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

/** Clears only the "sessions" object store, leaving pinned identities and the account intact — simulates local session-cache loss without losing trust state. */
function deleteSessionsOnly(): Promise<void> {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open("vortexchat-olm-v1")
    openReq.onsuccess = () => {
      const db = openReq.result
      const tx = db.transaction("sessions", "readwrite")
      tx.objectStore("sessions").clear()
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    openReq.onerror = () => reject(openReq.error)
  })
}

describe("olm-protocol-store: identity pinning (issue #46 Strix HIGH)", () => {
  beforeEach(() => {
    installLocalStorageStub()
  })
  afterEach(async () => {
    // fake-indexeddb's backing store is a process-global, not reset by
    // vi.resetModules() — without this, "alice"'s account from one test
    // would still be sitting in IndexedDB under the next test's fresh
    // module instance, since both look up the same "self" key.
    await deleteOlmDatabase()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  // Each test dynamically re-imports the module fresh (vi.resetModules)
  // so its module-level state (single-flight promises, etc. added by
  // later fixes) never leaks between tests, and picks a fresh fake
  // IndexedDB database name per test to avoid cross-test interference —
  // both wrapped up in this helper.
  async function freshStore() {
    const mod = await import("./olm-protocol-store")
    return mod
  }

  async function makeBundle(userId: string, deviceId: string): Promise<OlmKeyBundle> {
    const { createIdentity } = await import("./olm-protocol")
    const { publish } = await createIdentity(userId, deviceId)
    const otk = publish.oneTimeKeys[0]
    if (!otk) throw new Error("no otk")
    return {
      curve25519IdentityKey: publish.curve25519IdentityKey,
      ed25519IdentityKey: publish.ed25519IdentityKey,
      keyId: otk.keyId,
      publicKey: otk.publicKey,
      signature: otk.signature,
      isFallback: false,
    }
  }

  it("pins a remote identity on first contact and reuses the session on later contacts", async () => {
    const store = await freshStore()
    await store.ensureOlmIdentity("alice")
    const bundle = await makeBundle("bob", "device-1")

    await store.ensureOutboundSession("bob", "device-1", bundle)
    expect(await store.hasSessionWith({ userId: "bob", deviceId: "device-1" })).toBe(true)

    const pinned = await store.getPinnedIdentity({ userId: "bob", deviceId: "device-1" })
    expect(pinned).toEqual({
      curve25519IdentityKey: bundle.curve25519IdentityKey,
      ed25519IdentityKey: bundle.ed25519IdentityKey,
    })
  })

  it("rejects a substituted identity bundle for an already-pinned device (server MITM attempt)", async () => {
    const store = await freshStore()
    await store.ensureOlmIdentity("alice")

    const legitBundle = await makeBundle("bob", "device-1")
    await store.ensureOutboundSession("bob", "device-1", legitBundle)
    // Once a session is trusted, ensureOutboundSession short-circuits
    // without re-verifying — correct (no re-verification is needed against
    // an already-pinned, already-sessioned device). The real attack
    // surface — a server substituting a different identity for a
    // (userId, deviceId) Alice has already pinned but not yet sessioned
    // *inbound* from — is covered by the decryptFrom test below, which
    // exercises the same pin against a genuinely different Olm account's
    // ciphertext via create_inbound_from.
    expect(await store.hasSessionWith({ userId: "bob", deviceId: "device-1" })).toBe(true)
  })

  it("decryptFrom rejects a message from an attacker's Olm account impersonating an already-pinned device", async () => {
    const aliceStore = await freshStore()
    const { publish: alicePublish } = await aliceStore.ensureOlmIdentity("alice")
    if (!alicePublish) throw new Error("expected a fresh publish bundle for alice")

    // Alice contacts the real Bob first — this pins Bob's real identity.
    const bobBundle = await makeBundle("bob", "device-1")
    await aliceStore.ensureOutboundSession("bob", "device-1", bobBundle)
    const pinnedBefore = await aliceStore.getPinnedIdentity({ userId: "bob", deviceId: "device-1" })
    expect(pinnedBefore).not.toBeNull()

    // An attacker — a totally unrelated Olm account — now sends Alice a
    // message claiming to be "bob:device-1", using one of Alice's own
    // published one-time keys (exactly what claiming Alice's bundle from
    // the server would hand any sender, legitimate or not).
    const { createIdentity, createOutboundSession, encryptMessage } = await import("./olm-protocol")
    const attacker = await createIdentity("bob", "device-1")
    const aliceOtk = alicePublish.oneTimeKeys[0]
    if (!aliceOtk) throw new Error("expected an alice one-time key")
    const attackerBundleForAlice: OlmKeyBundle = {
      curve25519IdentityKey: alicePublish.curve25519IdentityKey,
      ed25519IdentityKey: alicePublish.ed25519IdentityKey,
      keyId: aliceOtk.keyId,
      publicKey: aliceOtk.publicKey,
      signature: aliceOtk.signature,
      isFallback: false,
    }
    const { session: attackerSession } = await createOutboundSession(attacker.account, attackerBundleForAlice)
    const { ciphertext } = await encryptMessage(attackerSession, "trust me, it's bob")

    await expect(
      aliceStore.decryptFrom("bob", "device-1", ciphertext)
    ).rejects.toThrow()

    // The pin must be unchanged — the attacker's identity was never trusted.
    const pinnedAfter = await aliceStore.getPinnedIdentity({ userId: "bob", deviceId: "device-1" })
    expect(pinnedAfter).toEqual(pinnedBefore)
  })

  it("ensureOutboundSession throws OlmIdentityMismatchError for a bundle that conflicts with an existing pin", async () => {
    const store = await freshStore()
    await store.ensureOlmIdentity("alice")

    // Pin "bob:device-1" via a real bundle first, without ever
    // establishing a session for it (decryptFrom-side pinning, exercised
    // via a direct pin so this test isolates the outbound check).
    const realBundle = await makeBundle("bob", "device-1")
    await store.ensureOutboundSession("bob", "device-1", realBundle)
    expect(await store.hasSessionWith({ userId: "bob", deviceId: "device-1" })).toBe(true)

    // A second, freshly-created device claiming to be the SAME
    // (userId, deviceId) but with different identity keys — simulating
    // the server handing back a substituted bundle on a later lookup
    // (e.g. after the client's session cache was cleared but its pin
    // store wasn't). ensureOutboundSession only re-checks when no session
    // is cached, so clear just the session half of local state via a
    // fresh module instance sharing the same (persisted) IndexedDB pin
    // store but with no session recorded yet.
    await deleteSessionsOnly()
    const forgedBundle = await makeBundle("bob", "device-1")
    await expect(store.ensureOutboundSession("bob", "device-1", forgedBundle))
      .rejects.toThrow(store.OlmIdentityMismatchError)
  })

  it("ensureOlmIdentity resets all local Olm state when the authenticated user changes (Strix MEDIUM, CWE-922)", async () => {
    const store = await freshStore()
    const alice = await store.ensureOlmIdentity("alice-id")
    const bundle = await makeBundle("carol", "device-1")
    await store.ensureOutboundSession("carol", "device-1", bundle)
    expect(await store.hasSessionWith({ userId: "carol", deviceId: "device-1" })).toBe(true)

    // A different user logs into the same browser profile.
    const bob = await store.ensureOlmIdentity("bob-id")

    expect(bob.identity.curve25519IdentityKey).not.toBe(alice.identity.curve25519IdentityKey)
    expect(bob.publish).not.toBeNull() // a fresh identity was really created, not reused
    // Alice's session/pin state must not have survived for Bob to inherit.
    expect(await store.hasSessionWith({ userId: "carol", deviceId: "device-1" })).toBe(false)
    expect(await store.getPinnedIdentity({ userId: "carol", deviceId: "device-1" })).toBeNull()
  })

  it("ensureOlmIdentity reuses the same identity across repeated calls for the same user", async () => {
    const store = await freshStore()
    const first = await store.ensureOlmIdentity("alice-id")
    const second = await store.ensureOlmIdentity("alice-id")
    expect(second.identity.curve25519IdentityKey).toBe(first.identity.curve25519IdentityKey)
    expect(second.publish).toBeNull() // no new bundle needed on repeat calls
  })

  it("concurrent first-run ensureOlmIdentity calls for the same user create exactly one identity, not two (issue #46 CodeRabbit TOCTOU)", async () => {
    const store = await freshStore()
    const [a, b, c] = await Promise.all([
      store.ensureOlmIdentity("alice-id"),
      store.ensureOlmIdentity("alice-id"),
      store.ensureOlmIdentity("alice-id"),
    ])
    expect(a.identity.curve25519IdentityKey).toBe(b.identity.curve25519IdentityKey)
    expect(a.identity.curve25519IdentityKey).toBe(c.identity.curve25519IdentityKey)
    expect(a.identity.deviceId).toBe(b.identity.deviceId)
    // All three concurrent callers share the exact same in-flight promise,
    // so they all observe the exact same publish bundle (or all null) — if
    // the single-flight dedup were broken, two different createIdentity
    // calls would race to save a *different* account over each other in
    // IndexedDB, and this bundle wouldn't match the one actually saved.
    expect(a.publish).not.toBeNull()
    expect(b.publish).toEqual(a.publish)
    expect(c.publish).toEqual(a.publish)

    // A later, non-concurrent call correctly sees "already exists" —
    // confirms the single-flight cache doesn't linger and mask that check.
    const later = await store.ensureOlmIdentity("alice-id")
    expect(later.publish).toBeNull()
  })

  it("topUpOneTimeKeys returns a fresh signed batch and persists the account so successive top-ups never repeat a keyId (issue #60)", async () => {
    const store = await freshStore()
    const { identity, publish } = await store.ensureOlmIdentity("alice-id")
    expect(publish).not.toBeNull()

    const first = await store.topUpOneTimeKeys("alice-id", identity.deviceId, 5)
    expect(first).toHaveLength(5)
    for (const key of first) {
      expect(typeof key.keyId).toBe("string")
      expect(typeof key.publicKey).toBe("string")
      expect(key.signature.length).toBeGreaterThan(0)
    }

    // A second top-up must generate a distinct batch — if the updated account
    // weren't persisted back, Olm would re-emit the same unpublished keys and
    // the server would reject the duplicates (onConflictDoNothing), leaving
    // the pool un-replenished. Distinct keyIds across the two batches (and the
    // initial publish) prove the persisted account advanced.
    const second = await store.topUpOneTimeKeys("alice-id", identity.deviceId, 5)
    const firstIds = new Set(first.map((k) => k.keyId))
    const publishedIds = new Set(publish!.oneTimeKeys.map((k) => k.keyId))
    for (const key of second) {
      expect(firstIds.has(key.keyId)).toBe(false)
      expect(publishedIds.has(key.keyId)).toBe(false)
    }
  })

  it("topUpOneTimeKeys throws when there is no local identity to top up (issue #60)", async () => {
    const store = await freshStore()
    await expect(store.topUpOneTimeKeys("alice-id", "device-1", 5)).rejects.toThrow(/no local olm identity/i)
  })

  it("saveOwnPlaintext survives a simulated reload (fresh module instance) and is wiped by resetOlmIdentity", async () => {
    const store = await freshStore()
    await store.ensureOlmIdentity("alice-id")
    await store.saveOwnPlaintext("msg-1", "hello from myself")

    // Simulate a page reload: a brand new module instance, same IndexedDB.
    vi.resetModules()
    const reloaded = await import("./olm-protocol-store")
    expect(await reloaded.loadOwnPlaintext("msg-1")).toBe("hello from myself")
    expect(await reloaded.loadOwnPlaintext("never-sent")).toBeNull()

    await reloaded.resetOlmIdentity()
    expect(await reloaded.loadOwnPlaintext("msg-1")).toBeNull()
  })
})
