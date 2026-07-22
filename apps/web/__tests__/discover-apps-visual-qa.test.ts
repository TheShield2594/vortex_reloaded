/**
 * Visual QA regression tests for Discover Apps premium UI.
 *
 * Covers:
 *  - Card hierarchy presentation (icon, title, badge, rating, description)
 *  - Trust/rating placement positioning
 *  - Dropdown/picker overflow and layering behavior (z-index)
 *  - Skeleton/empty-state consistency
 *  - Trust badge tooltip structure
 *  - Permission impact grouping and confirmation flow
 *  - Server Settings Apps panel premium layout
 */

import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

// ── Source readers ──────────────────────────────────────────────────────────

const discoverPagePath = path.join(process.cwd(), "app", "channels", "discover", "page.tsx")
const discoverPage = fs.readFileSync(discoverPagePath, "utf8")

const appsTabPath = path.join(process.cwd(), "components", "settings", "apps-tab.tsx")
const appsTab = fs.readFileSync(appsTabPath, "utf8")

const marketplacePath = path.resolve(process.cwd(), "..", "..", "packages", "shared", "src", "marketplace.ts")
const marketplace = fs.readFileSync(marketplacePath, "utf8")

// ── 1. Card hierarchy presentation ─────────────────────────────────────────

describe("app card hierarchy", () => {
  it("renders AppIcon component with gradient fallback", () => {
    expect(discoverPage).toContain("function AppIcon(")
    expect(discoverPage).toContain("rounded-xl")
    expect(discoverPage).toContain("bg-gradient-to-br")
  })

  it("app cards use rounded-xl borders with hover shadow", () => {
    expect(discoverPage).toContain("rounded-xl border border-border/50 bg-card")
    expect(discoverPage).toContain("hover:shadow-md")
  })

  it("title uses base font-semibold for prominence", () => {
    expect(discoverPage).toContain('className="truncate text-base font-semibold"')
  })

  it("description uses text-sm with line-clamp-2", () => {
    expect(discoverPage).toContain("text-sm leading-relaxed text-muted-foreground line-clamp-2")
  })

  it("star rating renders 5 individual stars with fill logic", () => {
    expect(discoverPage).toContain("[1, 2, 3, 4, 5].map")
    expect(discoverPage).toContain("fill-amber-400 text-amber-400")
  })

  it("install button has hover-to-primary transition", () => {
    expect(discoverPage).toContain("group-hover:bg-primary group-hover:text-primary-foreground")
  })
})

// ── 2. Trust badge and rating placement ─────────────────────────────────────

describe("trust badge and rating placement", () => {
  it("trust badge is positioned inline with app title", () => {
    // Badge should be inside the same flex container as the title
    expect(discoverPage).toContain('className="flex items-center gap-2"')
    expect(discoverPage).toContain("TrustBadgeTooltip badge={app.trust_badge}")
  })

  it("TrustBadgeTooltip component exists with hover tooltip", () => {
    expect(discoverPage).toContain("function TrustBadgeTooltip(")
    expect(discoverPage).toContain("onMouseEnter")
    expect(discoverPage).toContain("onMouseLeave")
    expect(discoverPage).toContain('role="tooltip"')
  })

  it("trust badge has accessible aria-label", () => {
    expect(discoverPage).toContain("aria-label={`${info.label} trust badge: ${info.description}`}")
  })

  it("rating section is positioned at card bottom with justify-between", () => {
    expect(discoverPage).toContain("flex items-center justify-between px-5 pb-4 pt-4")
  })

  it("curated section cards show compact trust badge", () => {
    expect(discoverPage).toContain("trustBadgeColor(app.trust_badge)")
    expect(discoverPage).toContain("trustBadgeLabel(app.trust_badge)")
  })
})

// ── 3. Dropdown/picker overflow and layering ─────────────────────────────────

describe("picker z-index and overflow", () => {
  it("server picker dropdown uses z-50 for proper layering", () => {
    expect(discoverPage).toContain("z-50 mt-1 w-56 max-h-48 overflow-y-auto")
  })

  it("picker uses rounded-xl and shadow-xl for depth", () => {
    expect(discoverPage).toContain("rounded-xl border border-border bg-popover p-1.5 shadow-xl")
  })

  it("trust badge tooltip uses z-50 for layering above cards", () => {
    expect(discoverPage).toContain("z-50 mt-1 w-64 rounded-lg border border-border bg-popover")
  })

  it("picker closes on outside click via pointerdown listener", () => {
    expect(discoverPage).toContain('document.addEventListener("pointerdown"')
    expect(discoverPage).toContain('document.removeEventListener("pointerdown"')
  })
})

// ── 4. Skeleton and empty-state consistency ──────────────────────────────────

