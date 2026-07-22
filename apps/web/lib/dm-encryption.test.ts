import { describe, expect, it } from "vitest"
import {
  decryptDmContent,
  encryptDmContent,
  exportPublicKey,
  generateConversationKey,
  generateDeviceKeyPair,
  importPublicKey,
  nextKeyVersion,
  unwrapConversationKey,
  wrapConversationKey,
} from "./dm-encryption"

describe("dm-encryption", () => {
  it("encrypts and decrypts message payloads", async () => {
    const conversationKey = generateConversationKey()
    const envelope = await encryptDmContent("hello encrypted world", conversationKey, 1)
    const plaintext = await decryptDmContent(envelope, conversationKey)
    expect(plaintext).toBe("hello encrypted world")
  })

  it("fails decrypt with the wrong conversation key", async () => {
    const conversationKey = generateConversationKey()
    const wrongConversationKey = generateConversationKey()
    const envelope = await encryptDmContent("secret", conversationKey, 1)

    await expect(decryptDmContent(envelope, wrongConversationKey)).rejects.toThrow()
  })

  it("fails decrypt when ciphertext is tampered", async () => {
    const conversationKey = generateConversationKey()
    const envelope = await encryptDmContent("secret", conversationKey, 1)
    const tampered = { ...envelope }

    const decoded = Uint8Array.from(atob(tampered.ciphertext), (c) => c.charCodeAt(0))
    decoded[0] ^= 0xff
    tampered.ciphertext = btoa(String.fromCharCode(...decoded))

    await expect(decryptDmContent(tampered, conversationKey)).rejects.toThrow()
  })

  it("wraps and unwraps per-recipient conversation key", async () => {
    const alice = await generateDeviceKeyPair()
    const bob = await generateDeviceKeyPair()
    const sharedConversationKey = generateConversationKey()

    const bobPublic = await exportPublicKey(bob.publicKey)
    const wrapped = await wrapConversationKey(sharedConversationKey, alice.privateKey, await importPublicKey(bobPublic))
    const unwrapped = await unwrapConversationKey(wrapped, bob.privateKey, alice.publicKey)

    expect(Buffer.from(unwrapped).toString("hex")).toBe(Buffer.from(sharedConversationKey).toString("hex"))
  })

  it("fails unwrap for unintended recipient", async () => {
    const alice = await generateDeviceKeyPair()
    const bob = await generateDeviceKeyPair()
    const mallory = await generateDeviceKeyPair()
    const sharedConversationKey = generateConversationKey()

    const bobPublic = await exportPublicKey(bob.publicKey)
    const wrapped = await wrapConversationKey(sharedConversationKey, alice.privateKey, await importPublicKey(bobPublic))

    await expect(unwrapConversationKey(wrapped, mallory.privateKey, alice.publicKey)).rejects.toThrow()
  })

  it("supports encrypt/decrypt for empty string payloads", async () => {
    const conversationKey = generateConversationKey()
    const envelope = await encryptDmContent("", conversationKey, 1)

    await expect(decryptDmContent(envelope, conversationKey)).resolves.toBe("")
  })

  it("preserves nextKeyVersion contract for future rotation logic", () => {
    expect(nextKeyVersion(1)).toBe(2)
    expect(nextKeyVersion(9)).toBe(10)
  })
})
