/**
 * Browser-side persistence shell for olm-protocol.ts's pure crypto core.
 * Owns IndexedDB access and the outer at-rest encryption of Olm pickles —
 * deliberately kept separate from olm-protocol.ts so that module stays
 * network/storage-free and unit-testable under plain Node.
 *
 * Every Olm account/session pickle is wrapped with a non-extractable
 * per-device AES-GCM CryptoKey before it's written to IndexedDB — the same
 * "IndexedDB + non-extractable CryptoKey" trust model the legacy-ecdh scheme
 * already uses for its device private key (see dm-channel-area.tsx's
 * putDevicePrivateKey). Olm's own pickle passphrase is a fixed, non-secret
 * constant (see olm-protocol.ts) since this outer layer is what actually
 * protects the data at rest.
 */
import {
  createIdentity,
  createOutboundSession,
  decryptMessage,
  encryptMessage,
  generateOneTimeKeyBatch,
  getIdentityKeys,
  targetKey,
  verifyKeyBundleSignature,
  type SerializedAccount,
  type SerializedSession,
  type OlmCiphertext,
  type OlmKeyBundle,
  type OlmPublishBundle,
  type OlmTarget,
} from "./olm-protocol"

const DEVICE_ID_STORAGE_KEY = "dm-olm-device-id-v1"
// Issue #46 (Strix MEDIUM, CWE-922): binds this browser profile's persisted
// Olm state to the authenticated user it was created for, so switching
// accounts on a shared machine can't inherit the previous user's private
// identity/session state — see ensureOlmIdentity/resetOlmIdentity below.
const OWNER_USER_ID_STORAGE_KEY = "dm-olm-owner-user-id-v1"
const DB_NAME = "vortexchat-olm-v1"
const WRAP_KEY_STORE = "wrap-key"
const ACCOUNT_STORE = "account"
const SESSION_STORE = "sessions"
// Issue #46 (Strix HIGH, CWE-322): pinned remote identity keys, keyed by
// `${userId}:${deviceId}` — see ensureOutboundSession/decryptFrom.
const PINNED_IDENTITY_STORE = "pinned-identities"
// Issue #46 (CodeRabbit): a sent message's Olm envelope never carries a
// ciphertext for the sending device itself (see encryptOlmText) — Olm has
// no way to decrypt what its own account just encrypted. Without this, the
// sender's own messages show as undecryptable after a reload wipes the
// in-memory decryptedContent cache. Keyed by message id, wrapped like
// account/session pickles — see saveOwnPlaintext/loadOwnPlaintext.
const OWN_PLAINTEXT_STORE = "own-plaintext"

type WrappedBlob = { iv: Uint8Array; ciphertext: ArrayBuffer }
type PinnedIdentity = { curve25519IdentityKey: string; ed25519IdentityKey: string }

/**
 * Thrown when a remote device's identity keys don't match what was
 * previously pinned for that (userId, deviceId) — either the device's key
 * material genuinely rotated (e.g. reinstalled the app) or the server is
 * attempting to substitute a different device's/attacker's identity.
 * Callers should surface this as a trust-changed warning rather than
 * silently retrying, and only clear the pin on deliberate user action.
 */
export class OlmIdentityMismatchError extends Error {
  constructor(public readonly userId: string, public readonly deviceId: string) {
    super(`Identity key for ${userId}:${deviceId} changed since it was last trusted — refusing to establish a session`)
    this.name = "OlmIdentityMismatchError"
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(WRAP_KEY_STORE)) db.createObjectStore(WRAP_KEY_STORE)
      if (!db.objectStoreNames.contains(ACCOUNT_STORE)) db.createObjectStore(ACCOUNT_STORE)
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE)
      if (!db.objectStoreNames.contains(PINNED_IDENTITY_STORE)) db.createObjectStore(PINNED_IDENTITY_STORE)
      if (!db.objectStoreNames.contains(OWN_PLAINTEXT_STORE)) db.createObjectStore(OWN_PLAINTEXT_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb()
  const value = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(store, "readonly")
    const req = tx.objectStore(store).get(key)
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return value
}

