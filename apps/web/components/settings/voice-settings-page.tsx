"use client"

import { Mic, Video, Volume2, Headphones } from "lucide-react"

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL

export function VoiceSettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
          Voice &amp; Video
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--theme-text-muted)" }}>
          Configure your microphone, camera, and audio processing settings.
        </p>
      </div>

      {/* Voice backend info */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Voice Backend
        </h2>
        <div
          className="rounded-lg p-4 space-y-2"
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
        >
          <div className="flex items-center gap-2">
            <Headphones className="w-5 h-5" style={{ color: LIVEKIT_URL ? "var(--theme-success)" : "var(--theme-accent)" }} />
            <p className="font-semibold" style={{ color: "var(--theme-text-primary)" }}>
              {LIVEKIT_URL ? "Livekit SFU (scalable)" : "WebRTC P2P"}
            </p>
          </div>
          <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
            {LIVEKIT_URL
              ? `Connected to SFU at ${LIVEKIT_URL}. Supports large groups with no P2P limits.`
              : "Using peer-to-peer WebRTC. Best for groups up to 6. Set NEXT_PUBLIC_LIVEKIT_URL to enable the SFU."}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4">
        {[
          { icon: Mic, label: "Microphone", description: "Device selection and audio pipeline settings are available in the voice channel panel during a call." },
          { icon: Video, label: "Camera", description: "Select your camera and resolution when starting a video stream." },
          { icon: Volume2, label: "Speaker", description: "Output device selection is available during an active voice session." },
        ].map(({ icon: Icon, label, description }) => (
          <div
            key={label}
            className="rounded-lg p-4 space-y-2"
            style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
          >
            <div className="flex items-center gap-2">
              <Icon className="w-4 h-4" style={{ color: "var(--theme-accent)" }} />
              <p className="text-sm font-semibold" style={{ color: "var(--theme-text-primary)" }}>{label}</p>
            </div>
            <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{description}</p>
          </div>
        ))}
      </div>

      <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
        Advanced audio settings (EQ, noise gate, compressor) are accessible from the voice channel panel.
      </p>
    </div>
  )
}
