import { describe, it, expect } from "vitest"
import { getClientIp, isGameActivity } from "./index"

describe("getClientIp", () => {
  it("prefers the first x-forwarded-for entry", () => {
    const headers = new Map([["x-forwarded-for", "203.0.113.5, 70.41.3.18"]])
    expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe("203.0.113.5")
  })

  it("falls back to cf-connecting-ip when x-forwarded-for is absent", () => {
    const headers = new Map([["cf-connecting-ip", "203.0.113.9"]])
    expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe("203.0.113.9")
  })

  it("falls back to x-real-ip when the others are absent", () => {
    const headers = new Map([["x-real-ip", "203.0.113.10"]])
    expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe("203.0.113.10")
  })

  it("returns null when no IP headers are present", () => {
    expect(getClientIp({ get: () => null })).toBeNull()
  })
})

describe("isGameActivity", () => {
  it("accepts an object with a string game_name", () => {
    expect(isGameActivity({ game_name: "Chess" })).toBe(true)
  })

  it("rejects null, non-objects, and missing game_name", () => {
    expect(isGameActivity(null)).toBe(false)
    expect(isGameActivity("Chess")).toBe(false)
    expect(isGameActivity({})).toBe(false)
  })
})