async function idbPut<T>(store: string, key: string, value: T): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite")
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function idbClearAll(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([WRAP_KEY_STORE, ACCOUNT_STORE, SESSION_STORE, PINNED_IDENTITY_STORE, OWN_PLAINTEXT_STORE], "readwrite")
    tx.objectStore(WRAP_KEY_STORE).clear()
    tx.objectStore(ACCOUNT_STORE).clear()
    tx.objectStore(SESSION_STORE).clear()
    tx.objectStore(PINNED_IDENTITY_STORE).clear()
    tx.objectStore(OWN_PLAINTEXT_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

// Issue #46 (CodeRabbit): dm-channel-area.tsx's initial load and its Olm
// decrypt effect both call ensureOlmReady()/getOrCreateWrapKey() on mount —
// an unsynchronized read-await-write here lets two concurrent first-run
// callers each generate their own wrap key/Olm account and last-write-win
// independently across stores, potentially wrapping an account pickle
// under a key that then gets overwritten (permanently undecryptable) or
// publishing two different identity keys for the same deviceId. A
// single-flight promise makes every caller during the race await the same
// creation instead of racing independent ones.
let wrapKeyPromise: Promise<CryptoKey> | null = null

async function getOrCreateWrapKey(): Promise<CryptoKey> {
  if (!wrapKeyPromise) {
    // Cleared once this settles (success *or* failure) — the point is only
    // to dedupe truly concurrent callers while creation is in flight, not
    // to cache the result forever (which would be a correctness bug on its
    // own: see ensureOlmIdentity's identical comment below).
    wrapKeyPromise = (async () => {
      const existing = await idbGet<CryptoKey>(WRAP_KEY_STORE, "self")
      if (existing) return existing
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
      await idbPut(WRAP_KEY_STORE, "self", key)
      return key
    })().finally(() => {
      wrapKeyPromise = null
    })
  }
  return wrapKeyPromise
}

async function wrapPickle(pickle: string, wrapKey: CryptoKey): Promise<WrappedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    wrapKey,
    new TextEncoder().encode(pickle) as BufferSource
  )
  return { iv, ciphertext }
}

async function unwrapPickle(blob: WrappedBlob, wrapKey: CryptoKey): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.iv as BufferSource },
    wrapKey,
    blob.ciphertext
  )
  return new TextDecoder().decode(plain)
}

function getOrCreateOlmDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, id)
  return id
}

async function loadAccount(wrapKey: CryptoKey): Promise<SerializedAccount | null> {
  const blob = await idbGet<WrappedBlob>(ACCOUNT_STORE, "self")
  if (!blob) return null
  return { pickle: await unwrapPickle(blob, wrapKey) }
}

async function saveAccount(account: SerializedAccount, wrapKey: CryptoKey): Promise<void> {
  await idbPut(ACCOUNT_STORE, "self", await wrapPickle(account.pickle, wrapKey))
}

async function loadSession(target: OlmTarget, wrapKey: CryptoKey): Promise<SerializedSession | null> {
  const blob = await idbGet<WrappedBlob>(SESSION_STORE, targetKey(target))
  if (!blob) return null
  return { pickle: await unwrapPickle(blob, wrapKey) }
}

async function saveSession(target: OlmTarget, session: SerializedSession, wrapKey: CryptoKey): Promise<void> {
  await idbPut(SESSION_STORE, targetKey(target), await wrapPickle(session.pickle, wrapKey))
}

/** Pinned identity keys are public material — no need to wrap them like account/session pickles. */
export async function getPinnedIdentity(target: OlmTarget): Promise<PinnedIdentity | null> {
  return idbGet<PinnedIdentity>(PINNED_IDENTITY_STORE, targetKey(target))
}

async function pinIdentity(target: OlmTarget, identity: PinnedIdentity): Promise<void> {
  await idbPut(PINNED_IDENTITY_STORE, targetKey(target), identity)
}

/**
 * Verifies `identity` against any existing pin for `target`, pinning it if
 * this is the first time this device has been contacted. Throws
 * OlmIdentityMismatchError if it conflicts with a previous pin.
 */
async function checkAndPinIdentity(target: OlmTarget, identity: PinnedIdentity): Promise<void> {
  const pinned = await getPinnedIdentity(target)
  if (!pinned) {
    await pinIdentity(target, identity)
    return
  }
  if (pinned.curve25519IdentityKey !== identity.curve25519IdentityKey || pinned.ed25519IdentityKey !== identity.ed25519IdentityKey) {
    throw new OlmIdentityMismatchError(target.userId, target.deviceId)
  }
}

/** Persists the plaintext of a message this device just sent, so it survives a reload (see OWN_PLAINTEXT_STORE). */
export async function saveOwnPlaintext(messageId: string, plaintext: string): Promise<void> {
  const wrapKey = await getOrCreateWrapKey()
  await idbPut(OWN_PLAINTEXT_STORE, messageId, await wrapPickle(plaintext, wrapKey))
}

