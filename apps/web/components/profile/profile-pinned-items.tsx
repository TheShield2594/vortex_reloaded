"use client"

import { useEffect, useState } from "react"
import { ExternalLink, FileText, Hash, Link, MessageSquare, Pin } from "lucide-react"
import type { UserPinnedItemRow } from "@/types/database"

interface ProfilePinnedItemsProps {
  userId: string
  /** Pre-fetched pins — if provided, skips the client-side fetch */
  initialPins?: UserPinnedItemRow[]
}

const PIN_ICONS: Record<UserPinnedItemRow["pin_type"], React.ReactNode> = {
  message: <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />,
  channel: <Hash className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />,
  file:    <FileText className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />,
  link:    <Link className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />,
}

function PinCard({ pin }: { pin: UserPinnedItemRow }) {
  const icon = PIN_ICONS[pin.pin_type]
  const isExternal = pin.url?.startsWith("http")
  const linkProps = isExternal
    ? { href: pin.url!, target: "_blank", rel: "noreferrer noopener" }
    : { href: pin.url ?? "#" }

  const inner = (
    <>
      <span style={{ color: "var(--theme-text-muted)" }}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p
          className="text-xs font-medium truncate leading-tight"
          style={{ color: "var(--theme-text-primary)" }}
        >
          {pin.label}
        </p>
        {pin.sublabel && (
          <p className="text-[11px] truncate leading-tight mt-0.5" style={{ color: "var(--theme-text-muted)" }}>
            {pin.sublabel}
          </p>
        )}
      </div>
      {pin.url && (
        <ExternalLink
          className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"
          aria-hidden
          style={{ color: "var(--theme-text-muted)" }}
        />
      )}
    </>
  )

  if (!pin.url) {
    return (
      <div
        className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
        style={{ background: "var(--theme-bg-tertiary)" }}
      >
        {inner}
      </div>
    )
  }

  return (
    <a
      {...linkProps}
      className="group flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 hover:[background:var(--theme-surface-elevated)]"
      style={{
        background: "var(--theme-bg-tertiary)",
        textDecoration: "none",
      }}
      aria-label={`${pin.label}${pin.sublabel ? ` — ${pin.sublabel}` : ""}`}
    >
      {inner}
    </a>
  )
}

/**
 * Displays a user's pinned profile items (messages, channels, files, links).
 * Fetches lazily unless `initialPins` is provided.
 */
export function ProfilePinnedItems({ userId, initialPins }: ProfilePinnedItemsProps) {
  const [pins, setPins] = useState<UserPinnedItemRow[]>(initialPins ?? [])
  const [loading, setLoading] = useState(!initialPins)

  useEffect(() => {
    if (initialPins) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/users/pinned?userId=${userId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: { pins: UserPinnedItemRow[] }) => {
        if (!cancelled) setPins(json.pins ?? [])
      })
      .catch(() => { /* silently ignore — empty state will show */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId, initialPins])

  if (loading) {
    return (
      <div className="space-y-1.5">
        {[1, 2].map((n) => (
          <div
            key={n}
            className="h-9 rounded-lg animate-pulse"
            style={{ background: "var(--theme-bg-tertiary)" }}
          />
        ))}
      </div>
    )
  }

  if (pins.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <Pin className="w-3.5 h-3.5" style={{ color: "var(--theme-text-muted)" }} aria-hidden />
        <p className="text-xs italic" style={{ color: "var(--theme-text-muted)" }}>
          Nothing pinned yet
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5" role="list" aria-label="Pinned items">
      {pins.map((pin) => (
        <div key={pin.id} role="listitem">
          <PinCard pin={pin} />
        </div>
      ))}
    </div>
  )
}
