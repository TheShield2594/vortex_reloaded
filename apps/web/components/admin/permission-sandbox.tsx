"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Eye, Loader2, ShieldOff, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

// ---------------------------------------------------------------------------
// Types mirroring API response
// ---------------------------------------------------------------------------

interface SimulationResult {
  serverId: string
  roleId: string | null
  userId: string | null
  channelId: string | null
  isOwner: boolean
  isAdmin: boolean
  serverPermissions: number
  channelPermissions: number
  grantedServerPerms: string[]
  grantedChannelPerms: string[]
  deniedChannelPerms: string[]
  allowedChannelPerms: string[]
}

interface Role { id: string; name: string; color: string; is_default: boolean }
interface Member { user_id: string; username: string; display_name: string | null; avatar_url: string | null }
interface Channel { id: string; name: string }

interface Props {
  serverId: string
  /** All roles in this server. If omitted the component fetches them itself. */
  roles?: Role[]
  /** All channels in this server. If omitted the component fetches them itself. */
  channels?: Channel[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PERM_LABELS: Record<string, string> = {
  VIEW_CHANNELS: "View Channels",
  SEND_MESSAGES: "Send Messages",
  MANAGE_MESSAGES: "Manage Messages",
  KICK_MEMBERS: "Kick Members",
  BAN_MEMBERS: "Ban Members",
  MANAGE_ROLES: "Manage Roles",
  MANAGE_CHANNELS: "Manage Channels",
  ADMINISTRATOR: "Administrator",
  CONNECT_VOICE: "Connect to Voice",
  SPEAK: "Speak",
  MUTE_MEMBERS: "Mute Members",
  STREAM: "Stream",
  MANAGE_WEBHOOKS: "Manage Webhooks",
  MANAGE_EVENTS: "Manage Events",
  MODERATE_MEMBERS: "Moderate Members",
  CREATE_PUBLIC_THREADS: "Create Public Threads",
  CREATE_PRIVATE_THREADS: "Create Private Threads",
  SEND_MESSAGES_IN_THREADS: "Send in Threads",
  USE_APPLICATION_COMMANDS: "Use App Commands",
  MENTION_EVERYONE: "Mention @everyone",
}

function PermBadge({ perm, variant }: { perm: string; variant: "granted" | "denied" | "channel-allow" | "channel-deny" }) {
  const label = PERM_LABELS[perm] ?? perm
  const styles: Record<typeof variant, string> = {
    granted: "bg-green-900/30 text-green-300 border-green-800",
    denied: "bg-red-900/30 text-red-300 border-red-800",
    "channel-allow": "bg-blue-900/30 text-blue-300 border-blue-800",
    "channel-deny": "bg-orange-900/30 text-orange-300 border-orange-800",
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${styles[variant]}`}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PermissionSandbox({ serverId, roles: rolesProp, channels: channelsProp }: Props) {
  const [roles, setRoles] = useState<Role[]>(rolesProp ?? [])
  const [channels, setChannels] = useState<Channel[]>(channelsProp ?? [])
  const [members, setMembers] = useState<Member[]>([])
  const [membersLoading, setMembersLoading] = useState(false)

  // Fetch roles / channels if not provided by parent
  useEffect(() => {
    if (rolesProp) return
    fetch(`/api/servers/${serverId}/roles`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: Role[]) => setRoles(data))
      .catch(() => {})
  }, [serverId, rolesProp])

  useEffect(() => {
    if (channelsProp) return
    fetch(`/api/servers/${serverId}/channels`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: Channel[]) => setChannels(data))
      .catch(() => {})
  }, [serverId, channelsProp])

  const [subjectType, setSubjectType] = useState<"role" | "member">("role")
  const [selectedRoleId, setSelectedRoleId] = useState("")
  const [selectedUserId, setSelectedUserId] = useState("")
  const [selectedChannelId, setSelectedChannelId] = useState("")

  const [result, setResult] = useState<SimulationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memberSearch, setMemberSearch] = useState("")

  // Fetch members lazily when switching to member mode
  useEffect(() => {
    if (subjectType !== "member" || members.length > 0) return
    setMembersLoading(true)
    fetch(`/api/servers/${serverId}/members?limit=200`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: Member[]) => setMembers(data))
      .catch(() => {})
      .finally(() => setMembersLoading(false))
  }, [subjectType, serverId, members.length])

  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return members
    const q = memberSearch.toLowerCase()
    return members.filter(
      (m) =>
        m.username.toLowerCase().includes(q) ||
        (m.display_name ?? "").toLowerCase().includes(q)
    )
  }, [members, memberSearch])

  async function runSimulation() {
    const subjectKey = subjectType === "role" ? "roleId" : "userId"
    const subjectValue = subjectType === "role" ? selectedRoleId : selectedUserId
    if (!subjectValue) {
      setError(`Select a ${subjectType} first.`)
      return
    }

    const qs = new URLSearchParams({ [subjectKey]: subjectValue })
    if (selectedChannelId) qs.set("channelId", selectedChannelId)

    setLoading(true)
    setError(null)
    setResult(null)

    const res = await fetch(`/api/servers/${serverId}/admin/simulate?${qs.toString()}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError((body as { error?: string }).error ?? "Simulation failed")
      setLoading(false)
      return
    }
    setResult(await res.json())
    setLoading(false)
  }

  return (
    <section className="space-y-4 text-zinc-100">
      <header>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Eye className="w-5 h-5 text-blue-400" />
          Permission Sandbox
        </h2>
        <p className="text-sm text-zinc-400 mt-0.5">
          Preview the effective permissions a role or member has — server-wide or in a specific channel.
        </p>
      </header>

      {/* Subject selector */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={subjectType === "role" ? "default" : "outline"}
            onClick={() => { setSubjectType("role"); setResult(null) }}
          >
            By Role
          </Button>
          <Button
            size="sm"
            variant={subjectType === "member" ? "default" : "outline"}
            onClick={() => { setSubjectType("member"); setResult(null) }}
          >
            By Member
          </Button>
        </div>

        {subjectType === "role" ? (
          <div>
            <Label className="text-xs text-zinc-400 mb-1 block">Role</Label>
            <select
              className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 px-2 py-1.5"
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(e.target.value)}
            >
              <option value="">— select a role —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.is_default ? " (@everyone)" : ""}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400 mb-1 block">Member</Label>
            <input
              type="text"
              placeholder="Search members…"
              className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 px-2 py-1.5 mb-1"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
            {membersLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
            ) : (
              <select
                className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 px-2 py-1.5"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                size={Math.min(filteredMembers.length + 1, 6)}
              >
                <option value="">— select a member —</option>
                {filteredMembers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name ?? m.username} ({m.username})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div>
          <Label className="text-xs text-zinc-400 mb-1 block">Channel (optional)</Label>
          <select
            className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 px-2 py-1.5"
            value={selectedChannelId}
            onChange={(e) => setSelectedChannelId(e.target.value)}
          >
            <option value="">— server-level only —</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}># {c.name}</option>
            ))}
          </select>
        </div>

