import { PERMISSIONS } from "@vortex/shared"
import type { LucideIcon } from "lucide-react"
import { Gamepad2, BookOpen, Rocket, Video } from "lucide-react"

export type TemplatePermissionInput = number | string[]

export interface TemplateMeta {
  icon: LucideIcon
  color: string
  description: string
}

export type StarterTemplateKey = "Gaming" | "Study" | "Startup" | "Creator"

/**
 * UI metadata for each starter template. Co-located with STARTER_TEMPLATES
 * so adding a new template requires updating both in the same file.
 */
export const TEMPLATE_META: Record<StarterTemplateKey, TemplateMeta> = {
  Gaming: { icon: Gamepad2, color: "#5865F2", description: "Voice channels, LFG, and squad rooms" },
  Study: { icon: BookOpen, color: "#57F287", description: "Announcements, homework help, focus rooms" },
  Startup: { icon: Rocket, color: "#FEE75C", description: "All-hands, product, and dev-sync channels" },
  Creator: { icon: Video, color: "#EB459E", description: "News, fan chat, and creator lounge" },
}

export interface TemplateMetadata {
  source: string
  version: string
  created_by: string
}

export interface TemplateRole {
  name: string
  color?: string
  position?: number
  permissions: TemplatePermissionInput
  is_hoisted?: boolean
  mentionable?: boolean
  is_default?: boolean
}

export interface TemplateChannelPermission {
  role: string
  allow?: TemplatePermissionInput
  deny?: TemplatePermissionInput
}

export interface TemplateChannel {
  name: string
  type?: "text" | "voice" | "forum" | "stage" | "announcement" | "media"
  category?: string
  position?: number
  topic?: string
  slowmode_delay?: number
  nsfw?: boolean
  forum_guidelines?: string
  permissions?: TemplateChannelPermission[]
}

export interface TemplateCategory {
  name: string
  position?: number
}

export interface ServerTemplate {
  name?: string
  description?: string
  metadata: TemplateMetadata
  roles: TemplateRole[]
  categories: TemplateCategory[]
  channels: TemplateChannel[]
}

const PERMISSION_ALIASES: Record<string, keyof typeof PERMISSIONS> = {
  VIEW_CHANNEL: "VIEW_CHANNELS",
  SEND_MESSAGE: "SEND_MESSAGES",
  MANAGE_MESSAGE: "MANAGE_MESSAGES",
  CONNECT: "CONNECT_VOICE",
  SPEAK_VOICE: "SPEAK",
}

const PERMISSION_KEYS = new Set(Object.keys(PERMISSIONS))

export function normalizePermissionInput(input: TemplatePermissionInput | undefined): { value: number; warnings: string[] } {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return { value: 0, warnings: ["Permission number was invalid and reset to 0"] }
    return { value: Math.floor(input), warnings: [] }
  }

  if (!Array.isArray(input)) return { value: 0, warnings: [] }

  let bitmask = 0
  const warnings: string[] = []
  for (const raw of input) {
    const key = String(raw).trim().toUpperCase()
    const canonical = PERMISSION_KEYS.has(key) ? key as keyof typeof PERMISSIONS : PERMISSION_ALIASES[key]
    if (!canonical) {
      warnings.push(`Unsupported permission \"${raw}\" was ignored`)
      continue
    }
    bitmask |= PERMISSIONS[canonical]
  }
  return { value: bitmask, warnings }
}

