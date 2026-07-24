import { describe, expect, it } from "vitest"
import { computeSafetyNumber, formatSafetyNumber } from "./safety-number"

describe("safety-number (issue #40, group trust model)", () => {
  it("is symmetric regardless of argument order", async () => {
    const alice = { userId: "alice", ed25519Key: "aaaa" }
    const bob = { userId: "bob", ed25519Key: "bbbb" }
    expect(await computeSafetyNumber(alice, bob)).toBe(await computeSafetyNumber(bob, alice))
  })

  it("produces a 60-digit number", async () => {
    const alice = { userId: "alice", ed25519Key: "aaaa" }
    const bob = { userId: "bob", ed25519Key: "bbbb" }
    const number = await computeSafetyNumber(alice, bob)
    expect(number).toMatch(/^\d{60}$/)
  })

  it("changes when either identity key changes", async () => {
    const alice = { userId: "alice", ed25519Key: "aaaa" }
    const bob = { userId: "bob", ed25519Key: "bbbb" }
    const rotatedBob = { userId: "bob", ed25519Key: "cccc" }
    const before = await computeSafetyNumber(alice, bob)
    const after = await computeSafetyNumber(alice, rotatedBob)
    expect(after).not.toBe(before)
  })

  it("differs for a different pair of users even with the same key material", async () => {
    const alice = { userId: "alice", ed25519Key: "same-key" }
    const bob = { userId: "bob", ed25519Key: "same-key" }
    const carol = { userId: "carol", ed25519Key: "same-key" }
    expect(await computeSafetyNumber(alice, bob)).not.toBe(await computeSafetyNumber(alice, carol))
  })

  it("formats a digit string into groups of 5", () => {
    expect(formatSafetyNumber("123456789012345")).toBe("12345 67890 12345")
  })
})