        <Button onClick={runSimulation} disabled={loading} size="sm">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Run Simulation
        </Button>

        {error && (
          <p className="text-sm text-red-400 flex items-center gap-1"><XCircle className="w-4 h-4" />{error}</p>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4 space-y-4">
          {/* Admin / owner banner */}
          {result.isAdmin && (
            <div className="flex items-center gap-2 text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-800 rounded px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {result.isOwner
                ? "Server owner — bypasses all permission checks."
                : "Has ADMINISTRATOR — bypasses channel overwrites."}
            </div>
          )}

          {/* Server permissions */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Server-level permissions
            </p>
            {result.grantedServerPerms.length === 0 ? (
              <p className="text-sm text-zinc-500 flex items-center gap-1">
                <ShieldOff className="w-4 h-4" /> No permissions
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {result.grantedServerPerms.map((p) => <PermBadge key={p} perm={p} variant="granted" />)}
              </div>
            )}
          </div>

          {/* Channel permissions */}
          {result.channelId && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Channel-level effective permissions
              </p>
              {result.isAdmin ? (
                <p className="text-sm text-zinc-400">Administrator — inherits all permissions, overwrites ignored.</p>
              ) : (
                <>
                  {result.allowedChannelPerms.length > 0 && (
                    <div>
                      <p className="text-xs text-blue-400 mb-1 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Explicitly allowed by overwrite
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.allowedChannelPerms.map((p) => <PermBadge key={p} perm={p} variant="channel-allow" />)}
                      </div>
                    </div>
                  )}
                  {result.deniedChannelPerms.length > 0 && (
                    <div>
                      <p className="text-xs text-orange-400 mb-1 flex items-center gap-1">
                        <XCircle className="w-3 h-3" /> Explicitly denied by overwrite
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.deniedChannelPerms.map((p) => <PermBadge key={p} perm={p} variant="channel-deny" />)}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-green-400 mb-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Net effective permissions in channel
                    </p>
                    {result.grantedChannelPerms.length === 0 ? (
                      <p className="text-sm text-zinc-500 flex items-center gap-1">
                        <ShieldOff className="w-4 h-4" /> No permissions in this channel
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {result.grantedChannelPerms.map((p) => <PermBadge key={p} perm={p} variant="granted" />)}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
