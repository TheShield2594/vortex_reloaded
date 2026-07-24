/**
 * Server-side validation for Olm (Matrix.org's Double Ratchet
 * implementation) key material. Mostly bounds/charset validation, plus
 * verifyOneTimeKeySignature below: verifying a one-time key's *signature*
 * needs only the device's public ed25519 identity key, which the server
 * already stores, so it can confirm a key genuinely belongs to a registered
 * device without ever holding a private key. Full client-side authenticity
 * (pinning a device's identity across sessions) still happens against that
 * same self-signed identity — see lib/olm-protocol.ts's
 * verifyKeyBundleSignature.
 */
import { createPublicKey, verify } from "node:crypto"

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

function isBase64String(value: unknown, minLen: number, maxLen: number): value is string {
  return typeof value === "string" && value.length >= minLen && value.length <= maxLen && BASE64_RE.test(value)
}

/** Olm curve25519/ed25519 public keys are 32 raw bytes, base64-encoded (~43-44 chars). */
export function isValidOlmPublicKey(value: unknown): value is string {
  return isBase64String(value, 32, 64)
}

/** Olm ed25519 signatures are 64 raw bytes, base64-encoded (~86-88 chars). */
export function isValidOlmSignature(value: unknown): value is string {
  return isBase64String(value, 40, 128)
}

/** Olm key IDs are small integers serialized as strings (e.g. "1", "42"). */
export function isValidOlmKeyId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 32 && /^[0-9]+$/.test(value)
}

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128
}

export type ValidatedOneTimeKey = { keyId: string; publicKey: string; signature: string }

export function validateOneTimeKeyEntry(entry: unknown): ValidatedOneTimeKey | null {
  if (!entry || typeof entry !== "object") return null
  const e = entry as Record<string, unknown>
  if (!isValidOlmKeyId(e.keyId) || !isValidOlmPublicKey(e.publicKey) || !isValidOlmSignature(e.signature)) return null
  return { keyId: e.keyId, publicKey: e.publicKey, signature: e.signature }
}

// DER SPKI prefix for a raw 32-byte Ed25519 public key (RFC 8410). Lets Node's
// crypto build a KeyObject from Olm's raw base64 identity key without loading
// the Olm WASM core, which is kept client-only (see lib/olm-protocol.ts).
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

/**
 * Verifies an Olm ed25519 signature over `payload` against a device's public
 * identity key. Olm signatures are standard Ed25519 over the payload's UTF-8
 * bytes, so the server can confirm published key material genuinely belongs
 * to the identity it already holds — no private key, and no Olm WASM core
 * (kept client-only) — rather than forged material that would later fail the
 * claimer's client-side verifyKeyBundleSignature and break new session setup
 * (CWE-347). Returns false on any malformed input instead of throwing.
 */
function verifyEd25519(ed25519IdentityKey: string, payload: string, signature: string): boolean {
  try {
    const raw = Buffer.from(ed25519IdentityKey, "base64")
    if (raw.length !== 32) return false
    const keyObject = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: "der",
      type: "spki",
    })
    return verify(null, Buffer.from(payload, "utf8"), keyObject, Buffer.from(signature, "base64"))
  } catch {
    return false
  }
}

/**
 * Verifies a submitted one-time key's signature against a device's ed25519
 * identity. The signed payload matches olm-protocol.ts's
 * canonicalOneTimeKeyPayload.
 */
export function verifyOneTimeKeySignature(
  ed25519IdentityKey: string,
  userId: string,
  deviceId: string,
  key: ValidatedOneTimeKey
): boolean {
  return verifyEd25519(
    ed25519IdentityKey,
    JSON.stringify({ userId, deviceId, keyId: key.keyId, publicKey: key.publicKey }),
    key.signature
  )
}

/**
 * Verifies a submitted fallback ("last resort") key's signature against a
 * device's ed25519 identity. The signed payload matches olm-protocol.ts's
 * canonicalFallbackKeyPayload (note the `kind: "fallback"` field, which is
 * what keeps a fallback signature from being replayed as a one-time key).
 */
export function verifyFallbackKeySignature(
  ed25519IdentityKey: string,
  userId: string,
  deviceId: string,
  keyId: string,
  publicKey: string,
  signature: string
): boolean {
  return verifyEd25519(
    ed25519IdentityKey,
    JSON.stringify({ userId, deviceId, keyId, publicKey, kind: "fallback" }),
    signature
  )
}
