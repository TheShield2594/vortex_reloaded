"use client"

import { useState } from "react"
import { Palette, Check, Loader2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/components/ui/use-toast"
import { DM_THEME_PRESET_OPTIONS } from "@/lib/dm-theme-options"
import type { DmThemePreset } from "@/lib/dm-theme"

interface ConversationThemePickerProps {
  channelId: string
  /** Current conversation theme, or null/undefined if none is set (falls back to the viewer's own theme). */
  themePreset: string | null | undefined
  /** Called optimistically with the new value once the server confirms the change. */
  onThemeChange: (themePreset: DmThemePreset | null) => void
}

/** Small header control to set (or clear) this conversation's shared theme preset. */
export function ConversationThemePicker({ channelId, themePreset, onThemeChange }: ConversationThemePickerProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  async function applyTheme(next: DmThemePreset | null): Promise<void> {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/dm/channels/${channelId}/theme`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme_preset: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Failed to update conversation theme")
      }
      onThemeChange(next)
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Couldn't update conversation theme",
        description: error instanceof Error ? error.message : "Unknown error",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-md hover:bg-white/10 active:bg-white/15 transition-colors disabled:opacity-50"
          style={{ color: "var(--theme-text-secondary)" }}
          title="Conversation theme"
          aria-label="Set conversation theme"
          disabled={saving}
        >
          {saving ? <Loader2 className="w-4 h-4 md:w-[18px] md:h-[18px] animate-spin" /> : <Palette className="w-4 h-4 md:w-[18px] md:h-[18px]" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
        <DropdownMenuLabel>Conversation theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => applyTheme(null)} className="flex items-center justify-between gap-2">
          <span>Match my own theme</span>
          {!themePreset && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {DM_THEME_PRESET_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => applyTheme(option.value)}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: option.accent }}
                aria-hidden="true"
              />
              {option.label}
            </span>
            {themePreset === option.value && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
