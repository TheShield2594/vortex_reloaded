/**
 * Regression tests for standardized micro-interaction and loading choreography.
 *
 * Covers:
 *  - Motion timing/easing token definitions in globals.css
 *  - Interaction-state utility classes (hover, press, select)
 *  - Skeleton loading choreography classes and stagger utilities
 *  - Token-aware spinner classes
 *  - Reduced-motion media query completeness
 *  - Skeleton component variant exports
 *  - No bare Loader2/animate-spin in core chat surfaces
 */

import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

const cssPath = path.join(process.cwd(), "app", "globals.css")
const css = fs.readFileSync(cssPath, "utf8")

// ── helpers ────────────────────────────────────────────────────────────────

function hasToken(token: string): boolean {
  return css.includes(token)
}

function readVar(scope: string, variable: string): string {
  const scopeMatch = css.match(new RegExp(`${scope}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"))
  if (!scopeMatch) return ""
  const block = scopeMatch[1] ?? ""
  const tokenMatch = block.match(new RegExp(`${variable}:\\s*([^;]+);`))
  return tokenMatch?.[1]?.trim() ?? ""
}

function hasClass(selector: string): boolean {
  // Match .selector { or .selector:something {
  return new RegExp(`\\.${selector.replace(".", "\\.")}[\\s{:]`).test(css)
}

function hasReducedMotionCoverage(className: string): boolean {
  const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/m)?.[1] ?? ""
  return block.includes(className)
}

// ── 1. Motion timing tokens ────────────────────────────────────────────────

describe("motion timing tokens", () => {
  it("defines all required duration tokens in :root", () => {
    const durations = [
      "--motion-duration-instant",
      "--motion-duration-fast",
      "--motion-duration-standard",
      "--motion-duration-panel",
      "--motion-duration-slow",
      "--motion-duration-skeleton",
    ]
    for (const token of durations) {
      expect(css, `Missing token ${token}`).toContain(token)
    }
  })

  it("defines all required easing tokens in :root", () => {
    const easings = [
      "--motion-ease-standard",
      "--motion-ease-emphasized",
      "--motion-ease-decelerate",
      "--motion-ease-accelerate",
      "--motion-ease-spring",
    ]
    for (const token of easings) {
      expect(css, `Missing token ${token}`).toContain(token)
    }
  })

  it("duration tokens use increasing values (instant < fast < standard < panel < slow)", () => {
    const parseMs = (val: string) => parseInt(val, 10)
    const instant = parseMs(readVar(":root", "--motion-duration-instant"))
    const fast = parseMs(readVar(":root", "--motion-duration-fast"))
    const standard = parseMs(readVar(":root", "--motion-duration-standard"))
    const panel = parseMs(readVar(":root", "--motion-duration-panel"))
    const slow = parseMs(readVar(":root", "--motion-duration-slow"))

    expect(instant).toBeLessThan(fast)
    expect(fast).toBeLessThan(standard)
    expect(standard).toBeLessThan(panel)
    expect(panel).toBeLessThan(slow)
  })

  it("snapshots all timing/easing token values for regression", () => {
    const tokens = {
      durationInstant: readVar(":root", "--motion-duration-instant"),
      durationFast: readVar(":root", "--motion-duration-fast"),
      durationStandard: readVar(":root", "--motion-duration-standard"),
      durationPanel: readVar(":root", "--motion-duration-panel"),
      durationSlow: readVar(":root", "--motion-duration-slow"),
      durationSkeleton: readVar(":root", "--motion-duration-skeleton"),
      easingStandard: readVar(":root", "--motion-ease-standard"),
      easingEmphasized: readVar(":root", "--motion-ease-emphasized"),
      easingDecelerate: readVar(":root", "--motion-ease-decelerate"),
      easingAccelerate: readVar(":root", "--motion-ease-accelerate"),
      easingSpring: readVar(":root", "--motion-ease-spring"),
    }
    expect(tokens).toMatchSnapshot()
  })
})

// ── 2. Interaction-state tokens ────────────────────────────────────────────

describe("interaction-state design tokens", () => {
  it("defines hover, press, select, and skeleton surface tokens", () => {
    const tokens = [
      "--motion-hover-bg",
      "--motion-hover-bg-md",
      "--motion-press-scale",
      "--motion-select-bg",
      "--motion-skeleton-base",
      "--motion-skeleton-shimmer",
    ]
    for (const token of tokens) {
      expect(css, `Missing interaction token ${token}`).toContain(token)
    }
  })

  it("hover-bg tokens reference --theme-text-primary for theme-awareness", () => {
    const hoverBg = readVar(":root", "--motion-hover-bg")
    expect(hoverBg).toContain("--theme-text-primary")
    const hoverBgMd = readVar(":root", "--motion-hover-bg-md")
    expect(hoverBgMd).toContain("--theme-text-primary")
  })

  it("select-bg token references --theme-accent for brand consistency", () => {
    const selectBg = readVar(":root", "--motion-select-bg")
    expect(selectBg).toContain("--theme-accent")
  })
})

// ── 3. Interaction-state utility classes ──────────────────────────────────

describe("interaction-state utility classes", () => {
  it("defines .motion-hover utility", () => {
    expect(css).toContain(".motion-hover {")
  })

  it("defines .motion-press-sm active state", () => {
    expect(css).toContain(".motion-press-sm:active {")
  })

  it("defines .motion-selected utility", () => {
    expect(css).toContain(".motion-selected {")
  })

  it("defines .interactive-list-item compound utility", () => {
    expect(css).toContain(".interactive-list-item {")
    expect(css).toContain(".interactive-list-item:active {")
  })

  it("defines .motion-focus-ring utility", () => {
    expect(css).toContain(".motion-focus-ring {")
  })

  it("defines .motion-icon-hover with scale affordance", () => {
    expect(css).toContain(".motion-icon-hover {")
    expect(css).toContain(".motion-icon-hover:hover {")
    expect(css).toContain(".motion-icon-hover:active {")
  })

  it("interactive-list-item uses fast transition duration token", () => {
    const classBlock = css.match(/\.interactive-list-item\s*\{([^}]+)\}/)?.[1] ?? ""
    expect(classBlock).toContain("--motion-duration-fast")
  })
})

// ── 4. Skeleton loading choreography ──────────────────────────────────────

describe("skeleton loading choreography", () => {
  it("defines .skeleton-shimmer utility class", () => {
    expect(css).toContain(".skeleton-shimmer {")
  })

  it("skeleton-shimmer uses the skeleton duration token", () => {
    const classBlock = css.match(/\.skeleton-shimmer\s*\{([^}]+)\}/)?.[1] ?? ""
    expect(classBlock).toContain("--motion-duration-skeleton")
  })

  it("defines skeleton-shimmer keyframe animation", () => {
    expect(css).toContain("@keyframes skeleton-shimmer")
  })

  it("defines .skeleton-stagger with child delay overrides", () => {
    expect(css).toContain(".skeleton-stagger > *:nth-child(1)")
    expect(css).toContain(".skeleton-stagger > *:nth-child(2)")
    expect(css).toContain(".skeleton-stagger > *:nth-child(3)")
  })

  it("stagger delays are additive (each child has larger delay)", () => {
    const extractDelay = (nth: number) => {
      const match = css.match(
        new RegExp(`\\.skeleton-stagger > \\*:nth-child\\(${nth}\\)\\s*\\{[^}]*animation-delay:\\s*(\\d+)ms`)
      )
      return match ? parseInt(match[1], 10) : null
    }
    const d1 = extractDelay(1)
    const d2 = extractDelay(2)
    const d3 = extractDelay(3)
    const d4 = extractDelay(4)

    expect(d1).not.toBeNull()
    expect(d2).not.toBeNull()
    expect(d3).not.toBeNull()
    expect(d4).not.toBeNull()
    expect(d1!).toBeLessThan(d2!)
    expect(d2!).toBeLessThan(d3!)
    expect(d3!).toBeLessThan(d4!)
  })
})

// ── 5. Token-aware spinner ─────────────────────────────────────────────────

describe("token-aware motion-spinner", () => {
  it("defines .motion-spinner and .motion-spinner-sm", () => {
    expect(css).toContain(".motion-spinner {")
    expect(css).toContain(".motion-spinner-sm {")
  })

  it("motion-spinner references the accent color token", () => {
    const classBlock = css.match(/\.motion-spinner\s*\{([^}]+)\}/)?.[1] ?? ""
    expect(classBlock).toContain("--theme-accent")
  })

  it("defines motion-spin keyframe", () => {
    expect(css).toContain("@keyframes motion-spin")
  })
})

// ── 6. Reduced-motion accessibility ───────────────────────────────────────

describe("prefers-reduced-motion coverage", () => {
  it("contains a prefers-reduced-motion media query", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)")
  })

  const animatedClasses = [
    "motion-interactive",
    "motion-press",
    "motion-hover",
    "motion-press-sm",
    "motion-selected",
    "interactive-list-item",
    "motion-icon-hover",
    "panel-surface-motion",
    "action-rail-motion",
    "skeleton-shimmer",
    "motion-spinner",
    "motion-spinner-sm",
  ]

  for (const cls of animatedClasses) {
    it(`covers .${cls} in reduced-motion query`, () => {
      expect(
        hasReducedMotionCoverage(cls),
        `Missing reduced-motion override for .${cls}`
      ).toBe(true)
    })
  }

  it("disables skeleton-shimmer animation in reduced-motion", () => {
    const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/m)?.[1] ?? ""
    expect(block).toContain("skeleton-shimmer")
    expect(block).toContain("animation: none")
  })

  it("disables interactive-list-item transform in reduced-motion", () => {
    const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/m)?.[1] ?? ""
    expect(block).toContain("interactive-list-item")
    expect(block).toContain("transform: none")
  })
})

// ── 7. Skeleton component variant exports ─────────────────────────────────

describe("skeleton component variants", () => {
  const skeletonPath = path.join(process.cwd(), "components", "ui", "skeleton.tsx")
  const skeletonSrc = fs.readFileSync(skeletonPath, "utf8")

  it("exports base Skeleton component", () => {
    expect(skeletonSrc).toContain("export function Skeleton(")
  })

  it("exports MessageSkeleton variant for chat loading choreography", () => {
    expect(skeletonSrc).toContain("export function MessageSkeleton(")
  })

  it("exports MessageListSkeleton for full conversation loading", () => {
    expect(skeletonSrc).toContain("export function MessageListSkeleton(")
  })

  it("exports MemberSkeleton for member-list loading", () => {
    expect(skeletonSrc).toContain("export function MemberSkeleton(")
  })

  it("exports ChannelRowSkeleton for sidebar loading", () => {
    expect(skeletonSrc).toContain("export function ChannelRowSkeleton(")
  })

  it("MessageListSkeleton has aria-busy and aria-label for screen reader support", () => {
    expect(skeletonSrc).toContain('aria-busy="true"')
    expect(skeletonSrc).toContain("aria-label=")
  })

  it("Skeleton base uses skeleton-shimmer class (not deprecated animate-pulse)", () => {
    // Base Skeleton should use shimmer, not the old animate-pulse
    const baseSkeletonBlock = skeletonSrc.match(/export function Skeleton[\s\S]*?^}/m)?.[0] ?? skeletonSrc
    expect(baseSkeletonBlock).not.toContain("animate-pulse")
    expect(skeletonSrc).toContain("skeleton-shimmer")
  })

  it("skeleton components use aria-hidden on decorative elements", () => {
    expect(skeletonSrc).toContain('aria-hidden="true"')
  })
})

// ── 8. Core surface interaction regression ────────────────────────────────

describe("core surface interaction regression", () => {
  const dmListPath = path.join(process.cwd(), "components", "dm", "dm-list.tsx")
  const dmListSrc = fs.readFileSync(dmListPath, "utf8")

  it("DM list channel rows use interactive-list-item (not raw transition-colors)", () => {
    expect(dmListSrc).toContain("interactive-list-item")
  })

  it("DM list active state uses motion-selected (not hardcoded bg-white/10)", () => {
    expect(dmListSrc).toContain("motion-selected")
    // Ensure old hardcoded bg-white/10 active state is gone
    expect(dmListSrc).not.toContain('"bg-white/10 text-white"')
  })

  it("DM list loading skeleton uses skeleton-stagger", () => {
    expect(dmListSrc).toContain("skeleton-stagger")
  })

  it("DM list loading skeleton has aria-busy for accessibility", () => {
    expect(dmListSrc).toContain('aria-busy="true"')
  })

  it("DM list loading uses ChannelRowSkeleton (not raw Skeleton divs)", () => {
    expect(dmListSrc).toContain("ChannelRowSkeleton")
  })

  const friendsPath = path.join(process.cwd(), "components", "dm", "friends-sidebar.tsx")
  const friendsSrc = fs.readFileSync(friendsPath, "utf8")

  it("friends sidebar loading uses MemberSkeleton rows (not Loader2 spinner)", () => {
    expect(friendsSrc).toContain("MemberSkeleton")
    expect(friendsSrc).not.toContain("Loader2")
  })

  it("friends sidebar loading skeleton has aria-busy label", () => {
    expect(friendsSrc).toContain('aria-busy="true"')
    expect(friendsSrc).toContain('aria-label="Loading friends"')
  })

  it("friends sidebar add button uses motion-spinner (not bare animate-spin)", () => {
    expect(friendsSrc).toContain("motion-spinner")
    expect(friendsSrc).not.toContain("animate-spin")
  })

  const dmChannelPath = path.join(process.cwd(), "components", "dm", "dm-channel-area.tsx")
  const dmChannelSrc = fs.readFileSync(dmChannelPath, "utf8")

  it("dm-channel-area uses MessageListSkeleton for channel loading state", () => {
    expect(dmChannelSrc).toContain("MessageListSkeleton")
  })

  it("dm-channel-area uses motion-spinner classes (not bare animate-spin border divs)", () => {
    expect(dmChannelSrc).toContain("motion-spinner")
    // Old pattern was `animate-spin` with inline border styles — should be gone
    expect(dmChannelSrc).not.toContain("animate-spin")
  })
})
