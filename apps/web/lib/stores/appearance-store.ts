"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

export type MessageDisplay = "cozy" | "compact"
export type FontScale = "small" | "normal" | "large"
export type Saturation = "normal" | "reduced"
export type ThemePreset = "twilight" | "midnight-neon" | "synthwave" | "carbon" | "oled-black" | "frost" | "clarity" | "velvet-dusk" | "terminal" | "sakura-blossom" | "frosthearth" | "night-city-neural"
export type ReducedMotion = "system" | "on" | "off"
export type TimestampFormat = "12h" | "24h"
export type FontFamily = "system" | "inter" | "mono" | "dyslexia"
export type LineHeight = "tight" | "normal" | "relaxed"
export type CodeFont = "default" | "fira-code" | "jetbrains-mono" | "cascadia"
export type ColorMode = "system" | "dark" | "light"
export type ChatBubbleStyle = "flat" | "bubble"
export type MessageGrouping = "5min" | "10min" | "never"
export type EmojiSize = "small" | "normal" | "large"
export type NotificationBadgeStyle = "dot" | "count"
export type FocusIndicator = "default" | "high-contrast" | "outline"

export interface AppearanceSettings {
  messageDisplay?: MessageDisplay
  fontScale?: FontScale
  saturation?: Saturation
  themePreset?: ThemePreset
  reducedMotion?: ReducedMotion
  timestampFormat?: TimestampFormat
  customCss?: string
  fontFamily?: FontFamily
  lineHeight?: LineHeight
  codeFont?: CodeFont
  colorMode?: ColorMode
  chatBubbleStyle?: ChatBubbleStyle
  messageGrouping?: MessageGrouping
  emojiSize?: EmojiSize
  accentColorOverride?: string
  highContrast?: boolean
  gifAutoplay?: boolean
  linkPreviews?: boolean
  imagePreviews?: boolean
  notificationBadgeStyle?: NotificationBadgeStyle
  focusIndicator?: FocusIndicator
  syncToAccount?: boolean
}

interface AppearanceState {
  messageDisplay: MessageDisplay
  fontScale: FontScale
  saturation: Saturation
  themePreset: ThemePreset
  reducedMotion: ReducedMotion
  timestampFormat: TimestampFormat
  customCss: string
  fontFamily: FontFamily
  lineHeight: LineHeight
  codeFont: CodeFont
  colorMode: ColorMode
  chatBubbleStyle: ChatBubbleStyle
  messageGrouping: MessageGrouping
  emojiSize: EmojiSize
  accentColorOverride: string
  highContrast: boolean
  gifAutoplay: boolean
  linkPreviews: boolean
  imagePreviews: boolean
  notificationBadgeStyle: NotificationBadgeStyle
  focusIndicator: FocusIndicator
  syncToAccount: boolean
  previousFontFamily: FontFamily | null
  hasHydratedFromProfile: boolean
  lastHydratedUserId: string | null
  setMessageDisplay: (v: MessageDisplay) => void
  setFontScale: (v: FontScale) => void
  setSaturation: (v: Saturation) => void
  setThemePreset: (v: ThemePreset) => void
  setReducedMotion: (v: ReducedMotion) => void
  setTimestampFormat: (v: TimestampFormat) => void
  setCustomCss: (v: string) => void
  setFontFamily: (v: FontFamily) => void
  setLineHeight: (v: LineHeight) => void
  setCodeFont: (v: CodeFont) => void
  setColorMode: (v: ColorMode) => void
  setChatBubbleStyle: (v: ChatBubbleStyle) => void
  setMessageGrouping: (v: MessageGrouping) => void
  setEmojiSize: (v: EmojiSize) => void
  setAccentColorOverride: (v: string) => void
  setHighContrast: (v: boolean) => void
  setGifAutoplay: (v: boolean) => void
  setLinkPreviews: (v: boolean) => void
  setImagePreviews: (v: boolean) => void
  setNotificationBadgeStyle: (v: NotificationBadgeStyle) => void
  setFocusIndicator: (v: FocusIndicator) => void
  setSyncToAccount: (v: boolean) => void
  resetToDefaults: () => void
  hydrateFromSettings: (settings?: AppearanceSettings | null, userId?: string | null) => void
  toSettingsPayload: () => Omit<Required<AppearanceSettings>, "syncToAccount">
}

