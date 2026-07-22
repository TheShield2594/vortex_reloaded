const WRAP_INFO = new TextEncoder().encode("vortexchat-dm-wrap-v1")

export type EncryptedEnvelope = {
  kind: "dm-e2ee"
  version: 1
  keyVersion: number
  algorithm: "AES-GCM"
  iv: string
  ciphertext: string
}

export type DeviceKeyRecord = {
  deviceId: string
  publicKey: string
}

function getCrypto() {
  const c = globalThis.crypto
  if (!c?.subtle) throw new Error("WebCrypto unavailable")
  return c
}

function bytesToBase64(input: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ""
  for (let index = 0; index < input.length; index += chunkSize) {
    const chunk = input.subarray(index, index + chunkSize)
    binary += String.fromCharCode.apply(null, Array.from(chunk))
  }
  return btoa(binary)
}

function base64ToBytes(input: string): Uint8Array {
  return Uint8Array.from(atob(input), (c) => c.charCodeAt(0)) as Uint8Array
}

export async function generateDeviceKeyPair() {
  return getCrypto().subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  )
}

export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const spki = await getCrypto().subtle.exportKey("spki", publicKey)
  return bytesToBase64(new Uint8Array(spki))
}

export async function importPublicKey(publicKey: string): Promise<CryptoKey> {
  return getCrypto().subtle.importKey(
    "spki",
    base64ToBytes(publicKey) as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  )
}

export async function exportPrivateKey(privateKey: CryptoKey): Promise<string> {
  const pkcs8 = await getCrypto().subtle.exportKey("pkcs8", privateKey)
  return bytesToBase64(new Uint8Array(pkcs8))
}

export async function importPrivateKey(privateKey: string): Promise<CryptoKey> {
  return getCrypto().subtle.importKey(
    "pkcs8",
    base64ToBytes(privateKey) as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  )
}

async function deriveWrapKey(privateKey: CryptoKey, peerPublicKey: CryptoKey) {
  const bits = await getCrypto().subtle.deriveBits({ name: "ECDH", public: peerPublicKey }, privateKey, 256)
  const sharedKey = await getCrypto().subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"])
  return getCrypto().subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: WRAP_INFO },
    sharedKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

export function generateConversationKey(): Uint8Array {
  return getCrypto().getRandomValues(new Uint8Array(32))
}

export async function wrapConversationKey(
  conversationKey: Uint8Array,
  senderPrivateKey: CryptoKey,
  recipientPublicKey: CryptoKey
): Promise<string> {
  const wrapKey = await deriveWrapKey(senderPrivateKey, recipientPublicKey)
  const iv = getCrypto().getRandomValues(new Uint8Array(12))
  const cipher = await getCrypto().subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, wrapKey, conversationKey as BufferSource)
  const out = new Uint8Array(iv.length + cipher.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(cipher), iv.length)
  return bytesToBase64(out)
}

export async function unwrapConversationKey(
  wrapped: string,
  recipientPrivateKey: CryptoKey,
  senderPublicKey: CryptoKey
): Promise<Uint8Array> {
  const data = base64ToBytes(wrapped)
  const iv = data.slice(0, 12)
  const ciphertext = data.slice(12)
  const wrapKey = await deriveWrapKey(recipientPrivateKey, senderPublicKey)
  const plain = await getCrypto().subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, wrapKey, ciphertext as BufferSource)
  return new Uint8Array(plain)
}

export async function encryptDmContent(content: string, conversationKey: Uint8Array, keyVersion: number): Promise<EncryptedEnvelope> {
  const iv = getCrypto().getRandomValues(new Uint8Array(12))
  const key = await getCrypto().subtle.importKey("raw", conversationKey as BufferSource, { name: "AES-GCM" }, false, ["encrypt"])
  const plaintext = new TextEncoder().encode(content)
  const cipher = await getCrypto().subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext as BufferSource)
  return {
    kind: "dm-e2ee",
    version: 1,
    keyVersion,
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipher)),
  }
}

export async function decryptDmContent(envelope: EncryptedEnvelope, conversationKey: Uint8Array): Promise<string> {
  const key = await getCrypto().subtle.importKey("raw", conversationKey as BufferSource, { name: "AES-GCM" }, false, ["decrypt"])
  const plain = await getCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv) as BufferSource },
    key,
    base64ToBytes(envelope.ciphertext) as BufferSource
  )
  return new TextDecoder().decode(plain)
}

export function parseEncryptedEnvelope(content: string | null): EncryptedEnvelope | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content)
    if (
      parsed?.kind === "dm-e2ee"
      && parsed?.version === 1
      && typeof parsed?.ciphertext === "string"
      && parsed.ciphertext.length > 0
      && typeof parsed?.iv === "string"
      && parsed.iv.length > 0
      && typeof parsed?.algorithm === "string"
      && parsed.algorithm === "AES-GCM"
      && typeof parsed?.keyVersion === "number"
      && Number.isInteger(parsed.keyVersion)
      && parsed.keyVersion >= 0
    ) {
      return parsed as EncryptedEnvelope
    }
  } catch {
    return null
  }
  return null
}

export async function fingerprintFromPublicKey(publicKeyBase64: string): Promise<string> {
  const digest = await getCrypto().subtle.digest("SHA-256", base64ToBytes(publicKeyBase64) as BufferSource)
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
  return hex.slice(0, 32).match(/.{1,4}/g)?.join(" ") ?? hex.slice(0, 32)
}

// Centralized key-version bump logic used by rotation workflows; keep exported for future overflow/epoch handling.
export function nextKeyVersion(currentVersion: number): number {
  return currentVersion + 1
}
