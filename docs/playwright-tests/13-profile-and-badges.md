# 13 — Profile & Badges

> Covers: user profile panel, profile popover, badges, connections, activity, pinned items, interests, avatar, user presence.

**Components under test:**
- `profile-panel.tsx`, `profile-badges.tsx`, `profile-connections.tsx`
- `profile-activity.tsx`, `profile-interest-tags.tsx`, `profile-pinned-items.tsx`
- `user-profile-popover.tsx`
- Pages: `channels/profile/page.tsx`, `channels/you/page.tsx`
- API: `/api/users/profile`, `/api/users/avatar`, `/api/users/interests`
- API: `/api/users/badges`, `/api/badges`
- API: `/api/users/connections`, `/api/users/connections/public`
- API: `/api/users/pinned`, `/api/users/activity`
- API: `/api/presence`

---

## 13.1 User Profile Panel

### `profile-panel.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show profile panel on user click | Click username in chat | Profile panel opens |
| 2 | should display username and display name | View panel | Both shown correctly |
| 3 | should display avatar | View panel | Avatar image rendered |
| 4 | should display bio/about section | View panel | Bio text shown |
| 5 | should display roles in server context | View member profile | Server roles listed |
| 6 | should display member since date | View panel | Join date shown |
| 7 | should show "Message" button for DM | View other user's profile | Message button present |
| 8 | should show "Add Friend" button | View non-friend profile | Add Friend button |
| 9 | should close panel on outside click | Click outside | Panel closes |
| 10 | should navigate to full profile page | Click "View Full Profile" | Navigates to profile page |

---

## 13.2 Profile Popover

### `profile-popover.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show popover on hover | Hover username | Popover with quick info |
| 2 | should show avatar and status | View popover | Both displayed |
| 3 | should show role color | View popover | Username in role color |
| 4 | should show quick actions | View popover | Message, Add Friend buttons |

---

## 13.3 Badges

### `profile-badges.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should display badges on profile | View profile with badges | Badge icons shown |
| 2 | should show badge tooltip on hover | Hover badge | Badge name + description |
| 3 | should show rarity glow | View rare badge | Glow effect based on rarity |
| 4 | should show all 10 default badge types | View catalog | early_adopter, bug_hunter, server_owner, moderator, message_veteran, voice_regular, streak_master, event_host, community_star, verified |
| 5 | should appear between Roles and Connections | View profile layout | Correct section order |

### `badge-management.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should fetch badge catalog | GET `/api/badges` | All badge definitions returned |
| 2 | should fetch user badges | GET `/api/users/badges?userId=X` | User's badges returned |
| 3 | should award badge (ADMINISTRATOR only) | POST `/api/users/badges` | Badge awarded |
| 4 | should revoke badge (ADMINISTRATOR only) | DELETE `/api/users/badges` | Badge removed |
| 5 | should reject badge award without ADMINISTRATOR | Login as mod → try award | 403 |
| 6 | should not allow duplicate badge award | Award same badge twice | Error or no-op |
| 7 | should track awarded_by | Award badge | `awarded_by` field set |

---

## 13.4 Profile Activity

### `profile-activity.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show user activity | View profile → Activity section | Activity items listed |
| 2 | should update activity status | Set custom status | Status shown on profile |
| 3 | should show presence (online/idle/DND/offline) | View user | Correct status indicator |
| 4 | should sync presence in real time | User goes idle | Status updates for viewers |

---

## 13.5 Pinned Profile Items

### `profile-pinned-items.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show pinned items on profile | View profile with pins | Pinned items displayed |
| 2 | should add pinned item | Profile settings → add pin | Item pinned |
| 3 | should remove pinned item | Click remove | Item unpinned |
| 4 | should reorder pinned items | Drag to reorder | Order saved |

---

## 13.6 Interest Tags

### `profile-interests.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show interest tags on profile | View profile | Tags displayed |
| 2 | should add interest tags | Settings → Interests → add | Tag saved |
| 3 | should remove interest tags | Click X on tag | Tag removed |
| 4 | should limit number of tags | Add beyond limit | Error or warning |

---

## 13.7 Presence System

### `presence-sync.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show online status | User is active | Green dot |
| 2 | should show idle status | User is idle | Yellow dot |
| 3 | should show DND status | User sets DND | Red dot |
| 4 | should show offline status | User disconnects | Gray dot |
| 5 | should sync via `/api/presence` | Presence API call | Status updated for all viewers |
| 6 | should update member list in real time | User comes online | Status updates in member list |
