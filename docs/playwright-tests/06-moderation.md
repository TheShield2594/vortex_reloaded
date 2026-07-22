# 06 — Moderation & AutoMod

> Covers: ban, kick, mute, timeout, audit log, content screening, AutoMod rules, moderation timeline, reports, appeals, mod ledger, transparency panel.

**Components under test:**
- `mod-ledger.tsx`, `audit-log-page.tsx`, `audit-log-viewer.tsx`
- `transparency-panel.tsx`, `report-modal.tsx`
- Pages: `channels/[serverId]/moderation/page.tsx`, `channels/[serverId]/moderation/target/[targetId]/page.tsx`
- Page: `appeals/page.tsx`
- API: `/api/servers/[serverId]/moderation`, `/api/servers/[serverId]/moderation/timeline`
- API: `/api/servers/[serverId]/audit-log`, `/api/servers/[serverId]/bans`
- API: `/api/servers/[serverId]/automod`, `/api/servers/[serverId]/automod/[ruleId]`
- API: `/api/servers/[serverId]/screening`, `/api/servers/[serverId]/screening/accept`
- API: `/api/servers/[serverId]/members/[userId]/timeout`
- API: `/api/reports`, `/api/appeals`, `/api/appeals/[appealId]`
- API: `/api/servers/[serverId]/appeals`, `/api/servers/[serverId]/appeal-templates`

---

## 6.1 Banning Members

### `mod-ban.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should ban a member | Moderation → select user → Ban → enter reason → confirm | Member banned; removed from server |
| 2 | should create audit log entry for ban | Ban user | `ban_member` entry in audit log with actorId, targetId, reason, timestamp |
| 3 | should show ban in moderation timeline | View timeline | Ban event visible |
| 4 | should prevent banned user from rejoining | Banned user tries to join via invite | Join rejected |
| 5 | should list all bans | Moderation → Bans | Ban list shown |
| 6 | should unban a user | Select banned user → Unban | User unbanned; audit log entry |
| 7 | should require BAN_MEMBERS permission | Login as regular user → try ban | Action blocked |
| 8 | should not allow banning user with higher role | Mod tries to ban admin | Action blocked |
| 9 | should log attempted ban in error path | Failed ban attempt | Audit entry for attempt |
| 10 | should optionally delete message history on ban | Check "Delete messages" → ban | Recent messages purged |

---

## 6.2 Kicking Members

### `mod-kick.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should kick a member | Right-click → Kick → enter reason → confirm | Member removed from server |
| 2 | should create audit log entry | Kick user | `kick_member` audit entry |
| 3 | should allow kicked user to rejoin | Kicked user uses invite | Rejoins successfully |
| 4 | should require KICK_MEMBERS permission | Login as regular user | Kick option hidden |

---

## 6.3 Timeouts

### `mod-timeout.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should timeout a member | Right-click → Timeout → set duration → confirm | Member timed out |
| 2 | should prevent timed-out user from sending messages | Login as timed-out user | Message input disabled |
| 3 | should show timeout expiry | View member | Timeout duration shown |
| 4 | should auto-remove timeout after expiry | Wait for timeout to expire | User can send messages again |
| 5 | should create audit log entry | Timeout user | Audit entry with duration |
| 6 | should remove timeout early | Click remove timeout | Timeout lifted; audit entry |

---

## 6.4 Audit Log

### `audit-log.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should display audit log viewer | Moderation → Audit Log | Log entries listed |
| 2 | should show all required fields | View entry | actorId, targetId, action, reason, timestamp all present |
| 3 | should filter by action type | Select "bans" filter | Only ban entries shown |
| 4 | should filter by actor | Select specific mod | Only their actions shown |
| 5 | should paginate log entries | Scroll/click next | More entries load |
| 6 | should show emoji audit events | Upload/delete emoji | `emoji_uploaded`/`emoji_deleted` entries |
| 7 | should show role change events | Change user role | `role_assigned`/`role_removed` entries |
| 8 | should show channel CRUD events | Create/edit/delete channel | Entries logged |
| 9 | should not expose sensitive data in logs | Review log entries | No passwords, tokens, or PII |

---

## 6.5 Moderation Timeline