const DEFAULTS: Required<AppearanceSettings> = {
  messageDisplay: "cozy",
  fontScale: "normal",
  saturation: "normal",
  themePreset: "twilight",
  reducedMotion: "system",
  timestampFormat: "12h",
  customCss: "",
  fontFamily: "system",
  lineHeight: "normal",
  codeFont: "default",
  colorMode: "dark",
  chatBubbleStyle: "flat",
  messageGrouping: "5min",
  emojiSize: "normal",
  accentColorOverride: "",
  highContrast: false,
  gifAutoplay: true,
  linkPreviews: true,
  imagePreviews: true,
  notificationBadgeStyle: "count",
  focusIndicator: "default",
  syncToAccount: false,
}

const THEME_PRESETS: ThemePreset[] = ["twilight", "midnight-neon", "synthwave", "carbon", "oled-black", "frost", "clarity", "velvet-dusk", "terminal", "sakura-blossom", "frosthearth", "night-city-neural"]
const MESSAGE_DISPLAY_MODES: MessageDisplay[] = ["cozy", "compact"]
const FONT_SCALES: FontScale[] = ["small", "normal", "large"]
const SATURATION_LEVELS: Saturation[] = ["normal", "reduced"]
const REDUCED_MOTION_MODES: ReducedMotion[] = ["system", "on", "off"]
const TIMESTAMP_FORMATS: TimestampFormat[] = ["12h", "24h"]
const FONT_FAMILIES: FontFamily[] = ["system", "inter", "mono", "dyslexia"]
const LINE_HEIGHTS: LineHeight[] = ["tight", "normal", "relaxed"]
const CODE_FONTS: CodeFont[] = ["default", "fira-code", "jetbrains-mono", "cascadia"]
const COLOR_MODES: ColorMode[] = ["system", "dark", "light"]
const CHAT_BUBBLE_STYLES: ChatBubbleStyle[] = ["flat", "bubble"]
const MESSAGE_GROUPINGS: MessageGrouping[] = ["5min", "10min", "never"]
const EMOJI_SIZES: EmojiSize[] = ["small", "normal", "large"]
const NOTIFICATION_BADGE_STYLES: NotificationBadgeStyle[] = ["dot", "count"]
const FOCUS_INDICATORS: FocusIndicator[] = ["default", "high-contrast", "outline"]

