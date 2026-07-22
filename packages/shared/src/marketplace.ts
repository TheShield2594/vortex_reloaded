// ── Notification preferences ────────────────────────────────────────────────

/** Shape of user notification preferences stored in user_notification_preferences. */
export interface UserNotificationPreferences {
  mention_notifications: boolean
  reply_notifications: boolean
  friend_request_notifications: boolean
  server_invite_notifications: boolean
  system_notifications: boolean
  sound_enabled: boolean
  notification_volume: number
  suppress_everyone: boolean
  suppress_role_mentions: boolean
  quiet_hours_enabled: boolean
  quiet_hours_start: string
  quiet_hours_end: string
  quiet_hours_timezone: string
  push_notifications: boolean
  show_message_preview: boolean
  show_unread_badge: boolean
}

// ── App marketplace curation ────────────────────────────────────────────────

/** A curated app within a discovery section. */
export interface CuratedApp {
  id: string
  name: string
  slug: string
  description: string | null
  category: string
  trust_badge: "verified" | "partner" | "internal" | null
  average_rating: number
  review_count: number
  icon_url: string | null
}

/** A curated section on the app discover page (Featured, Trending, Staff Picks). */
export interface CuratedSection {
  id: string
  slug: string
  title: string
  description: string | null
  apps: CuratedApp[]
}

// ── Trust & permission transparency ────────────────────────────────────────

export type TrustBadgeType = "verified" | "partner" | "internal"

export interface TrustBadgeInfo {
  type: TrustBadgeType
  label: string
  description: string
  color: string
}

export const TRUST_BADGE_INFO: Record<TrustBadgeType, TrustBadgeInfo> = {
  verified: {
    type: "verified",
    label: "Verified",
    description: "Reviewed by the VortexChat team for security and quality. This developer's identity has been confirmed.",
    color: "emerald",
  },
  partner: {
    type: "partner",
    label: "Partner",
    description: "Built by an official VortexChat partner. Meets partnership quality and reliability standards.",
    color: "blue",
  },
  internal: {
    type: "internal",
    label: "Official",
    description: "Built and maintained by VortexChat. Fully integrated and guaranteed to follow platform policies.",
    color: "purple",
  },
}

export type PermissionImpactLevel = "low" | "medium" | "high" | "critical"

export interface PermissionMeta {
  key: string
  label: string
  description: string
  impact: PermissionImpactLevel
}

/** Map of app permission scope strings to their metadata and impact levels. */
export const APP_PERMISSION_META: Record<string, PermissionMeta> = {
  "read:messages": {
    key: "read:messages",
    label: "Read Messages",
    description: "View messages in channels the app is added to",
    impact: "low",
  },
  "read:members": {
    key: "read:members",
    label: "Read Member List",
    description: "View the server member list and basic profile info",
    impact: "low",
  },
  "send:messages": {
    key: "send:messages",
    label: "Send Messages",
    description: "Post messages on behalf of the app in channels",
    impact: "medium",
  },
  "manage:messages": {
    key: "manage:messages",
    label: "Manage Messages",
    description: "Edit and delete messages in channels",
    impact: "high",
  },
  "manage:channels": {
    key: "manage:channels",
    label: "Manage Channels",
    description: "Create, edit, and delete channels",
    impact: "high",
  },
  "manage:roles": {
    key: "manage:roles",
    label: "Manage Roles",
    description: "Create, edit, and assign roles to members",
    impact: "critical",
  },
  "manage:members": {
    key: "manage:members",
    label: "Manage Members",
    description: "Kick, ban, and moderate server members",
    impact: "critical",
  },
  "admin": {
    key: "admin",
    label: "Administrator",
    description: "Full administrative access to the server",
    impact: "critical",
  },
}

/** Returns the highest impact level from a list of permission scopes. */
export function getHighestImpact(permissions: string[]): PermissionImpactLevel {
  const levels: PermissionImpactLevel[] = ["low", "medium", "high", "critical"]
  let highest = 0
  for (const perm of permissions) {
    const meta = APP_PERMISSION_META[perm]
    if (meta) {
      const idx = levels.indexOf(meta.impact)
      if (idx > highest) highest = idx
    }
  }
  return levels[highest]
}

/** Whether a set of permissions requires explicit user confirmation before install. */
export function requiresInstallConfirmation(permissions: string[]): boolean {
  return permissions.some((p) => {
    const meta = APP_PERMISSION_META[p]
    return meta && (meta.impact === "high" || meta.impact === "critical")
  })
}
