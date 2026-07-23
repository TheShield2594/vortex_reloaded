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
const DB_NAME = "vortexchat-olm-v1"
const WRAP_KEY_STORE = "wrap-key"
const ACCOUNT_STORE = "account"
const SESSION_STORE = "sessions"

type WrappedBlob = { iv: Uint8Array; ciphertext: ArrayBuffer }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(WRAP_KEY_STORE)) db.createObjectStore(WRAP_KEY_STORE)
      if (!db.objectStoreNames.contains(ACCOUNT_STORE)) db.createObjectStore(ACCOUNT_STORE)
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE)
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
    const tx = db.transaction([WRAP_KEY_STORE, ACCOUNT_STORE, SESSION_STORE], "readwrite")
    tx.objectStore(WRAP_KEY_STORE).clear()
    tx.objectStore(ACCOUNT_STORE).clear()
    tx.objectStore(SESSION_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function getOrCreateWrapKey(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(WRAP_KEY_STORE, "self")
  if (existing) return existing
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
  await idbPut(WRAP_KEY_STORE, "self", key)
  return key
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

export function getOrCreateOlmDeviceId(): string {
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

export type OlmIdentity = {
  deviceId: string
  curve25519IdentityKey: string
  ed25519IdentityKey: string
}

/**
 * Loads this browser's device identity, creating one (and a fresh key
 * bundle to publish) if none exists yet. `publish` is non-null only when
 * the caller needs to POST a new bundle to /api/dm/olm/keys/device —
 * i.e. the very first time a device identity is created.
 */
export async function ensureOlmIdentity(
  userId: string
): Promise<{ identity: OlmIdentity; publish: OlmPublishBundle | null }> {
  const deviceId = getOrCreateOlmDeviceId()
  const wrapKey = await getOrCreateWrapKey()
  const existing = await loadAccount(wrapKey)

  if (existing) {
    const identity = await getIdentityKeys(existing)
    return { identity: { deviceId, ...identity }, publish: null }
  }

  const { account, publish } = await createIdentity(userId, deviceId)
  await saveAccount(account, wrapKey)
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
 * the bundle's signature before use — see verifyKeyBundleSignature.
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

/** Decrypts a ciphertext from a remote device, establishing an inbound session first if needed. */
export async function decryptFrom(remoteUserId: string, remoteDeviceId: string, ciphertext: OlmCiphertext): Promise<string> {
  const target: OlmTarget = { userId: remoteUserId, deviceId: remoteDeviceId }
  const wrapKey = await getOrCreateWrapKey()
  const account = await loadAccount(wrapKey)
  if (!account) throw new Error("No local Olm identity")
  const session = await loadSession(target, wrapKey)

  const result = await decryptMessage(account, session, ciphertext)
  await saveAccount(result.account, wrapKey)
  await saveSession(target, result.session, wrapKey)
  return result.plaintext
}

/** Wipes all local Olm state (identity, sessions). Does not affect the server's published keys. */
export async function resetOlmIdentity(): Promise<void> {
  localStorage.removeItem(DEVICE_ID_STORAGE_KEY)
  await idbClearAll()
}
