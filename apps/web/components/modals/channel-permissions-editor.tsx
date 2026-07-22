"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { PERMISSIONS, type Permission } from "@vortex/shared"
import { detectChannelOverwriteRisks, type PermissionRisk } from "@/lib/permission-simulation"

interface Role {
  id: string
  name: string
  color: string
}

interface ChannelPerm {
  role_id: string
  allow_permissions: number
  deny_permissions: number
  role: Role
}

const PERM_LIST: { key: Permission; label: string }[] = [
  { key: "VIEW_CHANNELS", label: "View Channel" },
  { key: "SEND_MESSAGES", label: "Send Messages" },
  { key: "MANAGE_MESSAGES", label: "Manage Messages" },
  { key: "CONNECT_VOICE", label: "Connect to Voice" },
  { key: "SPEAK", label: "Speak" },
  { key: "STREAM", label: "Stream" },
]

/** Per-channel role permission overrides editor with allow/deny toggles for each permission bit. */
export function ChannelPermissionsEditor({ channelId, serverId }: { channelId: string; serverId: string }) {
  const [perms, setPerms] = useState<ChannelPerm[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [selected, setSelected] = useState<ChannelPerm | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [overwriteRisks, setOverwriteRisks] = useState<PermissionRisk[]>([])
  const [riskDismissed, setRiskDismissed] = useState(false)
  const supabase = useMemo(() => createClientSupabaseClient(), [])

  useEffect(() => {
    async function load() {
      const [permsRes, rolesRes] = await Promise.all([
        fetch(`/api/channels/${channelId}/permissions`),
        supabase.from("roles").select("id, name, color").eq("server_id", serverId),
      ])
      if (permsRes.ok) setPerms(await permsRes.json())
      if (rolesRes.data) setRoles(rolesRes.data)
      setLoading(false)
    }
    load()
  }, [channelId, serverId])

  function selectOverwrite(perm: ChannelPerm) {
    setSelected(perm)
    setOverwriteRisks([])
    setRiskDismissed(false)
  }

  function computeOverwriteRisks(perm: ChannelPerm) {
    const isDefault = roles.find((r) => r.id === perm.role_id) as (Role & { is_default?: boolean }) | undefined
    // We track is_default via the perms list which may have an is_default on the joined role object
    // If unavailable, fall back to false (safe default)
    const isDefaultRole = !!(isDefault as unknown as { is_default?: boolean })?.is_default
    const original = perms.find((p) => p.role_id === perm.role_id)
    return detectChannelOverwriteRisks(
      isDefaultRole,
      perm.allow_permissions,
      perm.deny_permissions,
      original?.allow_permissions ?? 0,
      original?.deny_permissions ?? 0,
    )
  }

  function addRole(role: Role) {
    const override: ChannelPerm = { role_id: role.id, allow_permissions: 0, deny_permissions: 0, role }
    setPerms((prev) => [...prev, override])
    selectOverwrite(override)
  }

  function toggleAllow(key: Permission) {
    if (!selected) return
    const bit = PERMISSIONS[key]
    const newAllow = selected.allow_permissions & bit ? selected.allow_permissions & ~bit : selected.allow_permissions | bit
    const newDeny = selected.deny_permissions & ~bit // can't allow and deny at same time
    const updated = { ...selected, allow_permissions: newAllow, deny_permissions: newDeny }
    setSelected(updated)
    setPerms((prev) => prev.map((p) => p.role_id === selected.role_id ? updated : p))
    setOverwriteRisks(computeOverwriteRisks(updated))
    setRiskDismissed(false)
  }

  function toggleDeny(key: Permission) {
    if (!selected) return
    const bit = PERMISSIONS[key]
    const newDeny = selected.deny_permissions & bit ? selected.deny_permissions & ~bit : selected.deny_permissions | bit
    const newAllow = selected.allow_permissions & ~bit
    const updated = { ...selected, deny_permissions: newDeny, allow_permissions: newAllow }
    setSelected(updated)
    setPerms((prev) => prev.map((p) => p.role_id === selected.role_id ? updated : p))
    setOverwriteRisks(computeOverwriteRisks(updated))
    setRiskDismissed(false)
  }

  async function save() {
    if (!selected) return
    setSaving(true)
    await fetch(`/api/channels/${channelId}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: selected.role_id, allowPermissions: selected.allow_permissions, denyPermissions: selected.deny_permissions }),
    })
    setSaving(false)
  }

  async function remove(roleId: string) {
    await fetch(`/api/channels/${channelId}/permissions?roleId=${roleId}`, { method: "DELETE" })
    setPerms((prev) => prev.filter((p) => p.role_id !== roleId))
    if (selected?.role_id === roleId) { setSelected(null); setOverwriteRisks([]) }
  }

  const unusedRoles = roles.filter((r) => !perms.find((p) => p.role_id === r.id))

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="animate-spin" style={{ color: "var(--theme-text-muted)" }} /></div>

  return (
    <div className="flex gap-3 h-72" role="dialog" aria-modal="true" aria-labelledby="cp-title" aria-describedby="cp-desc">
      <h2 id="cp-title" className="sr-only">Channel Permissions</h2>
      <p id="cp-desc" className="sr-only">Configure channel permission overrides</p>
      {/* Role list */}
      <div className="w-40 flex-shrink-0 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--theme-text-muted)" }}>Roles</p>
        {perms.map((p) => (
          <button
            key={p.role_id}
            onClick={() => selectOverwrite(p)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left"
            style={{ background: selected?.role_id === p.role_id ? "rgba(255,255,255,0.1)" : "transparent", color: "var(--theme-text-primary)" }}
          >
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.role.color }} />
            <span className="truncate flex-1">{p.role.name}</span>
            <button onClick={(e) => { e.stopPropagation(); remove(p.role_id) }} style={{ color: "var(--theme-danger)" }} aria-label={`Remove ${p.role.name} override`}>
              <Trash2 className="w-3 h-3" />
            </button>
          </button>
        ))}
        {unusedRoles.length > 0 && (
          <div className="pt-2 border-t" style={{ borderColor: "var(--theme-surface-elevated)" }}>
            <p className="text-xs mb-1" style={{ color: "var(--theme-text-faint)" }}>Add override</p>
            {unusedRoles.map((r) => (
              <button
                key={r.id}
                onClick={() => addRole(r)}
                className="w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left hover:bg-white/5"
                style={{ color: "var(--theme-text-secondary)" }}
              >
                <Plus className="w-3 h-3" />
                <span className="truncate">{r.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Permission editor */}
      {selected ? (
        <div className="flex-1 overflow-y-auto space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--theme-text-muted)" }}>
            Permissions for <span style={{ color: selected.role.color }}>{selected.role.name}</span>
          </p>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 items-center">
            <span className="text-xs font-medium" style={{ color: "var(--theme-text-secondary)" }}>Permission</span>
            <span className="text-xs text-center" style={{ color: "var(--theme-success)" }}>Allow</span>
            <span className="text-xs text-center" style={{ color: "var(--theme-danger)" }}>Deny</span>
            {PERM_LIST.map(({ key, label }) => (
              <>
                <span key={`${key}-label`} className="text-sm text-white">{label}</span>
                <Switch
                  key={`${key}-allow`}
                  checked={!!(selected.allow_permissions & PERMISSIONS[key])}
                  onCheckedChange={() => toggleAllow(key)}
                />
                <Switch
                  key={`${key}-deny`}
                  checked={!!(selected.deny_permissions & PERMISSIONS[key])}
                  onCheckedChange={() => toggleDeny(key)}
                />
              </>
            ))}
          </div>
          {/* Risk / conflict warnings */}
          {overwriteRisks.length > 0 && !riskDismissed && (
            <div className="mt-2 rounded border border-yellow-700 bg-yellow-900/20 p-2 space-y-1.5">
              <p className="text-xs font-semibold text-yellow-300 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Permission warnings
              </p>
              {overwriteRisks.map((risk) => (
                <div key={risk.code} className="text-xs text-zinc-300 leading-snug">
                  <span className={`inline-block px-1 py-0.5 rounded font-semibold mr-1 text-[10px] ${
                    risk.severity === "critical" ? "bg-red-900/50 text-red-300"
                    : risk.severity === "high" ? "bg-orange-900/50 text-orange-300"
                    : "bg-yellow-900/50 text-yellow-300"
                  }`}>{risk.severity.toUpperCase()}</span>
                  {risk.message}
                </div>
              ))}
              <button
                className="text-xs text-yellow-400 underline"
                onClick={() => setRiskDismissed(true)}
              >
                Dismiss
              </button>
            </div>
          )}
          <button
            onClick={save}
            disabled={saving || (overwriteRisks.some((r) => r.severity === "critical" || r.severity === "high") && !riskDismissed)}
            className="mt-3 px-3 py-1.5 rounded text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </button>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--theme-text-faint)" }}>
          Select a role to edit permissions
        </div>
      )}
    </div>
  )
}
