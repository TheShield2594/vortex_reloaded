/**
 * Olm crypto core for DM channels — see issue #1 ("E2E: Signal Protocol")
 * and issue #3, which specifies pairwise Double Ratchet sessions per
 * conversation rather than a group sender-key ratchet (no Megolm): every
 * message, 1:1 or group, is encrypted once per recipient *device* using an
 * Olm session with that device.
 *
 * This is Olm — Matrix.org's own Double Ratchet implementation
 * (@matrix-org/olm, Apache-2.0), not Signal's own codebase or protocol
 * (which is GPLv3/AGPL-licensed; see the license discussion on issue #1).
 * Olm implements the same class of protocol Signal popularized (X3DH-style
 * session setup + Double Ratchet), independently specified and audited —
 * it is deliberately never called "Signal Protocol" anywhere in this
 * codebase, DB schema, or UI.
 *
 * This module is the pure crypto core: it takes and returns plain
 * serialized state (pickled Olm accounts/sessions as strings) and has no
 * knowledge of IndexedDB, fetch, or React — see olm-protocol-store.ts for
 * the browser-side persistence shell built on top of it. Keeping this layer
 * side-effect-free (besides the WASM module singleton) is what makes it
 * unit-testable under plain Node (see olm-protocol.test.ts).
 */

export type SerializedAccount = { pickle: string }
export type SerializedSession = { pickle: string }

export type OlmCiphertext = { type: 0 | 1; body: string }

export type OlmOneTimeKey = { keyId: string; publicKey: string; signature: string }

/** What a device publishes to the server (see app/api/dm/olm/keys/device). */
export type OlmPublishBundle = {
  deviceId: string
  curve25519IdentityKey: string
  ed25519IdentityKey: string
  fallbackKeyId: string
  fallbackPublicKey: string
  fallbackSignature: string
  oneTimeKeys: OlmOneTimeKey[]
}

/** What a claiming client fetches to start a session with a remote device. */
export type OlmKeyBundle = {
  curve25519IdentityKey: string
  ed25519IdentityKey: string
  keyId: string
  publicKey: string
  signature: string
  isFallback: boolean
}

export type OlmTarget = { userId: string; deviceId: string }

export type OlmEnvelope = {
  kind: "dm-olm"
  v: 1
  /**
   * The sending device's own deviceId (sender's userId is the message row's
   * sender_id). Every Olm session is keyed by remote (userId, deviceId), so
   * a recipient decrypting this envelope needs to know exactly which of the
   * sender's devices encrypted it — the sender may have several.
   */
  senderDeviceId: string
  /** Keyed by `${userId}:${deviceId}` — one ciphertext per recipient device. */
  ciphertexts: Record<string, OlmCiphertext>
}

// Olm requires a pickle passphrase for its own at-rest encryption of account
// and session state, but that's redundant here: olm-protocol-store.ts
// wraps every pickle in an outer AES-GCM layer using a non-extractable
// per-device CryptoKey before it ever touches IndexedDB, which is where the
// real at-rest confidentiality comes from (same trust model the existing
// legacy-ecdh scheme uses for its device private key). This constant only
// needs to be non-empty, not secret.
const OLM_PICKLE_KEY = "vortexchat-olm-pickle-v1"

export function targetKey(target: OlmTarget): string {
  return `${target.userId}:${target.deviceId}`
}

let olmModule: typeof import("@matrix-org/olm") | null = null
let olmLoadPromise: Promise<typeof import("@matrix-org/olm")> | null = null

/**
 * Lazily loads and initializes the Olm WASM module. In the browser, the
 * dynamic import resolves to @matrix-org/olm's UMD build, and Olm.init()
 * fetches public/olm.wasm (copied there at build/dev time by
 * scripts/copy-olm-wasm.mjs). `wasmPath` is only overridden by tests, which
 * run under plain Node and need a filesystem path instead of a URL.
 */
export async function loadOlm(wasmPath = "/olm.wasm"): Promise<typeof import("@matrix-org/olm")> {
  if (olmModule) return olmModule
  if (!olmLoadPromise) {
    olmLoadPromise = (async () => {
      const imported = await import("@matrix-org/olm")
      // @matrix-org/olm ships as a UMD/Emscripten build with no true ES
      // default export; its .d.ts types the namespace object itself as
      // carrying Account/Session/etc. That matches some CJS-interop shims
      // (webpack) but not others (plain Node ESM, which only populates
      // `.default`) — check for the real thing at runtime rather than
      // trusting one shape.
      const mod = imported.Account
        ? imported
        : (imported as unknown as { default: typeof imported }).default
      await mod.init({ locateFile: () => wasmPath })
      olmModule = mod
      return mod
    })()
  }
  return olmLoadPromise
}

