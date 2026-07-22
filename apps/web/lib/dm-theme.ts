/**
 * Per-conversation theme presets.
 *
 * Mirrors the `ThemePreset` union in `@/lib/stores/appearance-store` (which is
 * a "use client" module) so this list can be imported from server-only code
 * (API routes) without pulling in client-only state. Keep in sync with
 * `THEME_PRESET_OPTIONS` in `@/components/settings/appearance-settings-page`
 * and the CHECK constraint in `supabase/migrations/00105_dm_channel_theme.sql`.
 */
export const DM_THEME_PRESETS = [
  "twilight",
  "midnight-neon",
  "synthwave",
  "carbon",
  "oled-black",
  "frost",
  "clarity",
  "velvet-dusk",
  "terminal",
  "sakura-blossom",
  "frosthearth",
  "night-city-neural",
] as const

export type DmThemePreset = (typeof DM_THEME_PRESETS)[number]

/** Type guard: validates an unknown value is either null or a recognized preset key. */
export function isValidDmThemePreset(value: unknown): value is DmThemePreset | null {
  if (value === null) return true
  return typeof value === "string" && (DM_THEME_PRESETS as readonly string[]).includes(value)
}
