"use client"

import { useEffect, useRef, type MutableRefObject, type RefObject } from "react"
import { RotateCcw } from "lucide-react"
import { useVoiceAudioStore } from "@/lib/stores/voice-audio-store"
import type { AudioPreset } from "@/lib/voice/audio-settings"
import type { EqTrackProcessor } from "@/lib/voice/eq-track-processor"

const PRESET_OPTIONS: { value: AudioPreset; label: string }[] = [
  { value: "voice-clarity", label: "Voice Clarity" },
  { value: "bass-boost", label: "Bass Boost" },
  { value: "broadcast", label: "Broadcast" },
  { value: "flat", label: "Flat / Custom" },
]

interface EqSettingsPanelProps {
  userId: string
  onClose: () => void
  anchorRef: RefObject<HTMLButtonElement | null>
  /** Live LiveKit track processor for the current call, if connected — used to push changes into the audio graph immediately. */
  processorRef: MutableRefObject<EqTrackProcessor | null>
}

/** Popover anchored to the in-call settings button — lets a user tune EQ/presets/gain live during a call. */
export function EqSettingsPanel({ userId, onClose, anchorRef, processorRef }: EqSettingsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const settings = useVoiceAudioStore((state) => state.getEffectiveSettings(userId))
  const applyPreset = useVoiceAudioStore((state) => state.applyPreset)
  const setEqBandGain = useVoiceAudioStore((state) => state.setEqBandGain)
  const setProfileSettings = useVoiceAudioStore((state) => state.setProfileSettings)
  const resetSettings = useVoiceAudioStore((state) => state.resetSettings)

  // updateSettings() tweaks the existing AudioParams in place, so it's cheap enough
  // to call on every drag — push every store change straight into the live graph.
  useEffect(() => {
    processorRef.current?.updateSettings(settings)
  }, [settings, processorRef])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose, anchorRef])

  function setGain(field: "inputGain" | "outputGain", value: number) {
    setProfileSettings(userId, { ...settings, [field]: value, preset: "flat" })
  }

  function setBypass(field: "bypassProcessing" | "bypassOnCpuConstraint", value: boolean) {
    setProfileSettings(userId, { ...settings, [field]: value })
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Voice audio settings"
      className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-[340px] rounded-xl shadow-2xl p-4 space-y-4 z-50 text-left"
      style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold" style={{ color: "var(--theme-text-primary)" }}>
          Voice Settings
        </p>
        <button
          onClick={() => resetSettings(userId)}
          className="text-xs flex items-center gap-1 hover:underline"
          style={{ color: "var(--theme-text-muted)" }}
        >
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium" style={{ color: "var(--theme-text-muted)" }}>
          Preset
        </label>
        <select
          value={settings.preset}
          onChange={(event) => applyPreset(userId, event.target.value as AudioPreset)}
          className="w-full rounded-md px-2 py-1.5 text-sm"
          style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }}
        >
          {PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium flex justify-between" style={{ color: "var(--theme-text-muted)" }}>
          <span>Microphone gain</span>
          <span>{settings.inputGain.toFixed(2)}x</span>
        </label>
        <input
          type="range"
          min={0.2}
          max={2}
          step={0.05}
          value={settings.inputGain}
          onChange={(event) => setGain("inputGain", Number(event.target.value))}
          className="w-full"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium flex justify-between" style={{ color: "var(--theme-text-muted)" }}>
          <span>Output gain</span>
          <span>{settings.outputGain.toFixed(2)}x</span>
        </label>
        <input
          type="range"
          min={0.2}
          max={2}
          step={0.05}
          value={settings.outputGain}
          onChange={(event) => setGain("outputGain", Number(event.target.value))}
          className="w-full"
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium" style={{ color: "var(--theme-text-muted)" }}>
          EQ (6 bands)
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {settings.eqBands.map((band, index) => (
            <div key={band.frequency} className="space-y-1">
              <div className="flex justify-between text-[10px]" style={{ color: "var(--theme-text-muted)" }}>
                <span>{band.frequency >= 1000 ? `${band.frequency / 1000}kHz` : `${band.frequency}Hz`}</span>
                <span>{band.gain > 0 ? `+${band.gain}` : band.gain}dB</span>
              </div>
              <input
                type="range"
                min={-12}
                max={12}
                step={0.5}
                value={band.gain}
                onChange={(event) => setEqBandGain(userId, index, Number(event.target.value))}
                className="w-full"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2 pt-1" style={{ borderTop: "1px solid var(--theme-bg-tertiary)" }}>
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--theme-text-secondary)" }}>
          <input
            type="checkbox"
            checked={settings.bypassProcessing}
            onChange={(event) => setBypass("bypassProcessing", event.target.checked)}
          />
          Bypass processing (raw mic)
        </label>
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--theme-text-secondary)" }}>
          <input
            type="checkbox"
            checked={settings.bypassOnCpuConstraint}
            onChange={(event) => setBypass("bypassOnCpuConstraint", event.target.checked)}
          />
          Auto-bypass on CPU constraint
        </label>
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--theme-text-secondary)" }}>
          <input
            type="checkbox"
            checked={settings.spatialAudioEnabled}
            onChange={(event) => setProfileSettings(userId, { ...settings, spatialAudioEnabled: event.target.checked })}
          />
          Spatial audio in group calls (per-speaker volume/pan)
        </label>
      </div>

      <p className="text-[10px]" style={{ color: "var(--theme-text-faint)" }}>
        Changes apply live and are saved to your profile for future calls.
      </p>
    </div>
  )
}
