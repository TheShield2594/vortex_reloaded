"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Plus, Trash2, Loader2, X } from "lucide-react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import type { RoleRow, UserRow } from "@/types/database"
import { PERMISSIONS, type Permission } from "@vortex/shared"
import { detectRolePermissionRisks, type PermissionRisk } from "@/lib/permission-simulation"

interface PermissionEntry {
  key: Permission
  label: string
  description: string
}

interface PermissionCategory {
  label: string
  perms: PermissionEntry[]
}

const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    label: "General Server",
    perms: [
      { key: "ADMINISTRATOR",           label: "Administrator",            description: "All permissions — bypasses every other check" },
      { key: "MANAGE_CHANNELS",         label: "Manage Channels",          description: "Create, edit, and delete channels" },
      { key: "MANAGE_ROLES",            label: "Manage Roles",             description: "Create, edit, and assign roles below this one" },
      { key: "MANAGE_WEBHOOKS",         label: "Manage Webhooks",          description: "Create and delete webhooks" },
      { key: "MANAGE_EVENTS",           label: "Manage Events",            description: "Create, edit, and cancel server events" },
      { key: "MANAGE_EMOJIS",           label: "Manage Emojis",            description: "Upload, edit, and delete custom server emojis" },
      { key: "VIEW_CHANNELS",           label: "View Channels",            description: "See channels and receive messages" },
    ],
  },
  {
    label: "Membership",
    perms: [
      { key: "KICK_MEMBERS",            label: "Kick Members",             description: "Remove members from the server" },
      { key: "BAN_MEMBERS",             label: "Ban Members",              description: "Permanently ban members and revoke their invite links" },
      { key: "MODERATE_MEMBERS",        label: "Moderate Members (Timeout)", description: "Temporarily prevent members from interacting" },
    ],
  },
  {
    label: "Text Channels",
    perms: [
      { key: "SEND_MESSAGES",           label: "Send Messages",            description: "Post in text channels" },
      { key: "MENTION_EVERYONE",        label: "Mention @everyone / @here", description: "Ping all server members at once" },
      { key: "MANAGE_MESSAGES",         label: "Manage Messages",          description: "Delete or pin others' messages" },
      { key: "CREATE_PUBLIC_THREADS",   label: "Create Public Threads",    description: "Start new public thread conversations" },
      { key: "CREATE_PRIVATE_THREADS",  label: "Create Private Threads",   description: "Start new invite-only thread conversations" },
      { key: "SEND_MESSAGES_IN_THREADS", label: "Send Messages in Threads", description: "Participate in thread conversations" },
      { key: "USE_APPLICATION_COMMANDS", label: "Use Application Commands", description: "Use slash commands and bots" },
    ],
  },
  {
    label: "Voice Channels",
    perms: [
      { key: "CONNECT_VOICE",           label: "Connect to Voice",         description: "Join voice channels" },
      { key: "SPEAK",                   label: "Speak",                    description: "Transmit audio in voice channels" },
      { key: "MUTE_MEMBERS",            label: "Mute Members",             description: "Server-mute others in voice channels" },
      { key: "STREAM",                  label: "Stream / Share Screen",    description: "Share video or screen in voice channels" },
    ],
  },
]

/** Permissions that cannot be removed from the default (@everyone) role. */
const DEFAULT_ROLE_LOCKED: Set<Permission> = new Set(["VIEW_CHANNELS", "SEND_MESSAGES"])

interface Props {
  serverId: string
  isOwner: boolean
}

