"use client"

// Consent modal shown at session start (server channels) or call start (DMs).
// For DM calls, bilateral consent is required: if either participant declines,
// transcription stays off for both.

import { useState } from "react"
import { Mic, Globe, X } from "lucide-react"
import { cn } from "@/lib/utils/cn"

interface VoiceConsentModalProps {
  /** Whether this is a DM call (bilateral consent gate) or server channel. */
  isDmCall: boolean
  onAccept: (consentTranscription: boolean, consentTranslation: boolean, subtitleLanguage: string | null) => void
  onDecline: () => void
}

const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese (Simplified)" },
  { code: "pt", label: "Portuguese" },
  { code: "ko", label: "Korean" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
]

export function VoiceConsentModal({ isDmCall, onAccept, onDecline }: VoiceConsentModalProps) {
  const [consentTranscription, setConsentTranscription] = useState(false)
  const [consentTranslation, setConsentTranslation] = useState(false)
  const [subtitleLanguage, setSubtitleLanguage] = useState<string | null>(null)

  function handleAccept() {
    onAccept(consentTranscription, consentTranslation, consentTranslation && consentTranslation ? subtitleLanguage : null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div
        className="relative w-full max-w-md rounded-xl shadow-2xl p-6 flex flex-col gap-5"
        style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-white font-semibold text-lg">Vortex Recap</h2>
            <p className="text-sm mt-1" style={{ color: "var(--theme-text-secondary)" }}>
              {isDmCall
                ? "This call can use live transcription and subtitles. Both participants must consent for transcription to start."
                : "This server can use live transcription and subtitles. Your consent is required before recording begins."}
            </p>
          </div>
          <button
            onClick={onDecline}
            className="rounded p-1 transition-colors hover:bg-white/10 shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        {/* Transcription toggle */}
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--theme-accent)]"
            checked={consentTranscription}
            onChange={(e) => {
              setConsentTranscription(e.target.checked)
              if (!e.target.checked) {
                setConsentTranslation(false)
                setSubtitleLanguage(null)
              }
            }}
          />
          <div>
            <div className="flex items-center gap-1.5 text-white text-sm font-medium">
              <Mic className="w-4 h-4" />
              Live Transcription
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--theme-text-secondary)" }}>
              Your speech will be transcribed in real time and saved per the server&apos;s retention policy.
            </p>
          </div>
        </label>

        {/* Translation toggle (only when transcription is on) */}
        <label
          className={cn(
            "flex items-start gap-3 cursor-pointer",
            !consentTranscription && "opacity-40 pointer-events-none"
          )}
        >
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--theme-accent)]"
            checked={consentTranslation}
            disabled={!consentTranscription}
            onChange={(e) => setConsentTranslation(e.target.checked)}
          />
          <div>
            <div className="flex items-center gap-1.5 text-white text-sm font-medium">
              <Globe className="w-4 h-4" />
              Live Subtitles / Translation
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--theme-text-secondary)" }}>
              Optionally receive translated subtitles in your preferred language.
            </p>
          </div>
        </label>

        {/* Language picker */}
        {consentTranslation && (
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: "var(--theme-text-secondary)" }}>
              Subtitle language
            </label>
            <select
              value={subtitleLanguage ?? ""}
              onChange={(e) => setSubtitleLanguage(e.target.value || null)}
              className="w-full rounded px-2 py-1.5 text-sm text-white"
              style={{
                background: "var(--theme-bg-tertiary)",
                border: "1px solid var(--theme-bg-primary)",
                outline: "none",
              }}
            >
              <option value="">Source language (no translation)</option>
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Policy notice */}
        <p className="text-xs" style={{ color: "var(--theme-text-faint)" }}>
          Raw audio is not stored. Transcripts are retained according to the server&apos;s retention policy and can be
          deleted by admins or by you in your settings.
        </p>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onDecline}
            className="rounded px-4 py-2 text-sm font-medium transition-colors"
            style={{ color: "var(--theme-text-secondary)" }}
          >
            Skip
          </button>
          <button
            onClick={handleAccept}
            className="rounded px-4 py-2 text-sm font-medium transition-colors"
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            {consentTranscription ? "Enable & Continue" : "Continue without transcription"}
          </button>
        </div>
      </div>
    </div>
  )
}
