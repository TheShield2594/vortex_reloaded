"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { useAppearanceStore } from "@/lib/stores/appearance-store"
import type { MessageDisplay, FontScale } from "@/lib/stores/appearance-store"
import { THEME_PRESET_OPTIONS } from "@/components/settings/appearance-settings-page"
import { useShallow } from "zustand/react/shallow"
import { useNotificationSound } from "@/hooks/use-notification-sound"

const CSS_TEMPLATE = `/**
 * Vortex full custom theme template
 *
 * Override any variable below. Everything in the app reads from these tokens.
 * Your CSS is injected on top of the selected preset, so you only need to
 * override the values you want to change.
 */

:root {
  /* ── App shell backgrounds ─────────────────────────────────────────── */
  --app-bg-primary: #313338;
  --app-bg-secondary: #2b2d31;

  /* ── Surface palette ───────────────────────────────────────────────── */
  --theme-bg-primary: #313338;
  --theme-bg-secondary: #2b2d31;
  --theme-bg-tertiary: #1e1f22;
  --theme-surface-elevated: #3f4147;
  --theme-surface-input: #383a40;
  --theme-surface-elevation-1: #32353a;
  --theme-surface-elevation-3: #42464d;
  --theme-surface-passive: var(--theme-surface-elevation-1);
  --theme-surface-active: var(--theme-surface-elevation-3);
  --theme-focus-shift: color-mix(in srgb, var(--theme-accent) 35%, transparent);

  /* ── Typography ────────────────────────────────────────────────────── */
  --theme-text-primary: #f2f3f5;
  --theme-text-normal: #dcddde;
  --theme-text-secondary: #b5bac1;
  --theme-text-muted: #949ba4;
  --theme-text-faint: #959ca6;
  --theme-text-bright: #dbdee1;

  /* ── Accent & semantic colors ──────────────────────────────────────── */
  --theme-accent: #5865f2;
  --theme-accent-secondary: #eb459e;
  --theme-link: #00a8fc;
  --theme-success: #23a55a;
  --theme-positive: #3ba55c;
  --theme-warning: #f0b132;
  --theme-danger: #f23f43;
  --theme-presence-offline: #80848e;

  /* ── Tailwind design tokens (HSL values, no hsl() wrapper) ─────── */
  --background: 223 7% 20%;
  --foreground: 220 9% 95%;
  --card: 220 7% 18%;
  --card-foreground: 220 9% 95%;
  --popover: 220 7% 14%;
  --popover-foreground: 220 9% 95%;
  --primary: 235 86% 65%;
  --primary-foreground: 0 0% 100%;
  --secondary: 220 6% 18%;
  --secondary-foreground: 215 8% 73%;
  --accent: 235 86% 65%;
  --accent-foreground: 0 0% 100%;
  --muted: 220 5% 30%;
  --muted-foreground: 215 8% 60%;
  --border: 220 6% 25%;
  --input: 220 6% 18%;
  --ring: 235 86% 65%;
  --destructive: 359 87% 57%;
  --destructive-foreground: 0 0% 100%;
}

/* Optional element-level overrides */
.message-content a { color: var(--theme-link); }
`