/** Server role management panel with CRUD for roles, granular permission toggles, and role-member assignment. */
export function RoleManager({ serverId, isOwner }: Props) {
  const { toast } = useToast()
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [selectedRole, setSelectedRole] = useState<RoleRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editName, setEditName] = useState("")
  const [editColor, setEditColor] = useState("#99aab5")
  const [editPermissions, setEditPermissions] = useState(0)
  const [editHoisted, setEditHoisted] = useState(false)
  const [editMentionable, setEditMentionable] = useState(false)
  const [roleMembers, setRoleMembers] = useState<UserRow[]>([])
  const [allMembers, setAllMembers] = useState<(UserRow & { user_id: string })[]>([])
  const [showAddMember, setShowAddMember] = useState(false)
  const [permRisks, setPermRisks] = useState<PermissionRisk[]>([])
  const [riskDismissed, setRiskDismissed] = useState(false)
  const supabase = useMemo(() => createClientSupabaseClient(), [])

  useEffect(() => {
    fetchRoles()
    fetchAllMembers()
  }, [serverId])

  async function fetchRoles() {
    setLoading(true)
    const { data } = await supabase
      .from("roles")
      .select("*")
      .eq("server_id", serverId)
      .order("position", { ascending: false })
    setRoles(data ?? [])
    setLoading(false)
  }

  async function fetchAllMembers() {
    try {
      const res = await fetch(`/api/servers/${encodeURIComponent(serverId)}/members`, { credentials: "include" })
      if (!res.ok) return
      type ApiMember = { user_id: string; user: UserRow | null }
      const data: ApiMember[] = await res.json()
      setAllMembers(
        data
          .filter((m) => m.user !== null)
          .map((m) => ({ ...m.user!, user_id: m.user_id }))
      )
    } catch {
      // silently ignore — list stays empty
    }
  }

  async function fetchRoleMembers(roleId: string) {
    const { data } = await supabase
      .from("member_roles")
      .select("user_id, users(*)")
      .eq("server_id", serverId)
      .eq("role_id", roleId)
    type RoleMemberWithUser = { user_id: string; users: UserRow | null }
    setRoleMembers(
      ((data ?? []) as unknown as RoleMemberWithUser[])
        .map((m) => m.users)
        .filter((u): u is UserRow => u !== null)
    )
  }

  function selectRole(role: RoleRow) {
    setSelectedRole(role)
    setEditName(role.name)
    setEditColor(role.color)
    setEditPermissions(role.permissions)
    setEditHoisted(role.is_hoisted)
    setEditMentionable(role.mentionable)
    setShowAddMember(false)
    setPermRisks([])
    setRiskDismissed(false)
    if (!role.is_default) {
      fetchRoleMembers(role.id)
    } else {
      setRoleMembers([])
    }
  }

  async function handleAddMemberToRole(userId: string) {
    if (!selectedRole) return
    try {
      const { error } = await supabase
        .from("member_roles")
        .insert({ server_id: serverId, user_id: userId, role_id: selectedRole.id })
      if (error) throw error
      await fetchRoleMembers(selectedRole.id)
      setShowAddMember(false)
      toast({ title: "Member added to role" })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to add member", description: error instanceof Error ? error.message : "Unknown error" })
    }
  }

  async function handleRemoveMemberFromRole(userId: string) {
    if (!selectedRole) return
    try {
      const { error } = await supabase
        .from("member_roles")
        .delete()
        .eq("server_id", serverId)
        .eq("user_id", userId)
        .eq("role_id", selectedRole.id)
      if (error) throw error
      setRoleMembers((prev) => prev.filter((m) => m.id !== userId))
      toast({ title: "Member removed from role" })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to remove member", description: error instanceof Error ? error.message : "Unknown error" })
    }
  }

  function togglePermission(permission: Permission) {
    const bit = PERMISSIONS[permission]
    setEditPermissions((prev) => {
      const next = prev & bit ? prev & ~bit : prev | bit
      setPermRisks(detectRolePermissionRisks(next, selectedRole?.permissions ?? 0, selectedRole?.is_default ?? false))
      setRiskDismissed(false)
      return next
    })
  }

  async function handleCreateRole() {
    try {
      const { data, error } = await supabase
        .from("roles")
        .insert({
          server_id: serverId,
          name: "New Role",
          color: "#99aab5",
          permissions: 3,
          position: roles.length,
        })
        .select()
        .single()

      if (error) throw error
      const newRoles = [data, ...roles]
      setRoles(newRoles)
      selectRole(data)
      toast({ title: "Role created!" })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to create role", description: error instanceof Error ? error.message : "Unknown error" })
    }
  }

  async function handleSaveRole() {
    if (!selectedRole) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from("roles")
        .update({
          name: editName,
          color: editColor,
          permissions: editPermissions,
          is_hoisted: editHoisted,
          mentionable: editMentionable,
        })
        .eq("id", selectedRole.id)

      if (error) throw error

      setRoles(roles.map((r) => r.id === selectedRole.id
        ? { ...r, name: editName, color: editColor, permissions: editPermissions, is_hoisted: editHoisted, mentionable: editMentionable }
        : r
      ))
      toast({ title: "Role saved!" })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to save role", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteRole(roleId: string) {
    try {
      const { error } = await supabase.from("roles").delete().eq("id", roleId)
      if (error) throw error
      setRoles(roles.filter((r) => r.id !== roleId))
      if (selectedRole?.id === roleId) setSelectedRole(null)
      toast({ title: "Role deleted" })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to delete role", description: error instanceof Error ? error.message : "Unknown error" })
    }
  }

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} /></div>
  }

  return (
    <div className="flex gap-4 h-full min-h-[28rem]">
      {/* Role list */}
      <div className="w-40 flex-shrink-0">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Roles</span>
          {isOwner && (
            <button onClick={handleCreateRole} style={{ color: 'var(--theme-success)' }}>
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="space-y-0.5 overflow-y-auto max-h-80">
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => selectRole(role)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors"
              style={{
                background: selectedRole?.id === role.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: 'var(--theme-text-primary)',
              }}
            >
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: role.color }} />
              <span className="truncate">{role.name}</span>
              {role.is_default && (
                <span className="ml-auto text-xs" style={{ color: 'var(--theme-text-muted)' }}>default</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Role editor */}
      {selectedRole ? (
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
              Role Name
            </Label>
            <div className="flex items-center gap-3">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={selectedRole.is_default}
                className="flex-1"
                style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)' }}
              />
              <div className="flex items-center gap-2 flex-shrink-0">
                <input
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="w-9 h-9 rounded cursor-pointer border-0 p-0.5"
                  style={{ background: 'var(--theme-bg-tertiary)' }}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <Switch checked={editHoisted} onCheckedChange={setEditHoisted} disabled={selectedRole.is_default} />
              <Label className="text-sm text-white whitespace-nowrap">Hoist (show separately)</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={editMentionable} onCheckedChange={setEditMentionable} disabled={selectedRole.is_default} />
              <Label className="text-sm text-white">Mentionable</Label>
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: 'var(--theme-text-secondary)' }}>
              Permissions
            </Label>
            <div className="space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100% - 2rem)' }}>
              {PERMISSION_CATEGORIES.map(({ label: catLabel, perms }) => (
                <div key={catLabel}>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-accent)' }}>
                    {catLabel}
                  </div>
                  <div className="space-y-1">
                    {perms.map(({ key, label, description }) => (
                      <div key={key} className="flex items-center justify-between py-1">
                        <div>
                          <div className="text-sm font-medium text-white">{label}</div>
                          <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{description}</div>
                        </div>
                        <Switch
                          checked={!!(editPermissions & PERMISSIONS[key])}
                          onCheckedChange={() => togglePermission(key)}
                          disabled={selectedRole.is_default && DEFAULT_ROLE_LOCKED.has(key)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Members with this role */}
          {!selectedRole.is_default && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
                  Members — {roleMembers.length}
                </Label>
                {isOwner && (
                  <button
                    onClick={() => setShowAddMember(!showAddMember)}
                    className="text-xs px-2 py-1 rounded transition-colors hover:bg-white/10"
                    style={{ color: 'var(--theme-success)' }}
                  >
                    <Plus className="w-3.5 h-3.5 inline mr-1" />
                    Add
                  </button>
                )}
              </div>

              {showAddMember && (() => {
                const availableMembers = allMembers.filter((m) => !roleMembers.some((rm) => rm.id === m.id))
                return (
                <div className="mb-2 p-2 rounded space-y-1 max-h-32 overflow-y-auto" style={{ background: 'var(--theme-bg-tertiary)' }}>
                  {availableMembers.map((member) => (
                      <button
                        key={member.id}
                        onClick={() => handleAddMemberToRole(member.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-white/10 transition-colors"
                        style={{ color: 'var(--theme-text-primary)' }}
                      >
                        <Avatar className="w-5 h-5">
                          {member.avatar_url && <AvatarImage src={member.avatar_url} />}
                          <AvatarFallback style={{ background: 'var(--theme-accent)', color: 'white', fontSize: '10px' }}>
                            {(member.display_name || member.username).slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span>{member.display_name || member.username}</span>
                      </button>
                    ))}
                  {availableMembers.length === 0 && (
                    <p className="text-xs text-center py-1" style={{ color: 'var(--theme-text-muted)' }}>All members have this role</p>
                  )}
                </div>
                )
              })()}

              <div className="space-y-1 max-h-28 overflow-y-auto">
                {roleMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded text-sm group"
                    style={{ background: 'var(--theme-bg-secondary)', color: 'var(--theme-text-primary)' }}
                  >
                    <Avatar className="w-5 h-5">
                      {member.avatar_url && <AvatarImage src={member.avatar_url} />}
                      <AvatarFallback style={{ background: 'var(--theme-accent)', color: 'white', fontSize: '10px' }}>
                        {(member.display_name || member.username).slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 truncate">{member.display_name || member.username}</span>
                    {isOwner && (
                      <button
                        onClick={() => handleRemoveMemberFromRole(member.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: 'var(--theme-danger)' }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {roleMembers.length === 0 && (
                  <p className="text-xs py-1" style={{ color: 'var(--theme-text-muted)' }}>No members have this role</p>
                )}
              </div>
            </div>
          )}

          {/* Risk / conflict warnings */}
          {permRisks.length > 0 && !riskDismissed && (
            <div className="rounded-md border border-yellow-700 bg-yellow-900/20 p-3 space-y-2">
              <p className="text-xs font-semibold text-yellow-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                Permission warnings — review before saving
              </p>
              {permRisks.map((risk) => (
                <div key={risk.code} className="text-xs space-y-0.5">
                  <span className={`inline-block px-1.5 py-0.5 rounded font-semibold mr-1.5 ${
                    risk.severity === "critical"
                      ? "bg-red-900/50 text-red-300"
                      : risk.severity === "high"
                        ? "bg-orange-900/50 text-orange-300"
                        : "bg-yellow-900/50 text-yellow-300"
                  }`}>
                    {risk.severity.toUpperCase()}
                  </span>
                  <span className="text-zinc-300">{risk.message}</span>
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="text-yellow-400 text-xs"
                onClick={() => setRiskDismissed(true)}
              >
                I understand — dismiss warnings
              </Button>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {!selectedRole.is_default && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDeleteRole(selectedRole.id)}
                style={{ color: 'var(--theme-danger)' }}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSaveRole}
              disabled={saving || (permRisks.some((r) => r.severity === "critical" || r.severity === "high") && !riskDismissed)}
              style={{ background: 'var(--theme-accent)' }}
              className="ml-auto"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--theme-text-muted)' }}>
          Select a role to edit
        </div>
      )}
    </div>
  )
}
