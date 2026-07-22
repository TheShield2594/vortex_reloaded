import { describe, expect, it } from "vitest"
import { FOCUSABLE_SELECTOR_LIST, getNextFocusIndex } from "@/lib/a11y/focus-trap"

describe("accessibility focus-order contracts", () => {
  it("keeps focusable selector precedence stable for keyboard users", () => {
    expect(FOCUSABLE_SELECTOR_LIST).toEqual([
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ])
  })

  it("wraps tab order in both directions for focus-trapped panels", () => {
    expect(getNextFocusIndex(2, 3, false)).toBe(0)
    expect(getNextFocusIndex(0, 3, true)).toBe(2)
    expect(getNextFocusIndex(-1, 3, false)).toBe(0)
  })
})
