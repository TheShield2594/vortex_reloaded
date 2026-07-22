const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const ALLOWED_NAMED_COLORS = new Set([
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "indigo",
  "violet",
  "purple",
  "pink",
  "teal",
  "cyan",
  "magenta",
  "black",
  "white",
  "gray",
  "grey",
])

/** Returns a normalized banner color when valid, otherwise null. */
export function sanitizeBannerColor(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (HEX_COLOR_RE.test(trimmed)) return trimmed

  const lowered = trimmed.toLowerCase()
  return ALLOWED_NAMED_COLORS.has(lowered) ? lowered : null
}
