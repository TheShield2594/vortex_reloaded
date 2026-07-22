"use client"

import React, { useRef, useCallback, useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { useAppearanceStore } from "@/lib/stores/appearance-store"
import { useAutoSyncAppearance } from "@/hooks/use-auto-sync-appearance"
import { useToast } from "@/components/ui/use-toast"
import type {
  MessageDisplay, FontScale, FontFamily, LineHeight, CodeFont,
  ThemePreset, ColorMode, ChatBubbleStyle, MessageGrouping,
  EmojiSize, TimestampFormat, NotificationBadgeStyle,
} from "@/lib/stores/appearance-store"

/* ─── Option definitions ──────────────────────────────── */

const MESSAGE_DISPLAY_OPTIONS: { value: MessageDisplay; label: string; description: string }[] = [
  { value: "cozy", label: "Cozy", description: "Avatars shown — comfortable reading" },
  { value: "compact", label: "Compact", description: "More messages visible at once" },
]

const FONT_SCALE_OPTIONS: { value: FontScale; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
]

const FONT_FAMILY_OPTIONS: { value: FontFamily; label: string; description: string }[] = [
  { value: "system", label: "System Default", description: "Uses your OS font" },
  { value: "inter", label: "Inter", description: "Clean, modern sans-serif" },
  { value: "mono", label: "Monospace", description: "Fixed-width coding font" },
  { value: "dyslexia", label: "OpenDyslexic", description: "Designed for readability" },
]

const LINE_HEIGHT_OPTIONS: { value: LineHeight; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Relaxed" },
]

const CODE_FONT_OPTIONS: { value: CodeFont; label: string }[] = [
  { value: "default", label: "System Mono" },
  { value: "fira-code", label: "Fira Code" },
  { value: "jetbrains-mono", label: "JetBrains Mono" },
  { value: "cascadia", label: "Cascadia Code" },
]

const COLOR_MODE_OPTIONS: { value: ColorMode; label: string; description: string }[] = [
  { value: "system", label: "System", description: "Follow your OS preference" },
  { value: "dark", label: "Dark", description: "Always use dark mode" },
  { value: "light", label: "Light", description: "Always use light mode" },
]

const CHAT_BUBBLE_STYLE_OPTIONS: { value: ChatBubbleStyle; label: string; description: string }[] = [
  { value: "flat", label: "Flat", description: "Inline messages like Slack/Discord" },
  { value: "bubble", label: "Bubbles", description: "Chat bubbles like iMessage" },
]

const MESSAGE_GROUPING_OPTIONS: { value: MessageGrouping; label: string; description: string }[] = [
  { value: "5min", label: "5 minutes", description: "Group messages within 5 min" },
  { value: "10min", label: "10 minutes", description: "Group messages within 10 min" },
  { value: "never", label: "Never", description: "Always show full header" },
]

const EMOJI_SIZE_OPTIONS: { value: EmojiSize; label: string; preview: string }[] = [
  { value: "small", label: "Small", preview: "Aa" },
  { value: "normal", label: "Normal", preview: "Aa" },
  { value: "large", label: "Large", preview: "Aa" },
]

const TIMESTAMP_FORMAT_OPTIONS: { value: TimestampFormat; label: string; example: string }[] = [
  { value: "12h", label: "12-hour", example: "2:41 PM" },
  { value: "24h", label: "24-hour", example: "14:41" },
]

const NOTIFICATION_BADGE_OPTIONS: { value: NotificationBadgeStyle; label: string; description: string }[] = [
  { value: "count", label: "Count", description: "Show number of unread items" },
  { value: "dot", label: "Dot", description: "Simple dot indicator" },
]

const ACCENT_PRESETS = [
  "#5865F2", "#a78bfa", "#f472b6", "#2dd4bf", "#0abab5",
  "#e0a526", "#2563eb", "#cba6f7", "#ef4444", "#22c55e",
  "#f97316", "#06b6d4",
]

export const THEME_PRESET_OPTIONS: {
  value: ThemePreset
  label: string
  description: string
  accent: string
  bg: string
  surface: string
  textPrimary: string
  textMuted: string
  supportsColorMode: boolean
}[] = [
  { value: "twilight", label: "Twilight", description: "Classic dark with blue accent", accent: "#5865f2", bg: "#313338", surface: "#2b2d31", textPrimary: "#f2f3f5", textMuted: "#949ba4", supportsColorMode: true },
  { value: "midnight-neon", label: "Midnight Neon", description: "Deep dark with vibrant neon", accent: "#00e5ff", bg: "#1b1f31", surface: "#151829", textPrimary: "#e6ecff", textMuted: "#8f9bbf", supportsColorMode: false },
  { value: "synthwave", label: "Synthwave", description: "Retro 80s with pink & cyan", accent: "#f92aad", bg: "#2a1e46", surface: "#23193b", textPrimary: "#f5edff", textMuted: "#a990d0", supportsColorMode: false },
  { value: "carbon", label: "Carbon", description: "Minimal gray with teal accent", accent: "#3ba55c", bg: "#1f2124", surface: "#191b1e", textPrimary: "#e7eaee", textMuted: "#98a0ab", supportsColorMode: false },
  { value: "oled-black", label: "OLED Black", description: "True black with Tiffany blue", accent: "#0abab5", bg: "#000000", surface: "#080808", textPrimary: "#f0f4f4", textMuted: "#7a9898", supportsColorMode: false },
  { value: "frost", label: "Frost", description: "Cool slate with warm amber", accent: "#e0a526", bg: "#1a2332", surface: "#151d2a", textPrimary: "#e8ecf2", textMuted: "#8494a8", supportsColorMode: false },
  { value: "clarity", label: "Clarity", description: "Clean & minimal light theme", accent: "#2563eb", bg: "#ffffff", surface: "#f8f9fa", textPrimary: "#1a1a1a", textMuted: "#9ca3af", supportsColorMode: false },
  { value: "velvet-dusk", label: "Velvet Dusk", description: "Soft pastel tones on dark canvas", accent: "#cba6f7", bg: "#1e1e2e", surface: "#181825", textPrimary: "#cdd6f4", textMuted: "#7f849c", supportsColorMode: false },
  { value: "terminal", label: "Terminal", description: "Green phosphor CRT terminal", accent: "#4aef98", bg: "#000900", surface: "#001a05", textPrimary: "#4aef98", textMuted: "#4aef9859", supportsColorMode: false },
  { value: "sakura-blossom", label: "Sakura Blossom", description: "Warm cherry-blossom with rose accents", accent: "#e84393", bg: "#2b1a2e", surface: "#231525", textPrimary: "#fef0f5", textMuted: "#b08a9e", supportsColorMode: false },
  { value: "frosthearth", label: "Frosthearth", description: "Nordic frost meets warm tavern", accent: "#6eafc8", bg: "#1c1e1f", surface: "#161819", textPrimary: "#e8dcc8", textMuted: "#9a8f7c", supportsColorMode: false },
  { value: "night-city-neural", label: "Night City Neural", description: "Cyberpunk neon with cyan & magenta", accent: "#00e6ff", bg: "#0a0a12", surface: "#06060e", textPrimary: "#e0f7ff", textMuted: "#5a8a9e", supportsColorMode: false },
]

/* ─── Mock chat preview data ──────────────────────────── */
const MOCK_CHANNELS = ["general", "design", "random"]
const MOCK_MESSAGES = [
  { user: "Alex", avatar: "A", time: "2:41 PM", text: "Hey, has anyone tried the new theme yet?" },
  { user: "Jordan", avatar: "J", time: "2:42 PM", text: "Yeah it looks amazing! Really clean." },
  { user: "Sam", avatar: "S", time: "2:43 PM", text: "Love the accent color on this one." },
]

/* ─── Reusable UI helpers ──────────────────────────────── */

function SectionHeading({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
      {children}
    </h2>
  )
}

function SectionDivider(): React.ReactElement {
  return <hr className="border-0 h-px" style={{ background: "var(--theme-bg-tertiary)" }} />
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className="flex-1 py-2 rounded text-sm transition-all"
          style={{
            background: value === opt.value ? "var(--theme-accent)" : "var(--theme-bg-secondary)",
            color: value === opt.value ? "white" : "var(--theme-text-secondary)",
            border: `1px solid ${value === opt.value ? "var(--theme-accent)" : "var(--theme-bg-tertiary)"}`,
            fontWeight: value === opt.value ? 600 : 400,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function RadioGroup<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string
  options: { value: T; label: string; description: string }[]
  value: T
  onChange: (v: T) => void
}): React.ReactElement {
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <label
          key={opt.value}
          className="flex items-center justify-between px-4 py-3 rounded-lg cursor-pointer transition-all"
          style={{
            background: value === opt.value
              ? "color-mix(in srgb, var(--theme-accent) 12%, var(--theme-bg-secondary))"
              : "var(--theme-bg-secondary)",
            border: `1px solid ${value === opt.value ? "var(--theme-accent)" : "var(--theme-bg-tertiary)"}`,
          }}
        >
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>{opt.label}</p>
            <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{opt.description}</p>
          </div>
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="accent-[var(--theme-accent)]"
          />
        </label>
      ))}
    </div>
  )
}

