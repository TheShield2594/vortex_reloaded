/**
 * Server-side shape validation for Olm (Matrix.org's Double Ratchet
 * implementation) key material. This is bounds/charset validation only —
 * the server never cryptographically verifies these keys (it can't; it
 * doesn't hold anyone's private key). Authenticity is verified client-side
 * against the device's self-signed ed25519 identity key — see
 * lib/olm-protocol.ts's verifyKeyBundleSignature.
 */

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