export function AppearanceTab(): React.JSX.Element {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const { messageDisplay, fontScale, saturation, themePreset, customCss, setMessageDisplay, setFontScale, setSaturation, setThemePreset, setCustomCss } = useAppearanceStore(
    useShallow((s) => ({ messageDisplay: s.messageDisplay, fontScale: s.fontScale, saturation: s.saturation, themePreset: s.themePreset, customCss: s.customCss, setMessageDisplay: s.setMessageDisplay, setFontScale: s.setFontScale, setSaturation: s.setSaturation, setThemePreset: s.setThemePreset, setCustomCss: s.setCustomCss }))
  )
  const toSettingsPayload = useAppearanceStore((s) => s.toSettingsPayload)
  const syncToAccount = useAppearanceStore((s) => s.syncToAccount)
  const { notificationSoundEnabled, setNotificationSoundEnabled, playNotification } = useNotificationSound()

  async function handleSaveAppearance(): Promise<void> {
    if (!syncToAccount) return
    setSaving(true)
    try {
      const res = await fetch("/api/users/appearance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance_settings: toSettingsPayload() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to save appearance")
      }
      toast({ title: "Appearance saved!" })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to save appearance", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold text-white mb-1">Theme Presets</h3>
        <p className="text-sm mb-4" style={{ color: "var(--theme-text-muted)" }}>
          Pick a skin — changes apply instantly. Layer your own CSS on top for full customization.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {THEME_PRESET_OPTIONS.map((preset) => (
            <button
              type="button"
              key={preset.value}
              onClick={() => setThemePreset(preset.value)}
              className="rounded-lg border px-3 py-2.5 text-left flex flex-col gap-2"
              style={{
                background: themePreset === preset.value ? "rgba(88,101,242,0.15)" : "var(--theme-bg-secondary)",
                borderColor: themePreset === preset.value ? "var(--theme-accent)" : "var(--theme-bg-tertiary)",
                color: themePreset === preset.value ? "var(--theme-text-primary)" : "var(--theme-text-secondary)",
              }}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-sm font-medium">{preset.label}</span>
                <div className="flex gap-1">
                  {[preset.bg, preset.accent, preset.textMuted].map((color) => (
                    <span key={color} className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  ))}
                </div>
              </div>
              <span className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{preset.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Message Display */}
      <div>
        <h3 className="text-base font-semibold text-white mb-1">Message Display</h3>
        <p className="text-sm mb-4" style={{ color: "var(--theme-text-muted)" }}>
          Choose how messages look in the chat.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {(["cozy", "compact"] as MessageDisplay[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setMessageDisplay(mode)}
              className="rounded-lg border px-3 py-2 text-sm capitalize"
              style={{
                background: messageDisplay === mode ? "rgba(88,101,242,0.15)" : "var(--theme-bg-secondary)",
                borderColor: messageDisplay === mode ? "var(--theme-accent)" : "var(--theme-bg-tertiary)",
                color: messageDisplay === mode ? "var(--theme-text-primary)" : "var(--theme-text-secondary)",
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Custom CSS */}
      <div>
        <h3 className="text-base font-semibold text-white mb-1">Custom CSS</h3>
        <p className="text-sm mb-3" style={{ color: "var(--theme-text-muted)" }}>
          Paste your full theme CSS here. Override the global tokens in the template (or add your own selectors). Your CSS is injected on top of the selected preset, so custom tokens and rules apply app-wide instantly.
        </p>
        <textarea
          value={customCss}
          onChange={(event) => setCustomCss(event.target.value)}
          placeholder={CSS_TEMPLATE}
          spellCheck={false}
          className="w-full min-h-[240px] rounded-lg border p-3 text-xs font-mono leading-relaxed"
          style={{ background: "var(--theme-bg-tertiary)", borderColor: customCss.length > 50000 ? "var(--theme-danger)" : "var(--theme-bg-tertiary)", color: "var(--theme-text-normal)", resize: "vertical" }}
        />
        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setCustomCss(CSS_TEMPLATE)}>Use Template</Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(CSS_TEMPLATE)
                  toast({ title: "Template copied" })
                } catch { /* clipboard unavailable */ }
              }}
            >
              Copy Template
            </Button>
            {customCss.trim() && (
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomCss("")} style={{ color: "var(--theme-danger)", borderColor: "rgba(242,63,67,0.4)" }}>
                Clear
              </Button>
            )}
          </div>
          <span className="text-xs tabular-nums" style={{ color: customCss.length > 50000 ? "var(--theme-danger)" : "var(--theme-text-faint)" }}>
            {customCss.length.toLocaleString()} / 50,000
          </span>
        </div>
      </div>

      {/* Font Size */}
      <div>
        <h3 className="text-base font-semibold text-white mb-1">Chat Font Scaling</h3>
        <p className="text-sm mb-4" style={{ color: "var(--theme-text-muted)" }}>
          Choose a comfortable size for reading messages.
        </p>
        <div className="flex items-center gap-3">
          {(["small", "normal", "large"] as FontScale[]).map((scale) => (
            <button
              key={scale}
              onClick={() => setFontScale(scale)}
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors border capitalize"
              style={{
                background: fontScale === scale ? "rgba(88,101,242,0.15)" : "var(--theme-bg-secondary)",
                borderColor: fontScale === scale ? "var(--theme-accent)" : "var(--theme-bg-tertiary)",
                color: fontScale === scale ? "var(--theme-text-primary)" : "var(--theme-text-secondary)",
                fontSize: scale === "small" ? "13px" : scale === "large" ? "15px" : "14px",
              }}
            >
              Aa
              <span className="block text-xs mt-0.5">{scale}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-white mb-1">Accessibility</h3>
        <div
          className="flex items-center justify-between p-3 rounded-lg"
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
        >
          <div>
            <p className="text-sm font-medium text-white">Reduced Saturation</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--theme-text-muted)" }}>
              Desaturates interface colors for color-sensitivity.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={saturation === "reduced"}
            onClick={() => setSaturation(saturation === "reduced" ? "normal" : "reduced")}
            className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200"
            style={{ background: saturation === "reduced" ? "var(--theme-accent)" : "var(--theme-text-faint)" }}
          >
            <span
              className="pointer-events-none inline-block h-5 w-5 transform rounded-full shadow ring-0 transition duration-200 ease-in-out mt-0.5"
              style={{
                background: "white",
                marginLeft: saturation === "reduced" ? "22px" : "2px",
                transition: "margin-left 0.2s",
              }}
            />
          </button>
        </div>
      </div>

      {/* Notification Sound */}
      <div>
        <h3 className="text-base font-semibold text-white mb-1">Notification Sound</h3>
        <div
          className="flex items-center justify-between p-3 rounded-lg"
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
        >
          <div>
            <p className="text-sm font-medium text-white">Play sound on new messages</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--theme-text-muted)" }}>
              Plays a short tone when you receive a message in another channel or DM.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={notificationSoundEnabled}
            onClick={() => {
              const next = !notificationSoundEnabled
              setNotificationSoundEnabled(next)
              if (next) playNotification()
            }}
            className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200"
            style={{ background: notificationSoundEnabled ? "var(--theme-accent)" : "var(--theme-text-faint)" }}
          >
            <span
              className="pointer-events-none inline-block h-5 w-5 transform rounded-full shadow ring-0 transition duration-200 ease-in-out mt-0.5"
              style={{
                background: "white",
                marginLeft: notificationSoundEnabled ? "22px" : "2px",
                transition: "margin-left 0.2s",
              }}
            />
          </button>
        </div>
      </div>

      {/* Save button — dedicated appearance-only save */}
      <div className="pt-2 flex justify-end">
        <div className="relative group">
          <Button onClick={handleSaveAppearance} disabled={saving || !syncToAccount} style={{ background: "var(--theme-accent)", color: "white" }}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Theme & Appearance
          </Button>
          {!syncToAccount && (
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-muted)" }}>
              Enable &quot;Sync to account&quot; to save server-side
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
