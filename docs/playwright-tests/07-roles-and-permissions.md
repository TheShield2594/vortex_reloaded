# 07 — Roles & Permissions

> Covers: role CRUD, permission bitmask management, role hierarchy, role assignment, channel permission overrides, permission sandbox, `@vortex/shared` permissions module.

**Components under test:**
- `role-manager.tsx`, `channel-permissions-editor.tsx`, `permission-sandbox.tsx`
- API: `/api/servers/[serverId]/roles`, `/api/servers/[serverId]/roles/[roleId]`
- API: `/api/servers/[serverId]/roles/reorder`
- API: `/api/servers/[serverId]/members/[userId]/roles`
- API: `/api/channels/[channelId]/permissions`
- `packages/shared/src/index.ts` — permission utilities

---

## 7.1 Role CRUD

### `role-crud.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should list all server roles | Server settings → Roles | Roles listed with colors and member counts |
| 2 | should create a new role | Click "Create Role" → name + color → save | Role created |
| 3 | should edit role name and color | Click role → change name/color → save | Updated |
| 4 | should delete a role | Click delete → confirm | Role removed; members lose that role |
| 5 | should set role permissions via bitmask toggles | Toggle permissions → save | Bitmask updated |
| 6 | should show all permission categories | View role editor | All permission toggles visible |
| 7 | should require MANAGE_ROLES permission | Login as regular user | Roles section hidden |
| 8 | should not allow editing roles above own highest role | Mod tries to edit Admin role | Edit blocked |

---

## 7.2 Role Assignment

### `role-assignment.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should assign role to member | Member → Roles → check role | Role assigned; audit log |
| 2 | should remove role from member | Uncheck role | Role removed; audit log |
| 3 | should show member's roles in profile | View user profile | Roles displayed |
| 4 | should show role color on member name | View chat/member list | Name colored by highest role |
| 5 | should not allow assigning role above own | Mod tries to assign Admin | Blocked |

---

## 7.3 Role Hierarchy & Reordering

### `role-hierarchy.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should reorder roles via drag-and-drop | Drag role to new position | Order updated |
| 2 | should enforce hierarchy in mod actions | Lower role tries to ban higher role | Action blocked |
| 3 | should enforce hierarchy in role assignment | Lower role tries to give higher role | Blocked |
| 4 | should show @everyone role at bottom | View roles | @everyone is last |

---

## 7.4 Permission Enforcement

### `permission-enforcement.spec.ts`

> Critical tests — verifies permissions are checked BEFORE data operations.

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should block message send without SEND_MESSAGES | Remove permission → try sending | 403; input disabled |
| 2 | should block channel view without VIEW_CHANNELS | Remove permission → navigate | Channel hidden/403 |
| 3 | should block file upload without ATTACH_FILES | Remove permission → try upload | Upload blocked |
| 4 | should block emoji management without MANAGE_EMOJIS | Login without permission → try upload | 403 |
| 5 | should block ban without BAN_MEMBERS | Login without permission → try ban | 403 |
| 6 | should block kick without KICK_MEMBERS | Login without permission → try kick | 403 |
| 7 | should block role edit without MANAGE_ROLES | Login without permission → try edit | 403 |
| 8 | should block channel create without MANAGE_CHANNELS | Login without permission → try create | 403 |
| 9 | should block webhook management without MANAGE_WEBHOOKS | Login without permission → try create | 403 |
| 10 | should allow ADMINISTRATOR to bypass all checks | Login as admin → do everything | All allowed |
| 11 | should block voice connect without CONNECT_VOICE | Login without permission → try join | Join blocked |
| 12 | should block speaking without SPEAK | Login without permission → unmute | Unmute blocked |

---

## 7.5 Channel Permission Overrides

### `channel-permission-overrides.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should set role-specific channel override | Channel settings → Permissions → set override | Override saved |
| 2 | should override server-level permissions | Deny SEND_MESSAGES in channel for role | That role can't send in this channel |
| 3 | should allow per-channel view override | Hide channel from specific role | Role can't see channel |
| 4 | should show effective permissions | View calculated permissions | Correct final permissions shown |
| 5 | should inherit from server when no override | No override set | Server permissions apply |

---

## 7.6 Permission Sandbox

### `permission-sandbox.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open permission sandbox | Admin tools → Permission Sandbox | Sandbox UI opens |
| 2 | should simulate user's effective permissions | Select user → view | All effective permissions shown |
| 3 | should show permission source (role, channel, override) | View permission details | Source indicated |
| 4 | should test permission for specific channel | Select channel → select user | Channel-specific result |

---

## 7.7 Shared Permission Utilities

### `shared-permissions.spec.ts`

> Unit-level tests for `packages/shared` — can run as Playwright API tests.

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should correctly compute hasPermission() for single permission | Call `hasPermission(bitmask, "SEND_MESSAGES")` from `@vortex/shared` | Correct boolean |
| 2 | should correctly compute hasPermission() for ADMINISTRATOR | Call `hasPermission(adminMask, "SEND_MESSAGES")` | Always true (ADMINISTRATOR bypasses) |
| 3 | should correctly compute addPermission() | Call `addPermission(bitmask, "MANAGE_MESSAGES")` | Bit set |
| 4 | should correctly compute removePermission() | Call `removePermission(bitmask, "MANAGE_MESSAGES")` | Bit cleared |
| 5 | should never import permissions from anywhere except @vortex/shared | Grep codebase | No hardcoded permission bits |