function canonicalOneTimeKeyPayload(userId: string, deviceId: string, keyId: string, publicKey: string): string {
  return JSON.stringify({ userId, deviceId, keyId, publicKey })
}

function canonicalFallbackKeyPayload(userId: string, deviceId: string, keyId: string, publicKey: string): string {
  return JSON.stringify({ userId, deviceId, keyId, publicKey, kind: "fallback" })
}

/**
 * Creates a brand-new device identity: an Olm account, a fallback key
 * (functions like Signal's signed prekey), and a batch of one-time keys —
 * everything a device needs to publish so other devices can start sessions
 * with it asynchronously (X3DH-style).
 */
export async function createIdentity(
  userId: string,
  deviceId: string,
  oneTimeKeyCount = 20
): Promise<{ account: SerializedAccount; publish: OlmPublishBundle }> {
  const Olm = await loadOlm()
  const account = new Olm.Account()
  try {
    account.create()

    account.generate_fallback_key()
    const fallback = JSON.parse(account.unpublished_fallback_key()).curve25519 as Record<string, string>
    const fallbackKeyId = Object.keys(fallback)[0]
    if (!fallbackKeyId) throw new Error("Failed to generate fallback key")
    const fallbackPublicKey = fallback[fallbackKeyId] as string

    const identity = JSON.parse(account.identity_keys()) as { curve25519: string; ed25519: string }
    const fallbackSignature = account.sign(
      canonicalFallbackKeyPayload(userId, deviceId, fallbackKeyId, fallbackPublicKey)
    )

    const oneTimeKeys = generateOneTimeKeysOnAccount(account, userId, deviceId, oneTimeKeyCount)

    return {
      account: { pickle: account.pickle(OLM_PICKLE_KEY) },
      publish: {
        deviceId,
        curve25519IdentityKey: identity.curve25519,
        ed25519IdentityKey: identity.ed25519,
        fallbackKeyId,
        fallbackPublicKey,
        fallbackSignature,
        oneTimeKeys,
      },
    }
  } finally {
    account.free()
  }
}

/** Reads the (public) identity keys back out of a serialized account without mutating it. */
export async function getIdentityKeys(
  serialized: SerializedAccount
): Promise<{ curve25519IdentityKey: string; ed25519IdentityKey: string }> {
  const Olm = await loadOlm()
  const account = new Olm.Account()
  try {
    account.unpickle(OLM_PICKLE_KEY, serialized.pickle)
    const identity = JSON.parse(account.identity_keys()) as { curve25519: string; ed25519: string }
    return { curve25519IdentityKey: identity.curve25519, ed25519IdentityKey: identity.ed25519 }
  } finally {
    account.free()
  }
}

function generateOneTimeKeysOnAccount(
  account: InstanceType<Awaited<ReturnType<typeof loadOlm>>["Account"]>,
  userId: string,
  deviceId: string,
  count: number
): OlmOneTimeKey[] {
  account.generate_one_time_keys(count)
  const generated = JSON.parse(account.one_time_keys()).curve25519 as Record<string, string>
  account.mark_keys_as_published()
  return Object.entries(generated).map(([keyId, publicKey]) => ({
    keyId,
    publicKey,
    signature: account.sign(canonicalOneTimeKeyPayload(userId, deviceId, keyId, publicKey)),
  }))
}

/** Tops up an existing account's one-time key supply; returns the updated account and the new batch to publish. */
export async function generateOneTimeKeyBatch(
  serialized: SerializedAccount,
  userId: string,
  deviceId: string,
  count = 20
): Promise<{ account: SerializedAccount; oneTimeKeys: OlmOneTimeKey[] }> {
  const Olm = await loadOlm()
  const account = new Olm.Account()
  try {
    account.unpickle(OLM_PICKLE_KEY, serialized.pickle)
    const oneTimeKeys = generateOneTimeKeysOnAccount(account, userId, deviceId, count)
    return { account: { pickle: account.pickle(OLM_PICKLE_KEY) }, oneTimeKeys }
  } finally {
    account.free()
  }
}

