"use client"

import type { LucideIcon } from "lucide-react"
import type { JSX } from "react"

interface GlassIconProps {
  /** A Lucide icon component. */
  icon: LucideIcon
  /** Pixel size. Default 20. */
  size?: number
  /** Background tint color. Defaults to theme accent. */
  tint?: string
  /** Extra classes on the outer wrapper. */
  className?: string
  /** Accessible label. */
  label?: string
}

/**
 * Glass/translucent icon wrapper — part of the Vortex visual identity.
 *
 * Renders a Lucide icon inside a frosted-glass circle with a translucent
 * tinted background and subtle border, reinforcing the transparency brand thesis.
 *
 * Use this for feature cards, empty states, nav highlights, and anywhere
 * a decorative icon container is appropriate.
 */
export function GlassIcon({
  icon: Icon,
  size = 20,
  tint,
  className,
  label,
}: GlassIconProps): JSX.Element {
  const tintColor = tint ?? "var(--theme-accent)"
  const containerSize = Math.round(size * 2)

  return (
    <div
      className={`inline-flex items-center justify-center rounded-full shrink-0 ${className ?? ""}`}
      style={{
        width: containerSize,
        height: containerSize,
        background: `color-mix(in srgb, ${tintColor} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tintColor} 20%, transparent)`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={!label}
    >
      <Icon
        size={size}
        strokeWidth={1.5}
        style={{ color: tintColor }}
      />
    </div>
  )
}

/**
 * Glass card container — a translucent surface for content sections.
 *
 * Use for feature highlights, stat cards, or any elevated content area
 * that should feel lightweight and transparent.
 */
export function GlassCard({
  children,
  tint,
  className,
}: {
  children: React.ReactNode
  tint?: string
  className?: string
}): JSX.Element {
  const tintColor = tint ?? "var(--theme-accent)"

  return (
    <div
      className={`rounded-xl p-4 ${className ?? ""}`}
      style={{
        background: `color-mix(in srgb, ${tintColor} 6%, var(--theme-bg-secondary))`,
        border: `1px solid color-mix(in srgb, ${tintColor} 15%, transparent)`,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px color-mix(in srgb, black 15%, transparent), inset 0 1px 0 color-mix(in srgb, white 5%, transparent)",
      }}
    >
      {children}
    </div>
  )
}

/**
 * Glass badge — a small translucent pill for labels and status indicators.
 */
export function GlassBadge({
  children,
  tint,
  className,
}: {
  children: React.ReactNode
  tint?: string
  className?: string
}): JSX.Element {
  const tintColor = tint ?? "var(--theme-accent)"

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${className ?? ""}`}
      style={{
        color: tintColor,
        background: `color-mix(in srgb, ${tintColor} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tintColor} 20%, transparent)`,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      {children}
    </span>
  )
}
