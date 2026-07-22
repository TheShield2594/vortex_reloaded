"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Loader2, Palette } from "lucide-react"
import { Button } from "@/components/ui/button"
import { THEME_PRESET_OPTIONS } from "@/components/settings/appearance-settings-page"
import { GlassBadge } from "@/components/ui/glass-icon"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThemeIdentityProps {
  /** Current user's selected theme preset name. */
  currentTheme: string
  /** Whether this is for a user profile or server settings. */
  variant: "profile" | "server"
  /** Server ID — only needed for variant="server". */
  serverId?: string
}

// ---------------------------------------------------------------------------
// Theme-as-Identity: Profile badge
// ---------------------------------------------------------------------------

/**
 * Displays a user's theme as a visual identity badge on their profile.
 *
 * Shows the theme name, a color swatch, and a short description —
 * making theme choice a social/identity signal rather than just a setting.
 */
export function ThemeIdentityBadge({ themeName }: { themeName: string }): React.ReactElement {
  const theme = THEME_PRESET_OPTIONS.find((t) => t.value === themeName)
  if (!theme) return <></>

  return (
    <GlassBadge tint={theme.accent}>
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ background: theme.accent }}
      />
      <span>Uses {theme.label}</span>
    </GlassBadge>
  )
}

// ---------------------------------------------------------------------------
// Theme-as-Identity: Server recommended theme
// ---------------------------------------------------------------------------

/**
 * Server "Recommended Theme" setting — lets server owners suggest a theme
 * that applies for members when they join.
 *
 * Renders a theme selector grid with a save button.
 */
export function ServerRecommendedTheme({ serverId }: { serverId: string }): React.ReactElement {
  const [selectedTheme, setSelectedTheme] = useState<string>("")
  const [savedTheme, setSavedTheme] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load current server recommended theme
  useEffect(() => {
    setLoading(true)
    fetch(`/api/servers/${serverId}/settings/theme`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load theme settings")
        return r.json()
      })
      .then((data: { recommended_theme: string | null }) => {
        const theme = data.recommended_theme ?? ""
        setSelectedTheme(theme)
        setSavedTheme(theme)
        setError(null)
      })
      .catch((err: unknown) => {
        console.error("[ServerRecommendedTheme] Load error", err)
        setError("Failed to load theme settings")
      })
      .finally(() => setLoading(false))
  }, [serverId])

  const save = useCallback(async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/servers/${serverId}/settings/theme`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommended_theme: selectedTheme || null }),
      })
      if (res.ok) {
        setSavedTheme(selectedTheme)
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setError(body.error ?? "Failed to save theme")
      }
    } catch (err: unknown) {
      console.error("[ServerRecommendedTheme] Save error", err)
      setError("Failed to save theme")
    } finally {
      setSaving(false)
    }
  }, [serverId, selectedTheme])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--theme-text-muted)" }} />
        <span className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Loading theme settings...</span>
      </div>
    )
  }

  const hasChanges = selectedTheme !== savedTheme

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--theme-text-primary)" }}>
          <Palette className="w-4 h-4" style={{ color: "var(--theme-accent)" }} />
          Recommended Theme
        </h3>
        <p className="text-xs mt-1" style={{ color: "var(--theme-text-muted)" }}>
          Suggest a theme for members joining this server. They can always change it later.
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {/* "None" option */}
        <button
          type="button"
          onClick={() => setSelectedTheme("")}
          className="relative rounded-lg overflow-hidden transition-all focus-visible:outline-none focus-visible:ring-2"
          style={{
            height: 56,
            border: `2px solid ${selectedTheme === "" ? "var(--theme-accent)" : "var(--theme-bg-tertiary)"}`,
            background: "var(--theme-bg-tertiary)",
          }}
        >
          <span className="text-[10px] font-medium" style={{ color: "var(--theme-text-muted)" }}>None</span>
          {selectedTheme === "" && (
            <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ background: "var(--theme-accent)" }}>
              <Check className="w-2 h-2 text-white" />
            </div>
          )}
        </button>

        {THEME_PRESET_OPTIONS.map((theme) => {
          const isActive = selectedTheme === theme.value
          return (
            <button
              key={theme.value}
              type="button"
              onClick={() => setSelectedTheme(theme.value)}
              className="relative rounded-lg overflow-hidden transition-all focus-visible:outline-none focus-visible:ring-2"
              style={{
                height: 56,
                border: `2px solid ${isActive ? theme.accent : "transparent"}`,
                boxShadow: isActive ? `0 0 8px ${theme.accent}40` : "none",
              }}
            >
              <div className="w-full h-full flex" style={{ background: theme.bg }}>
                <div className="w-[30%] h-full" style={{ background: theme.surface }} />
                <div className="flex-1 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full" style={{ background: theme.accent }} />
                </div>
              </div>
              {isActive && (
                <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ background: theme.accent }}>
                  <Check className="w-2 h-2 text-white" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 text-[8px] font-semibold text-center py-0.5" style={{ background: `linear-gradient(transparent, ${theme.bg}ee)`, color: theme.textPrimary }}>
                {theme.label}
              </div>
            </button>
          )
        })}
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--theme-danger, #ef4444)" }}>{error}</p>
      )}

      {hasChanges && (
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
          Save Recommended Theme
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Theme preview card (for landing page / discovery)
// ---------------------------------------------------------------------------

/**
 * Interactive theme preview card for the landing page.
 * Shows a mini chat mockup in the theme's colors with hover interaction.
 */
export function ThemePreviewCard({ themeValue }: { themeValue: string }): React.ReactElement {
  const theme = THEME_PRESET_OPTIONS.find((t) => t.value === themeValue)
  if (!theme) return <></>

  return (
    <div
      className="rounded-xl overflow-hidden transition-transform hover:scale-105 cursor-pointer"
      style={{
        width: 160,
        height: 100,
        background: theme.bg,
        border: `1px solid color-mix(in srgb, ${theme.textMuted} 15%, transparent)`,
        boxShadow: `0 4px 16px color-mix(in srgb, ${theme.bg} 60%, black)`,
      }}
    >
      <div className="flex h-full">
        <div className="w-[30%] p-1.5 space-y-1" style={{ background: theme.surface }}>
          <div className="h-1 w-full rounded-full" style={{ background: theme.textMuted, opacity: 0.3 }} />
          <div className="h-1 w-3/4 rounded-full" style={{ background: theme.textMuted, opacity: 0.2 }} />
          <div className="h-1 w-full rounded-full" style={{ background: theme.accent, opacity: 0.5 }} />
        </div>
        <div className="flex-1 p-2 flex flex-col justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ background: theme.accent }} />
              <div className="h-1 flex-1 rounded-full" style={{ background: theme.textPrimary, opacity: 0.4 }} />
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ background: theme.accent, opacity: 0.6 }} />
              <div className="h-1 w-3/4 rounded-full" style={{ background: theme.textPrimary, opacity: 0.3 }} />
            </div>
          </div>
          <div className="h-2.5 rounded-sm" style={{ background: theme.surface }} />
        </div>
      </div>
      <div className="text-[9px] text-center font-semibold py-0.5 -mt-4 relative z-10" style={{ color: theme.textPrimary, background: `linear-gradient(transparent, ${theme.bg})` }}>
        {theme.label}
      </div>
    </div>
  )
}