/** Recovers a previously-sent message's plaintext saved by saveOwnPlaintext, or null if none is cached. */
export async function loadOwnPlaintext(messageId: string): Promise<string | null> {
  const wrapKey = await getOrCreateWrapKey()
  const blob = await idbGet<WrappedBlob>(OWN_PLAINTEXT_STORE, messageId)
  if (!blob) return null
  return unwrapPickle(blob, wrapKey)
}

type OlmIdentity = {
  deviceId: string
  curve25519IdentityKey: string
  ed25519IdentityKey: string
}

// Same concurrent-first-run hazard as getOrCreateWrapKey above, and
// reachable the same way (loadMessages() and the Olm decrypt effect in
// dm-channel-area.tsx both call this on mount) — keyed by userId so two
// truly different concurrent callers (unusual, but not impossible if the
// authenticated user changes mid-flight) don't share a promise meant for
// someone else's identity.
const ensureOlmIdentityPromises = new Map<string, Promise<{ identity: OlmIdentity; publish: OlmPublishBundle | null }>>()

/**
 * Loads this browser's device identity, creating one (and a fresh key
 * bundle to publish) if none exists yet. `publish` is non-null only when
 * the caller needs to POST a new bundle to /api/dm/olm/keys/device —
 * i.e. the very first time a device identity is created.
 *
 * If the persisted state belongs to a *different* authenticated user (a
 * shared/kiosk browser profile switching accounts — Strix MEDIUM finding),
 * it's wiped and a fresh identity is created for the new user instead of
 * silently reusing the previous user's private Olm identity.
 */
export async function ensureOlmIdentity(
  userId: string
): Promise<{ identity: OlmIdentity; publish: OlmPublishBundle | null }> {
  const existingPromise = ensureOlmIdentityPromises.get(userId)
  if (existingPromise) return existingPromise

  // Cleared once this settles (success *or* failure) — this only needs to
  // dedupe truly concurrent first-run callers, not cache the resolved
  // value forever. Caching it forever would mean `publish` (meant to be
  // non-null only the very first time an identity is created) stays
  // non-null for every later call in the same page session too, causing
  // dm-channel-area.tsx to redundantly re-POST the device bundle on every
  // channel switch.
  const promise = ensureOlmIdentityInner(userId).finally(() => {
    ensureOlmIdentityPromises.delete(userId)
  })
  ensureOlmIdentityPromises.set(userId, promise)
  return promise
}

async function ensureOlmIdentityInner(
  userId: string
): Promise<{ identity: OlmIdentity; publish: OlmPublishBundle | null }> {
  const storedOwnerUserId = localStorage.getItem(OWNER_USER_ID_STORAGE_KEY)
  if (storedOwnerUserId && storedOwnerUserId !== userId) {
    await resetOlmIdentity()
  }

  const deviceId = getOrCreateOlmDeviceId()
  const wrapKey = await getOrCreateWrapKey()
  const existing = await loadAccount(wrapKey)

  if (existing) {
    const identity = await getIdentityKeys(existing)
    localStorage.setItem(OWNER_USER_ID_STORAGE_KEY, userId)
    return { identity: { deviceId, ...identity }, publish: null }
  }

  const { account, publish } = await createIdentity(userId, deviceId)
  await saveAccount(account, wrapKey)
  localStorage.setItem(OWNER_USER_ID_STORAGE_KEY, userId)
  return {
    identity: { deviceId, curve25519IdentityKey: publish.curve25519IdentityKey, ed25519IdentityKey: publish.ed25519IdentityKey },
    publish,
  }
}

/** Generates and persists a fresh one-time-key batch to top up the published supply; returns it for the caller to POST. */
export async function topUpOneTimeKeys(userId: string, deviceId: string, count = 20) {
  const wrapKey = await getOrCreateWrapKey()
  const account = await loadAccount(wrapKey)
  if (!account) throw new Error("No local Olm identity to top up")
  const { account: updated, oneTimeKeys } = await generateOneTimeKeyBatch(account, userId, deviceId, count)
  await saveAccount(updated, wrapKey)
  return oneTimeKeys
}

/** True if a pairwise session with this device is already cached locally. */
export async function hasSessionWith(target: OlmTarget): Promise<boolean> {
  const wrapKey = await getOrCreateWrapKey()
  return (await loadSession(target, wrapKey)) !== null
}