### `mod-timeline.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show timeline view | Navigate to `/moderation/timeline` | Timeline displayed |
| 2 | should show events chronologically | View timeline | Newest first (or configurable) |
| 3 | should show event details | Click event | Expanded details |
| 4 | should filter by date range | Set date filter | Filtered results |

---

## 6.6 AutoMod Rules

### `automod-rules.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should list existing AutoMod rules | Server settings → AutoMod | Rules listed |
| 2 | should create a new AutoMod rule | Click create → configure → save | Rule created |
| 3 | should edit an AutoMod rule | Click edit → change → save | Rule updated |
| 4 | should delete an AutoMod rule | Click delete → confirm | Rule removed |
| 5 | should trigger AutoMod on matching message | Send message matching rule | Message blocked/flagged |
| 6 | should create audit log for AutoMod action | Rule triggers | `automod_action` audit entry |
| 7 | should support keyword filter rules | Create keyword rule → test | Matching keywords caught |
| 8 | should support spam detection rules | Create spam rule → send spam | Spam caught |
| 9 | should support link filtering rules | Create link rule → send link | Link caught |
| 10 | should allow exceptions for roles | Exempt a role → test | Exempted role bypasses rule |

---

## 6.7 Content Screening

### `content-screening.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show content screening queue | Navigate to screening section | Pending items listed |
| 2 | should accept content | Click accept on item | Content approved; visible in channel |
| 3 | should reject content | Click reject on item | Content removed; notification to author |
| 4 | should show preview of flagged content | View queue | Content preview visible |
| 5 | should require MANAGE_MESSAGES permission | Login as regular user | Queue not accessible |
| 6 | should bulk accept content | Select multiple items → accept all | All items approved; audit entries created |
| 7 | should bulk reject content | Select multiple items → reject all | All items removed; authors notified; audit entries created |

---

## 6.8 Reports

### `reports.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open report modal | Right-click message → Report | Report modal opens |
| 2 | should submit report with reason | Select category → enter details → submit | Report created |
| 3 | should show reports in server settings | Settings → Reports | Reports listed |
| 4 | should resolve a report | Click resolve on report | Report marked resolved |
| 5 | should not allow reporting own messages | Right-click own message | Report option hidden |

---

## 6.9 Appeals

### `appeals.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show appeals page | Navigate to `/appeals` | Appeals interface shown |
| 2 | should submit an appeal | Fill form → submit | Appeal created |
| 3 | should show appeal status | View appeal | Status (pending/approved/denied) shown |
| 4 | should review appeals as mod | Login as mod → view appeals | Appeals queue shown |
| 5 | should approve appeal | Click approve | Appeal approved; action reversed |
| 6 | should deny appeal | Click deny → enter reason | Appeal denied; user notified |
| 7 | should use appeal templates | Server settings → Appeal Templates → create | Template available for appeals |

---

## 6.10 Mod Ledger

### `mod-ledger.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show mod action history for a user | Navigate to `/moderation/target/[userId]` | All actions against user shown |
| 2 | should show action count per user | View moderation dashboard | Action counts visible |
| 3 | should show action breakdown by type | View user ledger | Bans, kicks, timeouts categorized |

---

## 6.11 Transparency Panel

### `transparency-panel.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show moderation transparency stats | View transparency panel | Aggregate stats shown |
| 2 | should show actions taken in channel | Navigate to channel transparency | Channel-specific mod actions |
| 3 | should require appropriate permissions | Login as regular user | Limited or no access |

---

## 6.12 Slash Moderation Commands

### `slash-moderation.spec.ts`

> Tests for the `use-slash-moderation.ts` hook and related slash commands.

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should execute /ban command | Type `/ban @user reason` | User banned |
| 2 | should execute /kick command | Type `/kick @user reason` | User kicked |
| 3 | should execute /mute command | Type `/mute @user duration` | User muted |
| 4 | should execute /timeout command | Type `/timeout @user 1h` | User timed out |
| 5 | should show error for insufficient permissions | Regular user types `/ban` | Permission denied |
| 6 | should create audit log for slash /ban | Execute `/ban @user` → check audit log | `ban_member` audit entry created |
| 7 | should log failed slash command attempt | Execute `/ban` without BAN_MEMBERS permission → check audit log | Failed attempt audit entry logged |
