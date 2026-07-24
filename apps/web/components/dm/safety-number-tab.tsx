"use client"

/**
 * Issue #40 ("Group trust model") — "Built-in automated safety-number/
 * verification nudges instead of a buried manual QR-scan flow." The nudge
 * itself lives in lib/membership-log.ts (a notification created when a
 * member is added); this is where it lands: a plain side-by-side number
 * comparison, with a QR code as a secondary/optional aid rather than the
 * primary flow — there's no in-app camera scanner here on purpose, both
 * sides are expected to compare over a channel they already trust (in
 * person, a phone call), not by scanning each other through this app.
 */
import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"

export interface TrustMember {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
}

interface SafetyStatus {
  loading: boolean
  error?: string
  safetyNumber?: string
  verified?: boolean
  changed?: boolean
  verifiedAt?: string | null
}

function nameOf(m: TrustMember): string {
  return m.display_name || m.username
}

export function SafetyNumbersTab({
  currentUserId,
  members,
  initialOtherUserId,
}: {
  currentUserId: string
  members: TrustMember[]
  initialOtherUserId?: string | null
}) {
  const { toast } = useToast()
  const others = members.filter((m) => m.id !== currentUserId)
  const otherIds = others.map((m) => m.id).join(",")
  const [statuses, setStatuses] = useState<Record<string, SafetyStatus>>({})
  const [expanded, setExpanded] = useState<string | null>(initialOtherUserId ?? null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadAll() {
      await Promise.all(otherIds.split(",").filter(Boolean).map(async (id) => {
        setStatuses((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), loading: true } }))
        try {
          const res = await fetch(`/api/dm/trust/safety-number?otherUserId=${id}`)
          const body = await res.json().catch(() => ({}))
          if (cancelled) return
          if (!res.ok) {
            setStatuses((prev) => ({ ...prev, [id]: { loading: false, error: body.error ?? "Unavailable" } }))
            return
          }
          setStatuses((prev) => ({
            ...prev,
            [id]: {
              loading: false,
              safetyNumber: body.safety_number,
              verified: body.verified,
              changed: body.changed,
              verifiedAt: body.verified_at,
            },
          }))
        } catch {
          if (!cancelled) setStatuses((prev) => ({ ...prev, [id]: { loading: false, error: "Failed to load" } }))
        }
      }))
    }
    if (otherIds) loadAll()
    return () => { cancelled = true }
  }, [currentUserId, otherIds])

  useEffect(() => {
    const status = expanded ? statuses[expanded] : null
    if (!status?.safetyNumber) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    QRCode.toDataURL(status.safetyNumber.replace(/\s/g, ""))
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [expanded, statuses])

  async function confirmVerified(otherUserId: string) {
    const status = statuses[otherUserId]
    if (!status?.safetyNumber) return
    setConfirming(true)
    try {
      const res = await fetch("/api/dm/trust/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otherUserId, safetyNumber: status.safetyNumber }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ variant: "destructive", title: "Couldn't confirm", description: body.error })
        return
      }
      setStatuses((prev) => ({
        ...prev,
        [otherUserId]: { ...prev[otherUserId], verified: true, changed: false, verifiedAt: body.verified_at },
      }))
      toast({ title: "Safety number verified" })
    } catch {
      toast({ variant: "destructive", title: "Couldn't confirm", description: "Network error" })
    } finally {
      setConfirming(false)
    }
  }

  if (others.length === 0) {
    return <p className="text-sm px-1 py-4" style={{ color: "var(--theme-text-muted)" }}>No other members yet.</p>
  }

  return (
    <div className="flex flex-col gap-1 max-h-96 overflow-y-auto -mx-1">
      {others.map((m) => {
        const status = statuses[m.id]
        const isExpanded = expanded === m.id
        return (
          <div key={m.id} className="rounded-md" style={{ background: isExpanded ? "var(--theme-bg-tertiary)" : "transparent" }}>
            <button
              type="button"
              className="w-full flex items-center gap-3 px-1 py-2 text-left"
              onClick={() => setExpanded(isExpanded ? null : m.id)}
            >
              <Avatar className="w-7 h-7">
                {m.avatar_url && <AvatarImage src={m.avatar_url} />}
                <AvatarFallback style={{ background: "var(--theme-accent)", color: "white", fontSize: "11px" }}>
                  {nameOf(m).slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: "var(--theme-text-primary)" }}>{nameOf(m)}</p>
                {status?.loading ? (
                  <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Checking…</p>
                ) : status?.error ? (
                  <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{status.error}</p>
                ) : status?.changed ? (
                  <p className="text-xs inline-flex items-center gap-1" style={{ color: "var(--theme-danger)" }}>
                    <ShieldAlert className="w-3 h-3" /> Safety number changed — re-verify
                  </p>
                ) : status?.verified ? (
                  <p className="text-xs inline-flex items-center gap-1" style={{ color: "var(--theme-success)" }}>
                    <ShieldCheck className="w-3 h-3" /> Verified
                  </p>
                ) : (
                  <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Not verified</p>
                )}
              </div>
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {isExpanded && (
              <div className="px-3 pb-3">
                {status?.safetyNumber ? (
                  <>
                    <p className="text-xs mb-2" style={{ color: "var(--theme-text-muted)" }}>
                      Compare this number with {nameOf(m)} over a channel you already trust (in person, a call)
                      before confirming.
                    </p>
                    <div className="flex items-center gap-3">
                      {qrDataUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qrDataUrl} alt="Safety number QR code" className="w-24 h-24 rounded flex-shrink-0" />
                      )}
                      <p className="font-mono text-sm leading-relaxed break-all flex-1" style={{ color: "var(--theme-text-primary)" }}>
                        {status.safetyNumber}
                      </p>
                    </div>
                    <Button size="sm" className="mt-3" disabled={confirming} onClick={() => confirmVerified(m.id)}>
                      {confirming && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
                      I&apos;ve confirmed this matches
                    </Button>
                  </>
                ) : (
                  <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                    {status?.error ?? "No published identity keys yet for one of you."}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
