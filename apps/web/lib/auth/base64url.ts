/**
 * Isomorphic base64url encode/decode helpers for WebAuthn / passkey flows.
 * These work in the browser (no Node Buffer dependency).
 */

/** Decode a base64url string to an ArrayBuffer. */
export function decodeBase64Url(input: string): ArrayBuffer {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/")
  const pad = "=".repeat((4 - (base64.length % 4)) % 4)
  const str = atob(base64 + pad)
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i += 1) bytes[i] = str.charCodeAt(i)
  return bytes.buffer
}

/** Encode an ArrayBuffer to a base64url string (no padding). */
export function encodeBase64Url(input: ArrayBuffer): string {
  const bytes = new Uint8Array(input)
  let str = ""
  bytes.forEach((b) => {
    str += String.fromCharCode(b)
  })
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
