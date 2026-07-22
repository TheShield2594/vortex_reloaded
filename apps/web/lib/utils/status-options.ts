/**
 * Canonical STATUS_OPTIONS array — replaces the 4 identical copies across:
 *   - components/settings/profile-settings-page.tsx
 *   - components/modals/profile-settings-modal.tsx
 *   - components/layout/user-panel.tsx
 *   - app/channels/you/page.tsx
 *
 * Also re-exports the already-existing helpers from lib/presence-status.ts.
 */
import type { UserRow } from "@/types/database"

export type SettableStatus = Exclude<UserRow["status"], "offline">

export const STATUS_OPTIONS: { value: SettableStatus; label: string; color: string }[] = [
  { value: "online", label: "Online", color: "var(--theme-success)" },
  { value: "idle", label: "Idle", color: "var(--theme-warning)" },
  { value: "dnd", label: "Do Not Disturb", color: "var(--theme-danger)" },
  { value: "invisible", label: "Invisible", color: "var(--theme-presence-offline)" },
]

export { getStatusColor, getStatusLabel } from "@/lib/presence-status"
