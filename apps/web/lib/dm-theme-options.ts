import { type DmThemePreset } from "@/lib/dm-theme"

/**
 * Display metadata (label + accent swatch) for the conversation theme picker.
 * Deliberately lightweight — mirrors the accent colors in
 * `THEME_PRESET_OPTIONS` (components/settings/appearance-settings-page.tsx)
 * without pulling that whole settings-page module into the DM chat bundle.
 */
export const DM_THEME_PRESET_OPTIONS: { value: DmThemePreset; label: string; accent: string }[] = [
  { value: "twilight", label: "Twilight", accent: "#5865f2" },
  { value: "midnight-neon", label: "Midnight Neon", accent: "#00e5ff" },
  { value: "synthwave", label: "Synthwave", accent: "#f92aad" },
  { value: "carbon", label: "Carbon", accent: "#3ba55c" },
  { value: "oled-black", label: "OLED Black", accent: "#0abab5" },
  { value: "frost", label: "Frost", accent: "#e0a526" },
  { value: "clarity", label: "Clarity", accent: "#2563eb" },
  { value: "velvet-dusk", label: "Velvet Dusk", accent: "#cba6f7" },
  { value: "terminal", label: "Terminal", accent: "#4aef98" },
  { value: "sakura-blossom", label: "Sakura Blossom", accent: "#e84393" },
  { value: "frosthearth", label: "Frosthearth", accent: "#6eafc8" },
  { value: "night-city-neural", label: "Night City Neural", accent: "#00e6ff" },
]
