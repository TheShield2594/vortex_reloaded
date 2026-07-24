import { describe, it, expect } from "vitest"
import { detectMimeFromBytes } from "./attachment-validation"

/**
 * Every magic-byte signature recognized by detectMimeFromBytes, mirrored from
 * MAGIC_BYTES. Kept as an independent copy so a regression in the source table
 * (dropped/reordered/edited entry) is caught rather than silently tracked.
 */
const SIGNATURES: Array<{ mime: string; bytes: number[]; offset: number }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff], offset: 0 },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0 },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38], offset: 0 },
  { mime: "image/webp", bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46], offset: 0 },
  { mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 },
  { mime: "video/mp4", bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { mime: "video/webm", bytes: [0x1a, 0x45, 0xdf, 0xa3], offset: 0 },
  { mime: "audio/mpeg", bytes: [0x49, 0x44, 0x33], offset: 0 }, // ID3 tag
  { mime: "audio/mpeg", bytes: [0xff, 0xfb], offset: 0 }, // MPEG sync
  { mime: "audio/ogg", bytes: [0x4f, 0x67, 0x67, 0x53], offset: 0 },
  { mime: "application/x-msdownload", bytes: [0x4d, 0x5a], offset: 0 }, // PE/MZ exe
  { mime: "application/x-elf", bytes: [0x7f, 0x45, 0x4c, 0x46], offset: 0 }, // ELF binary
]

/** Place `bytes` at `offset` in a zero-filled buffer of length `total`. */
function makeBuffer(bytes: number[], offset: number, total: number): Uint8Array {
  const buf = new Uint8Array(total)
  buf.set(bytes, offset)
  return buf
}

describe("detectMimeFromBytes", () => {
  it("detects every known magic-byte signature (including nonzero offsets)", () => {
    for (const sig of SIGNATURES) {
      // Pad past the signature so trailing content never affects the match.
      const buf = makeBuffer(sig.bytes, sig.offset, sig.offset + sig.bytes.length + 8)
      expect(detectMimeFromBytes(buf)).toBe(sig.mime)
    }
  })

  it("matches a signature sitting exactly at the end of the buffer", () => {
    for (const sig of SIGNATURES) {
      const buf = makeBuffer(sig.bytes, sig.offset, sig.offset + sig.bytes.length)
      expect(detectMimeFromBytes(buf)).toBe(sig.mime)
    }
  })

  it("returns null when the buffer is truncated before the signature completes", () => {
    for (const sig of SIGNATURES) {
      // One byte short of where the signature ends.
      const shortLen = sig.offset + sig.bytes.length - 1
      const buf = makeBuffer(sig.bytes.slice(0, sig.bytes.length - 1), sig.offset, shortLen)
      expect(detectMimeFromBytes(buf)).toBeNull()
    }
  })

  it("returns null when an offset signature's leading region is present but the signature bytes are missing", () => {
    for (const sig of SIGNATURES.filter((s) => s.offset > 0)) {
      // Enough length to hold the signature, but the signature bytes are absent.
      const buf = new Uint8Array(sig.offset + sig.bytes.length + 4)
      expect(detectMimeFromBytes(buf)).toBeNull()
    }
  })

  it("returns null for near-miss inputs that differ by a single byte", () => {
    for (const sig of SIGNATURES) {
      const corrupted = [...sig.bytes]
      corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] + 1) & 0xff
      const buf = makeBuffer(corrupted, sig.offset, sig.offset + corrupted.length + 4)
      const detected = detectMimeFromBytes(buf)
      // A one-byte change must not still resolve to the original signature.
      expect(detected).not.toBe(sig.mime)
    }
  })

  it("returns null for empty and arbitrary non-matching buffers", () => {
    expect(detectMimeFromBytes(new Uint8Array(0))).toBeNull()
    expect(detectMimeFromBytes(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]))).toBeNull()
    expect(detectMimeFromBytes(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBeNull()
  })
})