/**
 * Establishes (or reuses) a pairwise session with a remote device. Verifies
 * the bundle's self-signature (see verifyKeyBundleSignature) — proof the
 * bundle is internally consistent, but *not* proof the server didn't
 * substitute a different identity altogether for this (userId, deviceId).
 * That's what pinning (checkAndPinIdentity) guards against: first contact
 * trusts and pins the claimed identity (TOFU), every contact after that
 * must match it exactly or this throws OlmIdentityMismatchError instead of
 * silently establishing a session with whatever the server just handed
 * back — see issue #46's Strix HIGH finding (a malicious/compromised
 * server could otherwise transparently MITM every "new" conversation).
 */
export async function ensureOutboundSession(
  remoteUserId: string,
  remoteDeviceId: string,
  bundle: OlmKeyBundle
): Promise<void> {
  const target: OlmTarget = { userId: remoteUserId, deviceId: remoteDeviceId }
  const wrapKey = await getOrCreateWrapKey()
  if (await loadSession(target, wrapKey)) return

  const verified = await verifyKeyBundleSignature(remoteUserId, remoteDeviceId, bundle)
  if (!verified) throw new Error(`Untrusted key bundle signature for ${remoteUserId}:${remoteDeviceId}`)

  await checkAndPinIdentity(target, {
    curve25519IdentityKey: bundle.curve25519IdentityKey,
    ed25519IdentityKey: bundle.ed25519IdentityKey,
  })

  const account = await loadAccount(wrapKey)
  if (!account) throw new Error("No local Olm identity")
  const { session } = await createOutboundSession(account, bundle)
  await saveSession(target, session, wrapKey)
}

/** Encrypts plaintext for a device with an already-established session (call ensureOutboundSession first). */
export async function encryptTo(remoteUserId: string, remoteDeviceId: string, plaintext: string): Promise<OlmCiphertext> {
  const target: OlmTarget = { userId: remoteUserId, deviceId: remoteDeviceId }
  const wrapKey = await getOrCreateWrapKey()
  const session = await loadSession(target, wrapKey)
  if (!session) throw new Error(`No session with ${remoteUserId}:${remoteDeviceId}`)
  const result = await encryptMessage(session, plaintext)
  await saveSession(target, result.session, wrapKey)
  return result.ciphertext
}

/**
 * Decrypts a ciphertext from a remote device, establishing an inbound
 * session first if needed. `identityHint`, when given, is the sender
 * device's identity as independently claimed by the device directory (see
 * dm-channel-area.tsx) — used only when there's no existing pin yet (true
 * first contact received before any outbound lookup ever pinned this
 * device). If a pin already exists it always wins over the hint. Either
 * way, a new session is verified via Olm's create_inbound_from (see
 * decryptMessage), so a message that doesn't actually match the
 * expected/pinned identity throws instead of silently succeeding.
 */
export async function decryptFrom(
  remoteUserId: string,
  remoteDeviceId: string,
  ciphertext: OlmCiphertext,
  identityHint?: PinnedIdentity
): Promise<string> {
  const target: OlmTarget = { userId: remoteUserId, deviceId: remoteDeviceId }
  const wrapKey = await getOrCreateWrapKey()
  const account = await loadAccount(wrapKey)
  if (!account) throw new Error("No local Olm identity")
  const session = await loadSession(target, wrapKey)

  const pinned = await getPinnedIdentity(target)
  const expected = pinned ?? identityHint

  const result = await decryptMessage(account, session, ciphertext, expected?.curve25519IdentityKey)
  await saveAccount(result.account, wrapKey)
  await saveSession(target, result.session, wrapKey)

  // First-ever contact with this device (no prior pin): now that Olm has
  // verified (or, lacking any hint, accepted on trust — see decryptMessage)
  // the session, pin whatever identity we resolved so every later message
  // from this (userId, deviceId) is held to it.
  if (!pinned && expected) {
    await pinIdentity(target, expected)
  }

  return result.plaintext
}

/** Wipes all local Olm state (identity, sessions, pinned remote identities). Does not affect the server's published keys. */
export async function resetOlmIdentity(): Promise<void> {
  localStorage.removeItem(DEVICE_ID_STORAGE_KEY)
  localStorage.removeItem(OWNER_USER_ID_STORAGE_KEY)
  wrapKeyPromise = null
  ensureOlmIdentityPromises.clear()
  await idbClearAll()
}
