# Code Duplication Audit Report

Date: 2026-02-26

Scope reviewed: `apps/web`, `apps/signal`, `packages/shared`, `supabase/migrations`.

> Note: The automated third-party duplication scanner (`jscpd`) could not be installed in this environment due to npm registry policy (`403 Forbidden`), so this audit uses repository-local static inspection and targeted function-level matching.

## Findings

### 1) EXACT DUPLICATE — webhook CRUD helper functions in two modal components

**Locations**
- `handleCreate` duplicated between:
  - `apps/web/components/modals/server-settings-modal.tsx`
  - `apps/web/components/modals/webhooks-modal.tsx`
- `handleDelete` duplicated between same files.
- `copyUrl` duplicated between same files.
- `channelName` duplicated between same files.

**Measured duplication**
- Duplicated lines: `33` identical lines across these helper functions (`18 + 7 + 5 + 3`).
- Duplication density in smaller file (`webhooks-modal.tsx`): `33 / 170 = 19.4%`.
- Duplication density across both files combined: `33 / 2165 = 1.5%`.

**Importance**: **7/10**

**Extraction method**: module-level utility for webhook mutations + UI formatting helper.

**Drop-in DRY remediation**
```ts
// apps/web/lib/webhooks.ts
export async function createWebhook(channelId: string, name: string) { /* fetch POST ... */ }
export async function deleteWebhook(webhookId: string) { /* fetch DELETE ... */ }
export async function copyToClipboard(text: string) { return navigator.clipboard.writeText(text) }
export function formatChannelName(id: string | null, channels: { id: string; name: string }[]) {
  return channels.find((c) => c.id === id)?.name ?? "Unknown channel"
}
```
Then both modal components call these utilities and only handle local UI state/toasts.

**Estimated effort**: **S (1-2 hours)**.

---

### 2) EXACT DUPLICATE — DM call media toggles

**Locations**
- `toggleMute` duplicated between:
  - `apps/web/components/dm/dm-channel-area.tsx`
  - `apps/web/components/dm/dm-call.tsx`
- `toggleVideo` duplicated between same files.

**Measured duplication**
- Duplicated lines: `8` identical lines.
- Duplication density in `dm-call.tsx`: `8 / 351 = 2.3%`.
- Duplication density across both files combined: `8 / 1539 = 0.5%`.

**Importance**: **6/10**

**Extraction method**: React hook utility (`useCallMediaToggles`).

**Drop-in DRY remediation**
```ts
// apps/web/lib/webrtc/use-call-media-toggles.ts
export function useCallMediaToggles(setMuted: (v: boolean) => void, setVideoOff: (v: boolean) => void) {
  const toggleMute = () => setMuted((prev) => !prev)
  const toggleVideo = () => setVideoOff((prev) => !prev)
  return { toggleMute, toggleVideo }
}
```

**Estimated effort**: **S (30-60 minutes)**.

---

### 3) EXACT DUPLICATE (remediated) — presence/status mapping helpers across profile/member UI

**Previously duplicated locations**
- `getStatusColor` in:
  - `apps/web/components/user-profile-popover.tsx`
  - `apps/web/components/layout/member-list.tsx`
- `getStatusLabel` in:
  - `apps/web/components/user-profile-popover.tsx`
  - `apps/web/components/profile/profile-panel.tsx`

**Measured duplication (before fix)**
- `getStatusColor`: 100% identical between two files.
- `getStatusLabel`: 100% identical between two files.
- Approx. duplicated lines removed: `~22` lines.

**Importance**: **5/10**

**Extraction method**: shared utility module.

**Implemented DRY fix**
- Added `apps/web/lib/presence-status.ts` and migrated all three components to import shared helpers.

**Estimated effort**: **Completed (S, <30 minutes)**.

---

### 4) STRUCTURAL DUPLICATE — auth/permission/hierarchy flow repeated in member role assignment API

**Location**
- `apps/web/app/api/servers/[serverId]/members/[userId]/roles/route.ts`
  - `POST` and `DELETE` handlers repeat the same sequence:
    1. user auth check
    2. MANAGE_ROLES check
    3. role hierarchy constraint for non-admin

**Measured duplication**
- Shared structure appears in ~`34` lines in both handlers.
- Duplication density in file: `34 / 142 = 23.9%` (near-duplicate pattern, not byte-identical due to message/action differences).

**Importance**: **8/10**

**Extraction method**: route-local helper module (`assertRoleMutationAllowed`).

**Drop-in DRY remediation**
```ts
async function assertRoleMutationAllowed(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  serverId: string,
  actorUserId: string,
  roleId: string,
  denyMessage: string,
) {
  const { isAdmin, permissions } = await getMemberPermissions(supabase, serverId, actorUserId)
  if (!isAdmin && !hasPermission(permissions, "MANAGE_ROLES")) {
    return NextResponse.json({ error: "Missing MANAGE_ROLES permission" }, { status: 403 })
  }
  if (isAdmin) return null

  const [{ data: targetRole }, actorMaxPosition] = await Promise.all([
    supabase.from("roles").select("position").eq("id", roleId).eq("server_id", serverId).single(),
    getActorMaxRolePosition(supabase, serverId, actorUserId),
  ])
  if (!targetRole) return NextResponse.json({ error: "Role not found" }, { status: 404 })
  if (targetRole.position >= actorMaxPosition) {
    return NextResponse.json({ error: denyMessage }, { status: 403 })
  }
  return null
}
```

**Estimated effort**: **M (2-4 hours including tests)**.

---

### 5) DATA DUPLICATION — report status enum duplicated between API and UI

**Locations**
- `apps/web/app/api/reports/route.ts`: `VALID_STATUSES` and transition list.
- `apps/web/components/settings/reports-tab.tsx`: `STATUS_FILTERS` and `getStatusIcon` switch use same status keys.

**Measured duplication**
- Status literals duplicated: `pending`, `reviewed`, `resolved`, `dismissed` (4/4 overlap = **100% enum duplication**).
- This is semantic duplication that risks drift between API validation and UI filters.

**Importance**: **7/10**

**Extraction method**: shared constant/type module in `apps/web/lib/report-status.ts`.

**Drop-in DRY remediation**
```ts
// apps/web/lib/report-status.ts
export const REPORT_STATUSES = ["pending", "reviewed", "resolved", "dismissed"] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]
```
Use this constant in both API (`includes`) and UI filters/icon mapping.

**Estimated effort**: **S (1 hour)**.

---

## Unable to verify

- Full-file clone detection for SQL migrations and all TS/TSX blocks with token-level thresholds was **unable to verify** using an external scanner due to package install restrictions in this environment.
- Evidence that would improve confidence: successful run of `jscpd`/Sonar clone report in CI.

## Summary recommendations (priority order)

1. Extract role-mutation authorization/hierarchy guard (`8/10`).
2. De-duplicate webhook modal handlers (`7/10`).
3. Centralize report statuses (`7/10`).
4. Extract call media toggle hook (`6/10`).
5. Keep status label/color mapping centralized (already completed in this patch).