export function validateAndNormalizeTemplate(payload: unknown): { template: ServerTemplate | null; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  if (!payload || typeof payload !== "object") return { template: null, errors: ["Template payload must be a JSON object"], warnings }

  const raw = payload as Record<string, unknown>
  const metadata = raw.metadata as Record<string, unknown> | undefined
  if (!metadata || typeof metadata !== "object") {
    errors.push("metadata is required")
  }

  const rolesRaw = Array.isArray(raw.roles) ? raw.roles : []
  if (rolesRaw.length === 0) errors.push("At least one role is required")
  const roles: TemplateRole[] = rolesRaw.flatMap((role, index) => {
    if (!role || typeof role !== "object") {
      errors.push(`roles[${index}] must be an object`)
      return []
    }
    const r = role as Record<string, unknown>
    const name = String(r.name ?? "").trim()
    if (!name) errors.push(`roles[${index}].name is required`)
    const normalizedPerms = normalizePermissionInput(r.permissions as TemplatePermissionInput)
    warnings.push(...normalizedPerms.warnings.map((w) => `roles[${index}]: ${w}`))
    return [{
      name,
      color: typeof r.color === "string" ? r.color : "#99AAB5",
      position: typeof r.position === "number" ? r.position : index,
      permissions: normalizedPerms.value,
      is_hoisted: !!r.is_hoisted,
      mentionable: !!r.mentionable,
      is_default: !!r.is_default,
    }]
  })

  const categoriesRaw = Array.isArray(raw.categories) ? raw.categories : []
  const categories: TemplateCategory[] = categoriesRaw.flatMap((cat, index) => {
    if (!cat || typeof cat !== "object") {
      errors.push(`categories[${index}] must be an object`)
      return []
    }
    const c = cat as Record<string, unknown>
    const name = String(c.name ?? "").trim()
    if (!name) errors.push(`categories[${index}].name is required`)
    return [{ name, position: typeof c.position === "number" ? c.position : index }]
  })

  const channelsRaw = Array.isArray(raw.channels) ? raw.channels : []
  if (channelsRaw.length === 0) errors.push("At least one channel is required")
  const validTypes = new Set(["text", "voice", "forum", "stage", "announcement", "media"])

  const channels: TemplateChannel[] = channelsRaw.flatMap((chan, index) => {
    if (!chan || typeof chan !== "object") {
      errors.push(`channels[${index}] must be an object`)
      return []
    }
    const c = chan as Record<string, unknown>
    const name = String(c.name ?? "").trim()
    const type = typeof c.type === "string" ? c.type : "text"
    if (!name) errors.push(`channels[${index}].name is required`)
    if (!validTypes.has(type)) {
      warnings.push(`channels[${index}].type \"${type}\" unsupported, defaulted to text`)
    }

    const permissionsRaw = Array.isArray(c.permissions) ? c.permissions : []
    const permissions: TemplateChannelPermission[] = permissionsRaw.flatMap((p, pIndex) => {
      if (!p || typeof p !== "object") {
        warnings.push(`channels[${index}].permissions[${pIndex}] ignored (not an object)`)
        return []
      }
      const permissionObj = p as Record<string, unknown>
      const role = String(permissionObj.role ?? "").trim()
      if (!role) {
        warnings.push(`channels[${index}].permissions[${pIndex}] ignored (missing role)`)
        return []
      }
      const allow = normalizePermissionInput(permissionObj.allow as TemplatePermissionInput)
      const deny = normalizePermissionInput(permissionObj.deny as TemplatePermissionInput)
      warnings.push(...allow.warnings.map((w) => `channels[${index}](${role}) allow: ${w}`))
      warnings.push(...deny.warnings.map((w) => `channels[${index}](${role}) deny: ${w}`))
      return [{ role, allow: allow.value, deny: deny.value }]
    })

    return [{
      name,
      type: validTypes.has(type) ? type as TemplateChannel["type"] : "text",
      category: typeof c.category === "string" ? c.category : undefined,
      position: typeof c.position === "number" ? c.position : index,
      topic: typeof c.topic === "string" ? c.topic : undefined,
      slowmode_delay: typeof c.slowmode_delay === "number" ? c.slowmode_delay : 0,
      nsfw: !!c.nsfw,
      forum_guidelines: typeof c.forum_guidelines === "string" ? c.forum_guidelines : undefined,
      permissions,
    }]
  })

  const roleNames = new Set(roles.map((r) => r.name.toLowerCase()))
  for (const [index, channel] of channels.entries()) {
    if (channel.category && !categories.some((cat) => cat.name.toLowerCase() === channel.category!.toLowerCase())) {
      warnings.push(`channels[${index}] references missing category \"${channel.category}\" and will be placed at root`)
      delete channel.category
    }
    for (const perm of channel.permissions ?? []) {
      if (!roleNames.has(perm.role.toLowerCase())) {
        warnings.push(`channels[${index}] permission for unknown role \"${perm.role}\" ignored at apply time`)
      }
    }
  }

  if (errors.length > 0) return { template: null, errors, warnings }

  return {
    template: {
      name: typeof raw.name === "string" ? raw.name : undefined,
      description: typeof raw.description === "string" ? raw.description : undefined,
      metadata: {
        source: String(metadata?.source ?? "custom"),
        version: String(metadata?.version ?? "1.0.0"),
        created_by: String(metadata?.created_by ?? "unknown"),
      },
      roles,
      categories,
      channels,
    },
    errors,
    warnings,
  }
}

