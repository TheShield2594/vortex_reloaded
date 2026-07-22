# 09 — Notifications

> Covers: notification bell, notification hub, push notifications, notification settings, quiet hours, unread indicators, app badge, tab title, notification sounds.

**Components under test:**
- `notification-bell.tsx`, `notification-settings-modal.tsx`
- Pages: `channels/notifications/page.tsx`, `settings/notifications/page.tsx`
- Hooks: `use-notification-preferences.ts`, `use-notification-sound.ts`, `use-dm-notification-sound.ts`
- Hooks: `use-push-notifications.ts`, `use-tab-unread-title.ts`, `use-favicon-badge.ts`
- `push-permission-prompt.tsx`
- API: `/api/notifications`, `/api/notifications/unread-count`
- API: `/api/notification-settings`, `/api/user/notification-preferences`
- API: `/api/push`, `/api/push/vapid-key`

---

## 9.1 Notification Bell & Hub

### `notification-bell.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show notification bell in header | View any page | Bell icon visible |
| 2 | should show unread count badge | Receive notifications | Count badge on bell |
| 3 | should open notification dropdown | Click bell | Notification list opens |
| 4 | should show notification items | View dropdown | Items with icon, text, timestamp |
| 5 | should mark notification as read | Click notification | Read state updated |
| 6 | should mark all as read | Click "Mark all as read" | All notifications cleared |
| 7 | should navigate on notification click | Click mention notification | Navigates to message |
| 8 | should show different notification types | View list | Mentions, DMs, friend requests, etc. |

### `notification-hub.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show notification hub page | Navigate to `/channels/notifications` | Full notification list |
| 2 | should filter by type | Select filter (mentions, DMs, etc.) | Filtered results |
| 3 | should paginate notifications | Scroll down | More notifications load |
| 4 | should show empty state | No notifications | "All caught up" message |

---

## 9.2 Push Notifications

### `push-notifications.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show push permission prompt after delay | Use fake timers (`page.clock.install()`) → advance 60s | Soft-ask prompt appears (no real wait) |
| 2 | should register push subscription on accept | Accept push prompt | Subscription sent to `/api/push` |
| 3 | should not show prompt after dismissal | Dismiss → reload | Prompt does not reappear |
| 4 | should receive push notification for mentions | Get mentioned while app in background | Push notification |
| 5 | should receive push notification for DMs | Receive DM while away | Push notification |
| 6 | should suppress push during quiet hours | Enable quiet hours → trigger notification | No push sent |
| 7 | should get VAPID key from server | Call `/api/push/vapid-key` | Valid VAPID key returned |

---

## 9.3 Notification Settings

### `notification-settings.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open notification settings page | Settings → Notifications | Settings page loads |
| 2 | should toggle desktop notifications | Enable/disable | Setting saved |
| 3 | should toggle notification sounds | Enable/disable | Setting saved |
| 4 | should set per-server notification level | Select server → set "mentions only" | Saved |
| 5 | should set per-channel notification override | Right-click channel → Notification settings | Override saved |
| 6 | should configure quiet hours | Enable → set start/end/timezone | Saved |
| 7 | should show 4-level settings hierarchy | View settings | Global → Server → Channel → Override levels shown |
| 8 | should respect quiet hours start/end | Set 10pm-8am → trigger at 11pm | Suppressed |
| 9 | should select timezone for quiet hours | Set timezone | Correct timezone applied |

### `notification-sound.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should play sound on new message | Receive message in focused channel | Sound plays (or not if disabled) |
| 2 | should play DM notification sound | Receive DM | DM-specific sound plays |
| 3 | should respect sound disabled setting | Disable sounds → receive message | No sound |
| 4 | should not play sound for own messages | Send message | No sound |

---

## 9.4 Unread Indicators

### `unread-indicators.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show unread dot on channel | Receive message in another channel | Dot indicator on channel |
| 2 | should show unread count for mentions | Get mentioned | "@1" badge on channel |
| 3 | should show unread indicator on server icon | Unread in any channel | Dot on server icon |
| 4 | should clear unread on channel visit | Click channel | Unread cleared |
| 5 | should show unread on DM list | Receive DM | Unread indicator on DM item |
| 6 | should update tab title with unread count | Receive messages | `(3) VortexChat` tab title |
| 7 | should update app badge | Receive mentions | `setAppBadge()` called |
| 8 | should update favicon badge | Receive unread | Favicon updated |

---

## 9.5 Mark Channel Read

### `mark-channel-read.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should mark channel as read on focus | Click channel | Channel marked read |
| 2 | should mark channel as read via context menu | Right-click → Mark as Read | Channel marked read |
| 3 | should mark all channels as read | Right-click server → Mark All Read | All channels cleared |
