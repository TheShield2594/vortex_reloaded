"use client"

/**
 * Issue #40 ("Group trust model") — surfaces the two things the issue asks
 * for: a visible, signed log of membership/admin changes (Signal tracks
 * this internally but never shows it), and a safety-number verification
 * flow that's reachable from here directly instead of being buried.
 */
import { useEffect, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { UserPlus, UserMinus, LogOut, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { verifyEd25519Signature } from "@/lib/olm-protocol"
import { SafetyNumbersTab, type TrustMember } from "@/components/dm/safety-number-tab"

interface LogPerson {
  id: string
  display_name: string | null
  username: string
  avatar_url: string | null
}

interface LogEntry {
  id: string
  action: "member_added" | "member_removed" | "member_left"
  actor_id: string | null
  target_id: string | null
  actor_ed25519_key: string | null
  payload: string
  signature: string | null
  created_at: string
  actor: LogPerson | null
  target: LogPerson | null
}

function nameOf(person: LogPerson | null | undefined): string {
  return person?.display_name || person?.username || "Someone"
}

function actionText(entry: LogEntry): string {
  switch (entry.action) {
    case "member_added":
      return `${nameOf(entry.actor)} added ${nameOf(entry.target)}`
    case "member_removed":
      return `${nameOf(entry.actor)} removed ${nameOf(entry.target)}`
    case "member_left":
      return `${nameOf(entry.target)} left the group`
  }
}

function SignatureBadge({ entry, verified }: { entry: LogEntry; verified: boolean | undefined }) {
  if (!entry.signature || !entry.actor_ed25519_key) {
    return (
      <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--theme-text-muted)" }}>
        <ShieldQuestion className="w-3 h-3" /> Unsigned
      </span>
    )
  }
  if (verified === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--theme-text-muted)" }}>
        Verifying…
      </span>
    )
  }
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--theme-success)" }}>
        <ShieldCheck className="w-3 h-3" /> Signed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--theme-danger)" }}>
      <ShieldAlert className="w-3 h-3" /> Signature invalid
    </span>
  )
}

function ActionIcon({ action }: { action: LogEntry["action"] }) {
  const className = "w-4 h-4"
  if (action === "member_added") return <UserPlus className={className} />
  if (action === "member_removed") return <UserMinus className={className} />
  return <LogOut className={className} />
}

function MembershipLogTab({ channelId }: { channelId: string }) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verifiedMap, setVerifiedMap] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/dm/channels/${channelId}/membership-log`)
        if (!res.ok) throw new Error("Failed to load activity log")
        const { entries: data } = (await res.json()) as { entries: LogEntry[] }
        if (!cancelled) setEntries(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load activity log")
      }
    }
    load()
    return () => { cancelled = true }
  }, [channelId])

  useEffect(() => {
    if (!entries?.length) return
    let cancelled = false
    async function verifyAll() {
      const results: Record<string, boolean> = {}
      await Promise.all((entries ?? []).map(async (entry) => {
        if (!entry.signature || !entry.actor_ed25519_key) return
        try {
          results[entry.id] = await verifyEd25519Signature(entry.actor_ed25519_key, entry.payload, entry.signature)
        } catch {
          results[entry.id] = false
        }
      }))
      if (!cancelled) setVerifiedMap(results)
    }
    verifyAll()
    return () => { cancelled = true }
  }, [entries])

  if (error) {
    return <p className="text-sm px-1 py-4" style={{ color: "var(--theme-danger)" }}>{error}</p>
  }

  if (!entries) {
    return <p className="text-sm px-1 py-4" style={{ color: "var(--theme-text-muted)" }}>Loading…</p>
  }

  if (entries.length === 0) {
    return <p className="text-sm px-1 py-4" style={{ color: "var(--theme-text-muted)" }}>No membership changes yet.</p>
  }

  return (
    <div className="flex flex-col gap-1 max-h-96 overflow-y-auto -mx-1">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3 px-1 py-2 rounded-md">
          <div
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5"
            style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-secondary)" }}
          >
            <ActionIcon action={entry.action} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm" style={{ color: "var(--theme-text-primary)" }}>{actionText(entry)}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
              </p>
              <SignatureBadge entry={entry} verified={verifiedMap[entry.id]} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

interface Props {
  open: boolean
  onClose: () => void
  channelId: string
  currentUserId: string
  members: TrustMember[]
  initialTab?: "log" | "safety"
  initialOtherUserId?: string | null
}

export function GroupTrustModal({ open, onClose, channelId, currentUserId, members, initialTab, initialOtherUserId }: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Group Trust &amp; Safety</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={initialTab ?? "log"}>
          <TabsList>
            <TabsTrigger value="log">Activity Log</TabsTrigger>
            <TabsTrigger value="safety">Safety Numbers</TabsTrigger>
          </TabsList>
          <TabsContent value="log">
            <MembershipLogTab channelId={channelId} />
          </TabsContent>
          <TabsContent value="safety">
            <SafetyNumbersTab currentUserId={currentUserId} members={members} initialOtherUserId={initialOtherUserId} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