export const STARTER_TEMPLATES: Record<StarterTemplateKey, ServerTemplate> = {
  Gaming: {
    metadata: { source: "builtin", version: "1.0.0", created_by: "vortex" },
    roles: [
      { name: "@everyone", permissions: ["VIEW_CHANNELS", "SEND_MESSAGES", "CONNECT_VOICE", "SPEAK"], is_default: true },
      { name: "Mods", color: "#FEE75C", permissions: ["MANAGE_MESSAGES", "KICK_MEMBERS", "BAN_MEMBERS"] },
    ],
    categories: [{ name: "Lobby" }, { name: "Games" }],
    channels: [
      { name: "welcome", category: "Lobby", type: "text" },
      { name: "lfg", category: "Games", type: "text" },
      { name: "Squad Voice", category: "Games", type: "voice" },
    ],
  },
  Study: {
    metadata: { source: "builtin", version: "1.0.0", created_by: "vortex" },
    roles: [{ name: "@everyone", permissions: ["VIEW_CHANNELS", "SEND_MESSAGES", "CONNECT_VOICE", "SPEAK"], is_default: true }],
    categories: [{ name: "General" }, { name: "Subjects" }],
    channels: [
      { name: "announcements", category: "General", type: "announcement" },
      { name: "homework-help", category: "Subjects", type: "text" },
      { name: "focus-room", category: "General", type: "voice" },
    ],
  },
  Startup: {
    metadata: { source: "builtin", version: "1.0.0", created_by: "vortex" },
    roles: [
      { name: "@everyone", permissions: ["VIEW_CHANNELS", "SEND_MESSAGES"], is_default: true },
      { name: "Team", color: "#57F287", permissions: ["MANAGE_CHANNELS", "MANAGE_MESSAGES"] },
    ],
    categories: [{ name: "Company" }, { name: "Engineering" }],
    channels: [
      { name: "all-hands", category: "Company", type: "announcement" },
      { name: "product", category: "Company", type: "text" },
      { name: "dev-sync", category: "Engineering", type: "voice" },
    ],
  },
  Creator: {
    metadata: { source: "builtin", version: "1.0.0", created_by: "vortex" },
    roles: [
      { name: "@everyone", permissions: ["VIEW_CHANNELS", "SEND_MESSAGES"], is_default: true },
      { name: "VIP", color: "#EB459E", permissions: ["VIEW_CHANNELS", "SEND_MESSAGES", "CONNECT_VOICE"] },
    ],
    categories: [{ name: "Community" }, { name: "Content" }],
    channels: [
      { name: "news", category: "Community", type: "announcement" },
      { name: "fan-chat", category: "Community", type: "text" },
      { name: "creator-lounge", category: "Content", type: "voice" },
    ],
  },
}
