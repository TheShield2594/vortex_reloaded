"use client"

export function ChatMockup(): React.ReactElement {
  return (
    <div
      className="w-full max-w-md rounded-xl border overflow-hidden shadow-2xl"
      style={{
        background: "var(--theme-bg-secondary)",
        borderColor: "rgba(255,255,255,0.08)",
        boxShadow: "0 24px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)",
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-b"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-tertiary)" }}
      >
        <span
          className="text-xs font-semibold"
          style={{ color: "var(--theme-text-muted)" }}
        >
          #
        </span>
        <span
          className="text-sm font-semibold"
          style={{ color: "var(--theme-text-bright)" }}
        >
          general
        </span>
        <span
          className="ml-auto text-xs"
          style={{ color: "var(--theme-text-muted)" }}
        >
          3 online
        </span>
      </div>

      {/* Messages */}
      <div className="flex flex-col gap-3 px-4 py-4">
        <MockMessage
          name="Alex"
          color="#f92aad"
          text="just pushed the new voice engine — try it out!"
          time="2:14 PM"
        />
        <MockMessage
          name="Jordan"
          color="#3ddc97"
          text="latency is insane, way better than before 🔥"
          time="2:15 PM"
        />
        <MockMessage
          name="Sam"
          color="var(--theme-accent)"
          text="shipping the update tonight. no paywall, obviously."
          time="2:16 PM"
        />
      </div>

      {/* Input bar */}
      <div
        className="mx-3 mb-3 flex items-center gap-2 rounded-lg border px-3 py-2"
        style={{
          borderColor: "rgba(255,255,255,0.08)",
          background: "var(--theme-bg-primary)",
        }}
      >
        <span className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
          Message #general
        </span>
      </div>
    </div>
  )
}

function MockMessage({
  name,
  color,
  text,
  time,
}: {
  name: string
  color: string
  text: string
  time: string
}): React.ReactElement {
  return (
    <div className="flex items-start gap-2.5">
      <div
        className="mt-0.5 h-7 w-7 flex-shrink-0 rounded-full"
        style={{ background: color, opacity: 0.8 }}
      />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold" style={{ color }}>
            {name}
          </span>
          <span className="text-[10px]" style={{ color: "var(--theme-text-muted)" }}>
            {time}
          </span>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: "var(--theme-text-primary)" }}>
          {text}
        </p>
      </div>
    </div>
  )
}