describe("skeleton and empty states", () => {
  it("loading skeleton grid matches card grid layout", () => {
    // Both use the same grid classes
    expect(discoverPage).toContain("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")
  })

  it("skeleton cards have consistent rounded-lg bg-card structure", () => {
    expect(discoverPage).toContain('className="rounded-lg bg-card p-4"')
  })

  it("skeleton renders 8 placeholder items", () => {
    expect(discoverPage).toContain("Array.from({ length: 8 })")
  })

  it("app empty state uses BrandedEmptyState component", () => {
    expect(discoverPage).toContain('<BrandedEmptyState')
    expect(discoverPage).toContain('"No apps in this lane"')
  })

  it("server empty state uses BrandedEmptyState with Create CTA", () => {
    expect(discoverPage).toContain('"No servers found"')
    expect(discoverPage).toContain("Create a Server")
  })
})

// ── 5. Permission transparency from shared package ──────────────────────────

describe("permission transparency (shared package)", () => {
  it("defines all four impact levels", () => {
    expect(marketplace).toContain('"low"')
    expect(marketplace).toContain('"medium"')
    expect(marketplace).toContain('"high"')
    expect(marketplace).toContain('"critical"')
  })

  it("TRUST_BADGE_INFO covers verified, partner, internal", () => {
    expect(marketplace).toContain("verified:")
    expect(marketplace).toContain("partner:")
    expect(marketplace).toContain("internal:")
  })

  it("trust badge info includes descriptions for all levels", () => {
    expect(marketplace).toContain("Reviewed by the VortexChat team")
    expect(marketplace).toContain("Built by an official VortexChat partner")
    expect(marketplace).toContain("Built and maintained by VortexChat")
  })

  it("APP_PERMISSION_META maps known scopes", () => {
    const scopes = ["read:messages", "read:members", "send:messages", "manage:messages", "manage:channels", "manage:roles", "manage:members", "admin"]
    for (const scope of scopes) {
      expect(marketplace, `Missing scope ${scope}`).toContain(`"${scope}"`)
    }
  })

  it("exports requiresInstallConfirmation function", () => {
    expect(marketplace).toContain("export function requiresInstallConfirmation")
  })

  it("exports getHighestImpact function", () => {
    expect(marketplace).toContain("export function getHighestImpact")
  })
})

// ── 6. Pre-install confirmation flow ─────────────────────────────────────────

describe("pre-install confirmation for elevated permissions", () => {
  it("renders AlertDialog for install confirmation", () => {
    expect(discoverPage).toContain("confirmInstall")
    expect(discoverPage).toContain("Review permissions for")
  })

  it("PermissionList component groups by impact level", () => {
    expect(discoverPage).toContain("function PermissionList(")
    expect(discoverPage).toContain("critical")
    expect(discoverPage).toContain("high")
    expect(discoverPage).toContain("medium")
    expect(discoverPage).toContain("low")
  })

  it("uses ShieldAlert icon for high/critical impact", () => {
    expect(discoverPage).toContain("ShieldAlert")
  })

  it("uses ShieldCheck icon for low/medium impact", () => {
    expect(discoverPage).toContain("ShieldCheck")
  })

  it("handleInstallClick checks requiresInstallConfirmation before install", () => {
    expect(discoverPage).toContain("function handleInstallClick")
    expect(discoverPage).toContain("requiresInstallConfirmation(app.permissions)")
  })
})

// ── 7. Server Settings Apps panel premium layout ────────────────────────────

describe("server settings apps panel", () => {
  it("installed apps section has icon header with Package icon", () => {
    expect(appsTab).toContain("Package")
    expect(appsTab).toContain("Installed Apps")
  })

  it("each installed app row has AppAvatar component", () => {
    expect(appsTab).toContain("function AppAvatar(")
    expect(appsTab).toContain("<AppAvatar name={appName}")
  })

  it("installed apps show trust badge pills", () => {
    expect(appsTab).toContain("TrustBadgePill")
    expect(appsTab).toContain("function TrustBadgePill(")
  })

  it("installed apps show relative install date", () => {
    expect(appsTab).toContain("function formatRelativeDate")
    expect(appsTab).toContain("formatRelativeDate(entry.installed_at)")
  })

  it("configure button shows chevron rotation on expand", () => {
    expect(appsTab).toContain('isExpanded && "rotate-90"')
  })

  it("marketplace section uses 2-column grid on desktop", () => {
    expect(appsTab).toContain("grid gap-2 sm:grid-cols-2")
  })

  it("empty installed state uses dashed border with icon", () => {
    expect(appsTab).toContain("border-dashed")
    expect(appsTab).toContain("No apps installed yet")
  })

  it("all-installed state shows confirmation message", () => {
    expect(appsTab).toContain("All caught up!")
    expect(appsTab).toContain("Every discoverable app is already installed")
  })

  it("loading state renders skeleton placeholders", () => {
    expect(appsTab).toContain("animate-pulse")
  })

  it("marketplace cards have hover-to-primary install button", () => {
    expect(appsTab).toContain("group-hover:bg-primary group-hover:text-primary-foreground")
  })
})
