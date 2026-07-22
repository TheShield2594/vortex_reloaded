import { describe, expect, it } from "vitest"
import { isValidAppealTransition, isValidAppealStatus } from "../lib/appeals"

describe("appeal state transitions", () => {
  it("allows submitted -> reviewing", () => {
    expect(isValidAppealTransition("submitted", "reviewing")).toBe(true)
  })

  it("blocks submitted -> approved", () => {
    expect(isValidAppealTransition("submitted", "approved")).toBe(false)
  })

  it("allows reviewing -> denied/approved/closed", () => {
    expect(isValidAppealTransition("reviewing", "denied")).toBe(true)
    expect(isValidAppealTransition("reviewing", "approved")).toBe(true)
    expect(isValidAppealTransition("reviewing", "closed")).toBe(true)
  })

  it("allows only finalization from approved/denied and blocks transitions from closed", () => {
    expect(isValidAppealTransition("approved", "closed")).toBe(true)
    expect(isValidAppealTransition("denied", "closed")).toBe(true)
    expect(isValidAppealTransition("approved", "reviewing")).toBe(false)
    expect(isValidAppealTransition("denied", "reviewing")).toBe(false)
    expect(isValidAppealTransition("closed", "reviewing")).toBe(false)
    expect(isValidAppealTransition("closed", "closed")).toBe(false)
  })

  it("validates status enum", () => {
    expect(isValidAppealStatus("submitted")).toBe(true)
    expect(isValidAppealStatus("invalid")).toBe(false)
  })
})
