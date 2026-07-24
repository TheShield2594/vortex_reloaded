"use client"

import { Mic, Video, Volume2, Headphones } from "lucide-react"

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
            <Headphones className="w-5 h-5" style={{ color: "var(--theme-success)" }} />
            <p className="font-semibold" style={{ color: "var(--theme-text-primary)" }}>
              LiveKit SFU
            </p>
          </div>
          <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
            Calls connect through a LiveKit media server, so voice and video scale to group calls without a peer-to-peer mesh.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4">
        {[
          { icon: Mic, label: "Microphone", description: "EQ, presets, and gain are adjustable live from the settings button in the call controls during a voice call." },
          { icon: Video, label: "Camera", description: "Toggle your camera on or off from the call controls. Vortex uses your system's default camera." },
          { icon: Volume2, label: "Speaker", description: "Calls play through your system's default audio output device." },
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
        Advanced audio settings (EQ, presets, gain, bypass) live in the settings panel opened from the gear
        button in the call controls — changes apply instantly and are saved to your profile for next time.
      </p>
    </div>
  )
}