/** Verifies a fetched key bundle's signature against the device's own ed25519 identity key (TOFU on that key itself). */
export async function verifyKeyBundleSignature(
  remoteUserId: string,
  remoteDeviceId: string,
  bundle: OlmKeyBundle
): Promise<boolean> {
  const Olm = await loadOlm()
  const utility = new Olm.Utility()
  try {
    const payload = bundle.isFallback
      ? canonicalFallbackKeyPayload(remoteUserId, remoteDeviceId, bundle.keyId, bundle.publicKey)
      : canonicalOneTimeKeyPayload(remoteUserId, remoteDeviceId, bundle.keyId, bundle.publicKey)
    utility.ed25519_verify(bundle.ed25519IdentityKey, payload, bundle.signature)
    return true
  } catch {
    return false
  } finally {
    utility.free()
  }
}

/** Starts an outbound session with a remote device from a verified key bundle (the X3DH-style handshake). */
export async function createOutboundSession(
  account: SerializedAccount,
  bundle: OlmKeyBundle
): Promise<{ session: SerializedSession }> {
  const Olm = await loadOlm()
  const acc = new Olm.Account()
  const session = new Olm.Session()
  try {
    acc.unpickle(OLM_PICKLE_KEY, account.pickle)
    session.create_outbound(acc, bundle.curve25519IdentityKey, bundle.publicKey)
    return { session: { pickle: session.pickle(OLM_PICKLE_KEY) } }
  } finally {
    session.free()
    acc.free()
  }
}

/** Encrypts plaintext for a single already-established session. */
export async function encryptMessage(
  session: SerializedSession,
  plaintext: string
): Promise<{ session: SerializedSession; ciphertext: OlmCiphertext }> {
  const Olm = await loadOlm()
  const s = new Olm.Session()
  try {
    s.unpickle(OLM_PICKLE_KEY, session.pickle)
    const result = s.encrypt(plaintext)
    return {
      session: { pickle: s.pickle(OLM_PICKLE_KEY) },
      ciphertext: { type: result.type as 0 | 1, body: result.body },
    }
  } finally {
    s.free()
  }
}

/**
 * Decrypts a ciphertext from a remote device. If `session` is null and the
 * ciphertext is a PreKey message (type 0), establishes a new inbound
 * session and consumes the one-time key it used. Otherwise decrypts against
 * the existing cached session.
 */
export async function decryptMessage(
  account: SerializedAccount,
  session: SerializedSession | null,
  ciphertext: OlmCiphertext
): Promise<{ account: SerializedAccount; session: SerializedSession; plaintext: string }> {
  const Olm = await loadOlm()
  const acc = new Olm.Account()
  const s = new Olm.Session()
  try {
    acc.unpickle(OLM_PICKLE_KEY, account.pickle)

    if (session) {
      s.unpickle(OLM_PICKLE_KEY, session.pickle)
      if (ciphertext.type === 0 && !s.matches_inbound(ciphertext.body)) {
        // A PreKey message that doesn't match our cached session (the remote
        // started a fresh session, e.g. after losing local state) — fall
        // through to establishing a new inbound session below. `s`/`acc`
        // (this call's, now-unused) are freed by the `finally` below exactly
        // once; the recursive call allocates and frees its own pair.
        return decryptMessage(account, null, ciphertext)
      }
    } else if (ciphertext.type !== 0) {
      throw new Error("No session for non-PreKey message")
    } else {
      s.create_inbound(acc, ciphertext.body)
      acc.remove_one_time_keys(s)
    }

    const plaintext = s.decrypt(ciphertext.type, ciphertext.body)

    return {
      account: { pickle: acc.pickle(OLM_PICKLE_KEY) },
      session: { pickle: s.pickle(OLM_PICKLE_KEY) },
      plaintext,
    }
  } finally {
    s.free()
    acc.free()
  }
}

export function parseOlmEnvelope(content: string | null): OlmEnvelope | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content)
    if (
      parsed?.kind === "dm-olm"
      && parsed?.v === 1
      && typeof parsed?.senderDeviceId === "string"
      && parsed.senderDeviceId.length > 0
      && parsed?.ciphertexts
      && typeof parsed.ciphertexts === "object"
      && !Array.isArray(parsed.ciphertexts)
    ) {
      return parsed as OlmEnvelope
    }
  } catch {
    return null
  }
  return null
}

export function isValidOlmCiphertext(value: unknown): value is OlmCiphertext {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (v.type === 0 || v.type === 1) && typeof v.body === "string" && v.body.length > 0
}
