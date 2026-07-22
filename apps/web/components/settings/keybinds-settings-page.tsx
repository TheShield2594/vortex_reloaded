"use client"

import { Keyboard } from "lucide-react"

const KEYBINDS = [
  { category: "Navigation", binds: [
    { keys: ["Ctrl/⌘", "K"], action: "Quick Switcher — jump to any channel or DM" },
    { keys: ["Ctrl/⌘", "F"], action: "Search messages in current channel" },
    { keys: ["Alt", "↑"], action: "Previous channel" },
    { keys: ["Alt", "↓"], action: "Next channel" },
    { keys: ["Alt", "Shift", "↑"], action: "Previous unread channel" },
    { keys: ["Alt", "Shift", "↓"], action: "Next unread channel" },
  ]},
  { category: "Messages", binds: [
    { keys: ["↑"], action: "Edit last message (when composer is empty)" },
    { keys: ["Enter"], action: "Send message" },
    { keys: ["Shift", "Enter"], action: "New line in composer" },
    { keys: ["Escape"], action: "Cancel edit / clear reply" },
  ]},
  { category: "Voice", binds: [
    { keys: ["Space"], action: "Push to talk (when configured)" },
    { keys: ["Ctrl/⌘", "Shift", "D"], action: "Toggle deafen" },
    { keys: ["Ctrl/⌘", "Shift", "M"], action: "Toggle mute" },
  ]},
  { category: "Interface", binds: [
    { keys: ["Ctrl/⌘", "/"], action: "Show keyboard shortcuts" },
    { keys: ["Esc"], action: "Close modal / panel" },
  ]},
]

export function KeybindsSettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
          Keyboard Shortcuts
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--theme-text-muted)" }}>
          Master these shortcuts to navigate and chat without touching your mouse.
        </p>
      </div>

      {KEYBINDS.map(({ category, binds }) => (
        <section key={category} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
            {category}
          </h2>
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: "1px solid var(--theme-bg-tertiary)" }}
          >
            {binds.map(({ keys, action }, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-4 py-2.5"
                style={{
                  background: i % 2 === 0 ? "var(--theme-bg-secondary)" : "var(--theme-bg-primary)",
                  borderBottom: i < binds.length - 1 ? "1px solid var(--theme-bg-tertiary)" : "none",
                }}
              >
                <span className="text-sm" style={{ color: "var(--theme-text-primary)" }}>{action}</span>
                <div className="flex items-center gap-1 flex-shrink-0 ml-4">
                  {keys.map((key, ki) => (
                    <span key={ki} className="flex items-center gap-1">
                      {ki > 0 && <span className="text-xs" style={{ color: "var(--theme-text-faint)" }}>+</span>}
                      <kbd
                        className="px-2 py-0.5 rounded text-xs font-mono"
                        style={{
                          background: "var(--theme-bg-tertiary)",
                          color: "var(--theme-text-secondary)",
                          border: "1px solid var(--theme-bg-tertiary)",
                          boxShadow: "0 1px 0 var(--theme-bg-primary)",
                        }}
                      >
                        {key}
                      </kbd>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <div
        className="flex items-start gap-3 rounded-lg p-4"
        style={{ background: "color-mix(in srgb, var(--theme-accent) 8%, var(--theme-bg-secondary))", border: "1px solid color-mix(in srgb, var(--theme-accent) 20%, transparent)" }}
      >
        <Keyboard className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "var(--theme-accent)" }} />
        <p className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>
          Custom keybind remapping is planned for a future release.
        </p>
      </div>
    </div>
  )
}