function sanitizeCustomCss(value: unknown): string {
  if (typeof value !== "string") return ""
  return value
    // Block expression() – IE/legacy XSS vector
    .replace(/expression\s*\(/gi, "/* blocked:expression */(")
    // Block -moz-binding – old Firefox XSS vector
    .replace(/-moz-binding\s*:/gi, "/* blocked */:")
    // Block behavior: – IE XSS vector
    .replace(/behavior\s*:/gi, "/* blocked */:")
    // Block javascript: URLs inside url()
    .replace(/url\s*\(\s*(['"]?)javascript:/gi, "url($1data:text/plain,blocked")
    // Block data: URLs for non-image/font types (e.g. data:text/html XSS)
    .replace(/url\s*\(\s*(['"]?)data:(?!image\/|font\/|application\/font|application\/x-font)/gi, "url($1data:text/plain,blocked")
    .slice(0, 50000)
}

function sanitizeAccentColor(value: unknown): string {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (trimmed === "") return ""
  // Only allow valid hex colors
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed
  return ""
}

function validateEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function validateBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      previousFontFamily: null,
      hasHydratedFromProfile: false,
      lastHydratedUserId: null,
      setMessageDisplay: (v) => set({ messageDisplay: v }),
      setFontScale: (v) => set({ fontScale: v }),
      setSaturation: (v) => set({ saturation: v }),
      setThemePreset: (v) => set({ themePreset: v }),
      setReducedMotion: (v) => set({ reducedMotion: v }),
      setTimestampFormat: (v) => set({ timestampFormat: v }),
      setCustomCss: (v) => set({ customCss: sanitizeCustomCss(v) }),
      setFontFamily: (v) => {
        const current = get().fontFamily
        const updates: Partial<AppearanceState> = { fontFamily: v }
        // Save previous non-dyslexia font so we can restore it when dyslexia mode is toggled off
        if (v === "dyslexia" && current !== "dyslexia") {
          updates.previousFontFamily = current
        }
        set(updates)
      },
      setLineHeight: (v) => set({ lineHeight: v }),
      setCodeFont: (v) => set({ codeFont: v }),
      setColorMode: (v) => set({ colorMode: v }),
      setChatBubbleStyle: (v) => set({ chatBubbleStyle: v }),
      setMessageGrouping: (v) => set({ messageGrouping: v }),
      setEmojiSize: (v) => set({ emojiSize: v }),
      setAccentColorOverride: (v) => set({ accentColorOverride: sanitizeAccentColor(v) }),
      setHighContrast: (v) => set({ highContrast: v }),
      setGifAutoplay: (v) => set({ gifAutoplay: v }),
      setLinkPreviews: (v) => set({ linkPreviews: v }),
      setImagePreviews: (v) => set({ imagePreviews: v }),
      setNotificationBadgeStyle: (v) => set({ notificationBadgeStyle: v }),
      setFocusIndicator: (v) => set({ focusIndicator: v }),
      setSyncToAccount: (v) => set({ syncToAccount: v }),
      resetToDefaults: () => set({ ...DEFAULTS }),
      hydrateFromSettings: (settings, userId = null) => {
        const state = get()
        if (state.hasHydratedFromProfile && state.lastHydratedUserId === userId) return

        // When sync-to-account is disabled, local browser state is the
        // source of truth — don't overwrite it with (potentially stale)
        // database settings.
        if (!state.syncToAccount) {
          set({ hasHydratedFromProfile: true, lastHydratedUserId: userId })
          return
        }

        // If settings is null/undefined/empty, mark as hydrated but don't
        // clobber existing local preferences with defaults.
        if (!settings || Object.keys(settings).length === 0) {
          set({ hasHydratedFromProfile: true, lastHydratedUserId: userId })
          return
        }

        // Only merge keys that are explicitly present in the incoming settings
        // object. Missing keys preserve the current local browser values.
        const updates: Partial<AppearanceState> = {
          hasHydratedFromProfile: true,
          lastHydratedUserId: userId,
        }
        if (settings.themePreset !== undefined) updates.themePreset = validateEnum(settings.themePreset, THEME_PRESETS, state.themePreset)
        if (settings.messageDisplay !== undefined) updates.messageDisplay = validateEnum(settings.messageDisplay, MESSAGE_DISPLAY_MODES, state.messageDisplay)
        if (settings.fontScale !== undefined) updates.fontScale = validateEnum(settings.fontScale, FONT_SCALES, state.fontScale)
        if (settings.saturation !== undefined) updates.saturation = validateEnum(settings.saturation, SATURATION_LEVELS, state.saturation)
        if (settings.reducedMotion !== undefined) updates.reducedMotion = validateEnum(settings.reducedMotion, REDUCED_MOTION_MODES, state.reducedMotion)
        if (settings.timestampFormat !== undefined) updates.timestampFormat = validateEnum(settings.timestampFormat, TIMESTAMP_FORMATS, state.timestampFormat)
        if (settings.fontFamily !== undefined) updates.fontFamily = validateEnum(settings.fontFamily, FONT_FAMILIES, state.fontFamily)
        if (settings.lineHeight !== undefined) updates.lineHeight = validateEnum(settings.lineHeight, LINE_HEIGHTS, state.lineHeight)
        if (settings.codeFont !== undefined) updates.codeFont = validateEnum(settings.codeFont, CODE_FONTS, state.codeFont)
        if (settings.colorMode !== undefined) updates.colorMode = validateEnum(settings.colorMode, COLOR_MODES, state.colorMode)
        if (settings.chatBubbleStyle !== undefined) updates.chatBubbleStyle = validateEnum(settings.chatBubbleStyle, CHAT_BUBBLE_STYLES, state.chatBubbleStyle)
        if (settings.messageGrouping !== undefined) updates.messageGrouping = validateEnum(settings.messageGrouping, MESSAGE_GROUPINGS, state.messageGrouping)
        if (settings.emojiSize !== undefined) updates.emojiSize = validateEnum(settings.emojiSize, EMOJI_SIZES, state.emojiSize)
        if (settings.notificationBadgeStyle !== undefined) updates.notificationBadgeStyle = validateEnum(settings.notificationBadgeStyle, NOTIFICATION_BADGE_STYLES, state.notificationBadgeStyle)
        if (settings.focusIndicator !== undefined) updates.focusIndicator = validateEnum(settings.focusIndicator, FOCUS_INDICATORS, state.focusIndicator)
        if (settings.accentColorOverride !== undefined) updates.accentColorOverride = sanitizeAccentColor(settings.accentColorOverride)
        if (settings.highContrast !== undefined) updates.highContrast = validateBool(settings.highContrast, state.highContrast)
        if (settings.gifAutoplay !== undefined) updates.gifAutoplay = validateBool(settings.gifAutoplay, state.gifAutoplay)
        if (settings.linkPreviews !== undefined) updates.linkPreviews = validateBool(settings.linkPreviews, state.linkPreviews)
        if (settings.imagePreviews !== undefined) updates.imagePreviews = validateBool(settings.imagePreviews, state.imagePreviews)
        if (settings.syncToAccount !== undefined) updates.syncToAccount = validateBool(settings.syncToAccount, state.syncToAccount)
        if (settings.customCss !== undefined) updates.customCss = sanitizeCustomCss(settings.customCss)

        set(updates)
      },
      toSettingsPayload: () => {
        const s = get()
        return {
          messageDisplay: s.messageDisplay,
          fontScale: s.fontScale,
          saturation: s.saturation,
          themePreset: s.themePreset,
          reducedMotion: s.reducedMotion,
          timestampFormat: s.timestampFormat,
          customCss: sanitizeCustomCss(s.customCss),
          fontFamily: s.fontFamily,
          lineHeight: s.lineHeight,
          codeFont: s.codeFont,
          colorMode: s.colorMode,
          chatBubbleStyle: s.chatBubbleStyle,
          messageGrouping: s.messageGrouping,
          emojiSize: s.emojiSize,
          accentColorOverride: sanitizeAccentColor(s.accentColorOverride),
          highContrast: s.highContrast,
          gifAutoplay: s.gifAutoplay,
          linkPreviews: s.linkPreviews,
          imagePreviews: s.imagePreviews,
          notificationBadgeStyle: s.notificationBadgeStyle,
          focusIndicator: s.focusIndicator,
        }
      },
    }),
    {
      name: "vortex:appearance",
      partialize: (state) => ({
        messageDisplay: state.messageDisplay,
        fontScale: state.fontScale,
        saturation: state.saturation,
        themePreset: state.themePreset,
        reducedMotion: state.reducedMotion,
        timestampFormat: state.timestampFormat,
        customCss: state.customCss,
        fontFamily: state.fontFamily,
        lineHeight: state.lineHeight,
        codeFont: state.codeFont,
        colorMode: state.colorMode,
        chatBubbleStyle: state.chatBubbleStyle,
        messageGrouping: state.messageGrouping,
        emojiSize: state.emojiSize,
        accentColorOverride: state.accentColorOverride,
        highContrast: state.highContrast,
        gifAutoplay: state.gifAutoplay,
        linkPreviews: state.linkPreviews,
        imagePreviews: state.imagePreviews,
        notificationBadgeStyle: state.notificationBadgeStyle,
        focusIndicator: state.focusIndicator,
        syncToAccount: state.syncToAccount,
        previousFontFamily: state.previousFontFamily,
      }),
    }
  )
)
