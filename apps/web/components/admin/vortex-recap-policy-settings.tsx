"use client"

// Admin settings panel for configuring voice intelligence per server.
// Renders inside the server settings area. All writes go through
// PATCH /api/servers/{serverId}/voice-intelligence-policy (owner-only).

import { useState, useEffect, useCallback } from "react"
import { Loader2, Save } from "lucide-react"
import type { EffectiveVoicePolicy } from "@/types/vortex-recap"

interface VortexRecapPolicySettingsProps {
  serverId: string
}

const RETENTION_PRESETS = [
  { label: "Short (7 days)", value: 7 },
  { label: "Standard (30 days)", value: 30 },
  { label: "Extended (90 days)", value: 90 },
]

export function VortexRecapPolicySettings({ serverId }: VortexRecapPolicySettingsProps) {
  const [policy, setPolicy] = useState<EffectiveVoicePolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchPolicy = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/voice-intelligence-policy`)
      if (res.ok) {
        const data = (await res.json()) as EffectiveVoicePolicy
        setPolicy(data)
      }
    } catch {
      setError("Failed to load policy")
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    fetchPolicy()
  }, [fetchPolicy])

  async function handleSave() {
    if (!policy) return
    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/servers/${serverId}/voice-intelligence-policy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcriptionEnabled: policy.transcriptionEnabled,
          requireExplicitConsent: policy.requireExplicitConsent,
          translationEnabled: policy.translationEnabled,
          summaryEnabled: policy.summaryEnabled,
          retentionDays: policy.retentionDays,
        }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? "Save failed")
      }

      setSavedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4" style={{ color: "var(--theme-text-secondary)" }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading policy…
      </div>
    )
  }

  if (!policy) {
    return (
      <p className="text-sm" style={{ color: "var(--theme-danger)" }}>
        Failed to load voice intelligence policy.
      </p>
    )
  }

  function update<K extends keyof EffectiveVoicePolicy>(key: K, value: EffectiveVoicePolicy[K]) {
    setPolicy((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-white font-semibold text-base">Vortex Recap</h3>
        <p className="text-sm mt-1" style={{ color: "var(--theme-text-secondary)" }}>
          Control live transcription, subtitles, and post-call summaries for this server.
        </p>
      </div>

      {/* Transcription */}
      <ToggleRow
        label="Allow Transcription"
        description="Participants who opt in will have their speech transcribed in real time."
        checked={policy.transcriptionEnabled}
        onChange={(v) => update("transcriptionEnabled", v)}
      />

      {/* Explicit consent */}
      <ToggleRow
        label="Require Explicit Consent"
        description="Show a consent modal when participants join. If disabled, transcription starts automatically for opted-in users."
        checked={policy.requireExplicitConsent}
        onChange={(v) => update("requireExplicitConsent", v)}
        disabled={!policy.transcriptionEnabled}
      />

      {/* Translation */}
      <ToggleRow
        label="Allow Live Translation"
        description="Participants can request translated subtitles in their preferred language."
        checked={policy.translationEnabled}
        onChange={(v) => update("translationEnabled", v)}
        disabled={!policy.transcriptionEnabled}
      />

      {/* Summaries */}
      <ToggleRow
        label="Post-Call Summaries"
        description="After each call, an AI-generated summary of highlights, decisions, and action items is created."
        checked={policy.summaryEnabled}
        onChange={(v) => update("summaryEnabled", v)}
        disabled={!policy.transcriptionEnabled}
      />

      {/* Retention */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-white">Transcript Retention</label>
        <p className="text-xs" style={{ color: "var(--theme-text-secondary)" }}>
          Transcripts and summaries are automatically purged after this period.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          {RETENTION_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => update("retentionDays", p.value)}
              className="rounded px-3 py-1.5 text-sm transition-colors"
              style={{
                background:
                  policy.retentionDays === p.value
                    ? "var(--theme-accent)"
                    : "var(--theme-bg-tertiary)",
                color: policy.retentionDays === p.value ? "white" : "var(--theme-text-secondary)",
              }}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={policy.retentionDays}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v) && v >= 1 && v <= 365) update("retentionDays", v)
              }}
              className="w-20 rounded px-2 py-1.5 text-sm text-white"
              style={{
                background: "var(--theme-bg-tertiary)",
                border: "1px solid var(--theme-bg-primary)",
                outline: "none",
              }}
            />
            <span className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>
              days
            </span>
          </div>
        </div>
      </div>

      {/* Save button + status */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
          style={{ background: "var(--theme-accent)", color: "white" }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "Saving…" : "Save Changes"}
        </button>
        {savedAt && !error && (
          <span className="text-xs" style={{ color: "var(--theme-success)" }}>
            Saved at {savedAt.toLocaleTimeString()}
          </span>
        )}
        {error && (
          <span className="text-xs" style={{ color: "var(--theme-danger)" }}>
            {error}
          </span>
        )}
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 cursor-pointer ${
        disabled ? "opacity-40 pointer-events-none" : ""
      }`}
    >
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--theme-text-secondary)" }}>
          {description}
        </p>
      </div>
      <div className="relative shrink-0 mt-0.5">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div
          className="w-10 h-6 rounded-full transition-colors"
          style={{ background: checked ? "var(--theme-accent)" : "var(--theme-bg-tertiary)" }}
          onClick={() => onChange(!checked)}
        />
        <div
          className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
        />
      </div>
    </label>
  )
}