function ToggleSwitch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.ReactElement {
  return (
    <label
      className="flex items-center justify-between px-4 py-3 rounded-lg cursor-pointer transition-all"
      style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
    >
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>{label}</p>
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative w-10 h-5 rounded-full transition-colors shrink-0"
        style={{ background: checked ? "var(--theme-accent)" : "var(--theme-bg-tertiary)" }}
      >
        <span
          className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }}
        />
      </button>
    </label>
  )
}

/* ─── Theme preview mini-chat ──────────────────────────── */
function ThemePreviewChat({ theme, useLiveTokens }: { theme: typeof THEME_PRESET_OPTIONS[number]; useLiveTokens?: boolean }): React.ReactElement {
  // When useLiveTokens is true (active theme), read from CSS custom properties
  // so custom CSS overrides and accent color changes are reflected in real time.
  const bg = useLiveTokens ? "var(--theme-bg-primary)" : theme.bg
  const surface = useLiveTokens ? "var(--theme-bg-secondary)" : theme.surface
  const accent = useLiveTokens ? "var(--theme-accent)" : theme.accent
  const textPrimary = useLiveTokens ? "var(--theme-text-primary)" : theme.textPrimary
  const textMuted = useLiveTokens ? "var(--theme-text-muted)" : theme.textMuted

  return (
    <div
      className="rounded-xl overflow-hidden border shadow-lg w-full"
      aria-hidden="true"
      style={{ background: bg, borderColor: useLiveTokens ? "var(--theme-bg-tertiary)" : `color-mix(in srgb, ${theme.textMuted} 20%, transparent)`, maxHeight: 320 }}
    >
      <div className="flex h-full" style={{ minHeight: 260 }}>
        <div className="w-[140px] shrink-0 p-2.5 space-y-1 hidden sm:block" style={{ background: surface }}>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-2 px-1" style={{ color: textMuted }}>Channels</div>
          {MOCK_CHANNELS.map((ch) => (
            <div key={ch} className="text-xs px-2 py-1 rounded" style={{ color: ch === "general" ? textPrimary : textMuted, background: ch === "general" ? (useLiveTokens ? "color-mix(in srgb, var(--theme-text-muted) 15%, transparent)" : `color-mix(in srgb, ${theme.textMuted} 15%, transparent)`) : "transparent", fontWeight: ch === "general" ? 600 : 400 }}>
              # {ch}
            </div>
          ))}
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-3 py-2 text-xs font-semibold border-b flex items-center gap-1.5" style={{ color: textPrimary, borderColor: useLiveTokens ? "var(--theme-bg-tertiary)" : `color-mix(in srgb, ${theme.textMuted} 12%, transparent)`, background: bg }}>
            <span style={{ color: textMuted }}>#</span> general
          </div>
          <div className="flex-1 px-3 py-2 space-y-2.5 overflow-hidden">
            {MOCK_MESSAGES.map((msg, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: useLiveTokens ? "color-mix(in srgb, var(--theme-accent) 30%, var(--theme-bg-secondary))" : `color-mix(in srgb, ${theme.accent} 30%, ${theme.surface})`, color: accent }}>{msg.avatar}</div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs font-semibold" style={{ color: accent }}>{msg.user}</span>
                    <span className="text-[10px]" style={{ color: textMuted }}>{msg.time}</span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: textPrimary }}>{msg.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 py-2">
            <div className="rounded-lg px-3 py-1.5 text-xs" style={{ background: surface, color: textMuted }}>Message #general</div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Scroll arrows for the theme strip ──────────────── */
function ScrollArrow({ direction, onClick }: { direction: "left" | "right"; onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden md:flex absolute top-1/2 -translate-y-1/2 z-10 w-8 h-8 items-center justify-center rounded-full transition-all opacity-80 hover:opacity-100 hover:scale-110"
      style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", [direction === "left" ? "left" : "right"]: -12, boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}
      aria-label={`Scroll ${direction}`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d={direction === "left" ? "M9 2L4 7L9 12" : "M5 2L10 7L5 12"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

/* ─── Main component ──────────────────────────────────── */
export function AppearanceSettingsPage(): React.ReactElement {
  const store = useAppearanceStore()
  useAutoSyncAppearance()
  const { toast } = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [customAccent, setCustomAccent] = useState(store.accentColorOverride)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [saving, setSaving] = useState(false)

  const activeTheme = THEME_PRESET_OPTIONS.find((t) => t.value === store.themePreset) ?? THEME_PRESET_OPTIONS[0]

  const updateScrollState = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    updateScrollState()
    const el = scrollRef.current
    if (!el) return
    const resizeObserver = new ResizeObserver(updateScrollState)
    resizeObserver.observe(el)
    return (): void => { resizeObserver.disconnect() }
  }, [updateScrollState])

  const scroll = useCallback((direction: "left" | "right"): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: direction === "left" ? -200 : 200, behavior: "smooth" })
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>): void => {
    const el = scrollRef.current
    if (!el) return
    if (e.deltaY === 0) return
    e.preventDefault()
    el.scrollLeft += e.deltaY
    updateScrollState()
  }, [updateScrollState])

  const handleAccentInput = useCallback((raw: string): void => {
    setCustomAccent(raw)
    const trimmed = raw.trim()
    if (trimmed === "") {
      store.setAccentColorOverride("")
    } else if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      store.setAccentColorOverride(trimmed)
    }
  }, [store])

  // Keep local input in sync with store changes (e.g. reset, theme switch)
  useEffect(() => {
    setCustomAccent(store.accentColorOverride ?? "")
  }, [store.accentColorOverride])

  const handleResetDefaults = useCallback((): void => {
    store.resetToDefaults()
    setCustomAccent("")
    setShowResetConfirm(false)
  }, [store])

  const handleSave = useCallback(async (): Promise<void> => {
    if (!store.syncToAccount) {
      // Settings are already persisted to localStorage via Zustand
      toast({ title: "Appearance saved!" })
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/users/appearance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance_settings: store.toSettingsPayload() }),
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
  }, [store, toast])

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
          Appearance
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--theme-text-muted)" }}>
          Customize how VortexChat looks and feels for you.
        </p>
      </div>

      {/* ── Theme Selector ──────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading>Theme</SectionHeading>
        <ThemePreviewChat theme={activeTheme} useLiveTokens />
        <div className="text-center">
          <p className="text-base font-semibold" style={{ color: "var(--theme-text-bright)" }}>{activeTheme.label}</p>
          <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{activeTheme.description}</p>
        </div>

        {/* Scrollable theme strip */}
        <div className="relative">
          {canScrollLeft && <ScrollArrow direction="left" onClick={() => scroll("left")} />}
          {canScrollRight && <ScrollArrow direction="right" onClick={() => scroll("right")} />}
          <div
            ref={scrollRef}
            onScroll={updateScrollState}
            onWheel={handleWheel}
            className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin"
            style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", scrollbarWidth: "thin", scrollbarColor: "var(--theme-bg-tertiary) transparent" }}
          >
            {THEME_PRESET_OPTIONS.map((theme) => {
              const isActive = store.themePreset === theme.value
              return (
                <button
                  key={theme.value}
                  type="button"
                  aria-pressed={isActive}
                  aria-label={theme.label}
                  onClick={() => store.setThemePreset(theme.value)}
                  className="relative shrink-0 rounded-lg overflow-hidden transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 group"
                  style={{ width: 100, height: 72, scrollSnapAlign: "start", border: `2.5px solid ${isActive ? theme.accent : "transparent"}`, boxShadow: isActive ? `0 0 12px ${theme.accent}40` : "0 1px 4px rgba(0,0,0,0.2)", transform: isActive ? "scale(1.05)" : "scale(1)" }}
                >
                  <div className="w-full h-full flex" style={{ background: theme.bg }}>
                    <div className="w-[28%] h-full" style={{ background: theme.surface }}>
                      <div className="mt-2 mx-1 space-y-1">
                        <div className="h-1 w-full rounded-full opacity-40" style={{ background: theme.textMuted }} />
                        <div className="h-1 w-3/4 rounded-full opacity-25" style={{ background: theme.textMuted }} />
                        <div className="h-1 w-full rounded-full opacity-25" style={{ background: theme.textMuted }} />
                      </div>
                    </div>
                    <div className="flex-1 p-1.5 flex flex-col justify-between">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ background: theme.accent }} /><div className="h-1 flex-1 rounded-full opacity-40" style={{ background: theme.textPrimary }} /></div>
                        <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full opacity-60" style={{ background: theme.accent }} /><div className="h-1 w-3/4 rounded-full opacity-30" style={{ background: theme.textPrimary }} /></div>
                        <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full opacity-40" style={{ background: theme.accent }} /><div className="h-1 w-1/2 rounded-full opacity-20" style={{ background: theme.textPrimary }} /></div>
                      </div>
                      <div className="h-2 rounded-sm" style={{ background: theme.surface }} />
                    </div>
                  </div>
                  {isActive && (
                    <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: theme.accent }}>
                      <svg width="8" height="6" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 text-[9px] font-semibold text-center py-0.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" style={{ background: `linear-gradient(transparent, ${theme.bg}ee)`, color: theme.textPrimary }}>
                    {theme.label}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* ── Color Mode ──────────────────────────────────── */}
      {activeTheme.supportsColorMode && (
        <>
          <section className="space-y-3">
            <SectionHeading>Color Mode</SectionHeading>
            <RadioGroup name="colorMode" options={COLOR_MODE_OPTIONS} value={store.colorMode} onChange={store.setColorMode} />
          </section>

          <SectionDivider />
        </>
      )}

      {/* ── Accent Color ────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading>Accent Color</SectionHeading>
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          Override the theme&apos;s accent color with your own. Leave empty to use theme default.
        </p>
        <div className="flex flex-wrap gap-2">
          {ACCENT_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Accent color ${color}`}
              aria-pressed={store.accentColorOverride === color}
              onClick={() => {
                const next = store.accentColorOverride === color ? "" : color
                store.setAccentColorOverride(next)
                setCustomAccent(next)
              }}
              className="w-8 h-8 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2"
              style={{
                background: color,
                boxShadow: store.accentColorOverride === color ? `0 0 0 3px var(--theme-bg-primary), 0 0 0 5px ${color}` : "0 1px 3px rgba(0,0,0,0.3)",
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded border shrink-0"
            style={{ background: store.accentColorOverride || "var(--theme-accent)", borderColor: "var(--theme-bg-tertiary)" }}
          />
          <input
            type="text"
            placeholder="#a78bfa"
            value={customAccent}
            onChange={(e) => handleAccentInput(e.target.value)}
            className="flex-1 px-3 py-1.5 rounded text-sm"
            style={{ background: "var(--theme-bg-secondary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }}
            maxLength={7}
          />
          {store.accentColorOverride && (
            <button
              type="button"
              onClick={() => { store.setAccentColorOverride(""); setCustomAccent("") }}
              className="text-xs px-2 py-1.5 rounded transition-colors"
              style={{ color: "var(--theme-text-muted)", background: "var(--theme-bg-secondary)" }}
            >
              Clear
            </button>
          )}
        </div>
      </section>

      <SectionDivider />

      {/* ── Chat Layout ─────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading>Chat Layout</SectionHeading>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--theme-text-secondary)" }}>Message Display</p>
            <RadioGroup name="messageDisplay" options={MESSAGE_DISPLAY_OPTIONS} value={store.messageDisplay} onChange={store.setMessageDisplay} />
          </div>
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--theme-text-secondary)" }}>Chat Style</p>
            <RadioGroup name="chatBubbleStyle" options={CHAT_BUBBLE_STYLE_OPTIONS} value={store.chatBubbleStyle} onChange={store.setChatBubbleStyle} />
          </div>
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--theme-text-secondary)" }}>Message Grouping</p>
            <RadioGroup name="messageGrouping" options={MESSAGE_GROUPING_OPTIONS} value={store.messageGrouping} onChange={store.setMessageGrouping} />
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* ── Typography ──────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading>Typography</SectionHeading>
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--theme-text-secondary)" }}>Font Family</p>
          <RadioGroup name="fontFamily" options={FONT_FAMILY_OPTIONS} value={store.fontFamily} onChange={store.setFontFamily} />
        </div>
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--theme-text-secondary)" }}>Font Size</p>
          <SegmentedControl options={FONT_SCALE_OPTIONS} value={store.fontScale} onChange={store.setFontScale} />
        </div>
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--theme-text-secondary)" }}>Line Spacing</p>
          <SegmentedControl options={LINE_HEIGHT_OPTIONS} value={store.lineHeight} onChange={store.setLineHeight} />
        </div>
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--theme-text-secondary)" }}>Code Block Font</p>
          <SegmentedControl options={CODE_FONT_OPTIONS} value={store.codeFont} onChange={store.setCodeFont} />
        </div>
      </section>

      <SectionDivider />

      {/* ── Timestamp & Emoji ───────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading>Display</SectionHeading>
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--theme-text-secondary)" }}>Timestamp Format</p>
          <div className="flex items-center gap-2">
            {TIMESTAMP_FORMAT_OPTIONS.map(({ value, label, example }) => (
              <button
                key={value}
                type="button"
                aria-pressed={store.timestampFormat === value}
                onClick={() => store.setTimestampFormat(value)}
                className="flex-1 py-2.5 rounded text-sm transition-all"
                style={{
                  background: store.timestampFormat === value ? "var(--theme-accent)" : "var(--theme-bg-secondary)",
                  color: store.timestampFormat === value ? "white" : "var(--theme-text-secondary)",
                  border: `1px solid ${store.timestampFormat === value ? "var(--theme-accent)" : "var(--theme-bg-tertiary)"}`,
                  fontWeight: store.timestampFormat === value ? 600 : 400,
                }}
              >
                <span>{label}</span>
                <span className="block text-xs opacity-70 mt-0.5">{example}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--theme-text-secondary)" }}>Emoji Size (emoji-only messages)</p>
          <SegmentedControl options={EMOJI_SIZE_OPTIONS} value={store.emojiSize} onChange={store.setEmojiSize} />
        </div>
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--theme-text-secondary)" }}>Notification Badge</p>
          <RadioGroup name="notificationBadgeStyle" options={NOTIFICATION_BADGE_OPTIONS} value={store.notificationBadgeStyle} onChange={store.setNotificationBadgeStyle} />
        </div>
      </section>

      <SectionDivider />

      {/* ── Media & Embeds ──────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading>Media &amp; Embeds</SectionHeading>
        <div className="space-y-2">
          <ToggleSwitch
            label="Auto-expand images"
            description="Show image attachments inline automatically"
            checked={store.imagePreviews}
            onChange={store.setImagePreviews}
          />
          <ToggleSwitch
            label="Show link previews"
            description="Display rich previews for shared links"
            checked={store.linkPreviews}
            onChange={store.setLinkPreviews}
          />
          <ToggleSwitch
            label="Autoplay GIFs"
            description="Animate GIFs automatically or show on hover"
            checked={store.gifAutoplay}
            onChange={store.setGifAutoplay}
          />
        </div>
      </section>

      <SectionDivider />

      {/* ── Advanced ────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading>Advanced</SectionHeading>
        <ToggleSwitch
          label="Sync settings to account"
          description="Save appearance settings to your account so they apply on all devices"
          checked={store.syncToAccount}
          onChange={store.setSyncToAccount}
        />
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          For advanced customization, use Custom CSS in Profile → Appearance.
        </p>
      </section>

      <SectionDivider />

      {/* ── Reset ───────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading>Reset</SectionHeading>
        {showResetConfirm ? (
          <div
            className="flex items-center justify-between px-4 py-3 rounded-lg"
            style={{ background: "color-mix(in srgb, var(--theme-danger) 10%, var(--theme-bg-secondary))", border: "1px solid var(--theme-danger)" }}
          >
            <p className="text-sm" style={{ color: "var(--theme-text-primary)" }}>Reset all appearance settings to defaults?</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 rounded text-xs transition-colors"
                style={{ color: "var(--theme-text-secondary)", background: "var(--theme-bg-tertiary)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetDefaults}
                className="px-3 py-1.5 rounded text-xs font-semibold transition-colors"
                style={{ background: "var(--theme-danger)", color: "var(--theme-danger-foreground)" }}
              >
                Reset
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="px-4 py-2 rounded-lg text-sm transition-colors"
            style={{ background: "var(--theme-bg-secondary)", color: "var(--theme-text-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
          >
            Reset to defaults
          </button>
        )}
      </section>

      {/* ── Save ──────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2 pb-4">
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          {store.syncToAccount
            ? "Settings are synced to your account and apply across devices."
            : "Settings are saved to your browser and apply immediately."}
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 rounded-md font-semibold text-sm transition-all hover:brightness-110 disabled:opacity-60 shrink-0 ml-4"
          style={{ background: "var(--theme-accent)", color: "white" }}
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  )
}
