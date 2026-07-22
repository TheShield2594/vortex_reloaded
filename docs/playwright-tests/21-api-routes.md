# 21 — API Route Contract Tests

> Covers: every API route's request/response contract, authentication, authorization, error handling, input validation. These are Playwright API tests (no browser UI) using `request` fixture.

---

## 21.1 Auth Routes

### `api-auth.spec.ts`

| # | Route | Method | Test | Expected |
|---|-------|--------|------|----------|
| 1 | `/api/auth/login` | POST | Valid credentials | 200 + session cookie |
| 2 | `/api/auth/login` | POST | Invalid credentials | 401 `{ error }` |
| 3 | `/api/auth/login` | POST | Missing fields | 400 `{ error }` |
| 4 | `/api/auth/password` | PUT | Valid change | 200 |
| 5 | `/api/auth/password` | PUT | Wrong current password | 400/401 |
| 6 | `/api/auth/mfa-challenge` | POST | Valid TOTP | 200 |
| 7 | `/api/auth/mfa-challenge` | POST | Invalid TOTP | 401 |
| 8 | `/api/auth/mfa/disable` | POST | With valid step-up | 200 |
| 9 | `/api/auth/sessions` | GET | Authenticated | 200 + session list |
| 10 | `/api/auth/sessions/[id]` | DELETE | Revoke other session | 200 |
| 11 | `/api/auth/step-up` | POST | Valid password | 200 + elevated token |
| 12 | `/api/auth/account` | GET | Authenticated | 200 + account info |
| 13 | `/api/auth/recovery-codes` | GET | Authenticated + step-up | 200 + codes |
| 14 | `/api/auth/recovery-codes/redeem` | POST | Valid code | 200 |
| 15 | `/api/auth/security/policy` | GET/PUT | Read/update policy | 200 |
| 16 | `/api/auth/passkeys/*` | Various | Registration + login flows | Correct responses |

---

## 21.2 Message Routes

### `api-messages.spec.ts`

| # | Route | Method | Test | Expected |
|---|-------|--------|------|----------|
| 1 | `/api/messages` | POST | Send message | 201 + message object |
| 2 | `/api/messages` | POST | No auth | 401 |
| 3 | `/api/messages` | POST | No permission | 403 |
| 4 | `/api/messages` | POST | Empty content | 400 |
| 5 | `/api/messages/[id]/reactions` | POST | Add reaction | 201 |
| 6 | `/api/messages/[id]/reactions` | DELETE | Remove reaction | 200 |
| 7 | `/api/messages/[id]/pin` | POST | Pin message | 200 |
| 8 | `/api/messages/[id]/pin` | DELETE | Unpin message | 200 |
| 9 | `/api/messages/[id]/task` | POST/PUT | Create/update task | 200 |

---

## 21.3 Server Routes

### `api-servers.spec.ts`

| # | Route | Method | Test | Expected |
|---|-------|--------|------|----------|
| 1 | `/api/servers` | POST | Create server | 201 |
| 2 | `/api/servers` | POST | No auth | 401 |
| 3 | `/api/servers/[id]` | GET | Get server | 200 + server object |
| 4 | `/api/servers/[id]` | PUT | Update server | 200 |
| 5 | `/api/servers/[id]` | DELETE | Delete server | 200 |
| 6 | `/api/servers/[id]` | DELETE | Non-owner | 403 |
| 7 | `/api/servers/discover` | GET | List public servers | 200 |
| 8 | `/api/servers/[id]/members` | GET | List members | 200 |
| 9 | `/api/servers/[id]/members/[uid]` | DELETE | Kick member | 200 |
| 10 | `/api/servers/[id]/members/[uid]/roles` | PUT | Assign role | 200 |
| 11 | `/api/servers/[id]/members/[uid]/timeout` | POST | Timeout member | 200 |
| 12 | `/api/servers/[id]/members/me/nickname` | PUT | Set nickname | 200 |
| 13 | `/api/servers/[id]/invites` | GET/POST | List/create invites | 200/201 |
| 14 | `/api/servers/[id]/channels` | GET/POST | List/create channels | 200/201 |
| 15 | `/api/servers/[id]/roles` | GET/POST | List/create roles | 200/201 |
| 16 | `/api/servers/[id]/roles/[rid]` | PUT/DELETE | Update/delete role | 200 |
| 17 | `/api/servers/[id]/roles/reorder` | PUT | Reorder roles | 200 |
| 18 | `/api/servers/[id]/bans` | GET/POST | List/create bans | 200/201 |
| 19 | `/api/servers/[id]/emojis` | GET/POST/DELETE | CRUD emojis | 200/201 |
| 20 | `/api/servers/[id]/audit-log` | GET | Fetch audit log | 200 |
| 21 | `/api/servers/[id]/webhooks` | GET/POST | CRUD webhooks | 200/201 |

---

## 21.4 Channel Routes

### `api-channels.spec.ts`

| # | Route | Method | Test | Expected |
|---|-------|--------|------|----------|
| 1 | `/api/channels/[id]` | GET | Get channel | 200 |
| 2 | `/api/channels/[id]` | PUT | Update channel | 200 |
| 3 | `/api/channels/[id]` | DELETE | Delete channel | 200 |
| 4 | `/api/channels/[id]/permissions` | GET/PUT | Read/update permissions | 200 |
| 5 | `/api/channels/[id]/docs` | GET/POST | Channel docs | 200/201 |
| 6 | `/api/channels/[id]/tasks` | GET/POST | Channel tasks | 200/201 |

---

## 21.5 DM Routes

### `api-dm.spec.ts`

| # | Route | Method | Test | Expected |
|---|-------|--------|------|----------|
| 1 | `/api/dm` | POST | Create DM | 201 |
| 2 | `/api/dm/channels` | GET | List DM channels | 200 |
| 3 | `/api/dm/channels/[id]` | GET | Get DM channel | 200 |
| 4 | `/api/dm/channels/[id]/messages` | GET/POST | Read/send DM messages | 200/201 |
| 5 | `/api/dm/channels/[id]/messages/[mid]` | PUT/DELETE | Edit/delete DM message | 200 |
| 6 | `/api/dm/channels/[id]/messages/[mid]/reactions` | POST/DELETE | DM reactions | 201/200 |
| 7 | `/api/dm/channels/[id]/members` | GET | DM members | 200 |
| 8 | `/api/dm/channels/[id]/call` | POST | Initiate DM call | 200 |
| 9 | `/api/dm/channels/[id]/keys` | GET/POST | Encryption keys | 200 |
| 10 | `/api/dm/keys/device` | POST | Register device key | 200 |
| 11 | `/api/dm/attachments/[id]/download` | GET | Download DM attachment | 200/410 |

---

## 21.6 User Routes

### `api-users.spec.ts`

| # | Route | Method | Test | Expected |
|---|-------|--------|------|----------|
| 1 | `/api/users/profile` | GET/PUT | Read/update profile | 200 |
| 2 | `/api/users/avatar` | POST | Upload avatar | 200 |
| 3 | `/api/users/appearance` | GET/PUT | Read/update appearance | 200 |
| 4 | `/api/users/interests` | GET/PUT | Read/update interests | 200 |
| 5 | `/api/users/badges` | GET/POST/DELETE | Badge operations | 200/201 |
| 6 | `/api/users/connections` | GET | List connections | 200 |
| 7 | `/api/users/connections/public` | GET | Public connections | 200 |
| 8 | `/api/users/export` | GET | GDPR data export | 200 + JSON |
| 9 | `/api/users/pinned` | GET/PUT | Pinned items | 200 |
| 10 | `/api/users/activity` | GET | User activity | 200 |

---

## 21.7 Notification Routes

### `api-notifications.spec.ts`

| # | Route | Method | Test | Expected |
|---|-------|--------|------|----------|
| 1 | `/api/notifications` | GET | List notifications | 200 |
| 2 | `/api/notifications/unread-count` | GET | Unread count | 200 + count |
| 3 | `/api/notification-settings` | GET/PUT | Read/update | 200 |
| 4 | `/api/push` | POST | Register push subscription | 200 |
| 5 | `/api/push/vapid-key` | GET | Get VAPID key | 200 |

---

## 21.8 Media Routes

### `api-media.spec.ts`

| # | Route | Method | Test | Expected |
|---|-------|--------|------|----------|
| 1 | `/api/gif/search` | GET | Search GIFs | 200 |
| 2 | `/api/gif/trending` | GET | Trending GIFs | 200 |
| 3 | `/api/gif/suggestions` | GET | GIF suggestions | 200 |
| 4 | `/api/sticker/search` | GET | Search stickers | 200 |
| 5 | `/api/sticker/trending` | GET | Trending stickers | 200 |
| 6 | `/api/meme/search` | GET | Search memes | 200 |
| 7 | `/api/meme/trending` | GET | Trending memes | 200 |
| 8 | `/api/oembed` | GET | oEmbed data | 200 |
| 9 | `/api/attachments/[id]/download` | GET | Download file | 200/410 |

---

## 21.9 Miscellaneous Routes

### `api-misc.spec.ts`

| # | Route | Method | Test | Expected |
|---|-------|--------|------|----------|
| 1 | `/api/health` | GET | Health check | 200/503 |
| 2 | `/api/health/readiness` | GET | Readiness | 200 |
| 3 | `/api/search` | GET | Global search | 200 |
| 4 | `/api/friends` | GET/POST/DELETE | Friend operations | 200/201 |
| 5 | `/api/friends/status` | GET | Friend statuses | 200 |
| 6 | `/api/friends/suggestions` | GET | Suggestions | 200 |
| 7 | `/api/invites/[code]` | GET/POST | Invite lookup/accept | 200 |
| 8 | `/api/badges` | GET | Badge catalog | 200 |
| 9 | `/api/presence` | POST | Update presence | 200 |
| 10 | `/api/server-templates` | GET | List templates | 200 |
| 11 | `/api/share` | POST | Web share | 200 |
| 12 | `/api/reports` | POST | Submit report | 201 |
| 13 | `/api/onboarding/complete` | POST | Complete onboarding | 200 |
| 14 | `/api/onboarding/welcome-message` | POST | Send welcome message | 200 |

---

## 21.10 Cron Routes

### `api-cron.spec.ts`

| # | Route | Method | Test | Expected |
|---|-------|--------|------|----------|
| 1 | `/api/cron/attachment-decay` | GET | Purge expired | 200 |
| 2 | `/api/cron/thread-auto-archive` | GET | Archive inactive threads | 200 |
| 3 | `/api/cron/event-reminders` | GET | Send event reminders | 200 |
| 4 | `/api/cron/scheduled-tasks` | GET | Run scheduled tasks | 200 |
| 5 | `/api/cron/voice-retention` | GET | Voice data retention | 200 |

---

## 21.11 Cross-Cutting API Requirements

### `api-cross-cutting.spec.ts`

> Verifies CLAUDE.md API route checklist across ALL routes.

| # | Test | Expected |
|---|------|----------|
| 1 | Every POST/PUT/DELETE route returns 401 without auth | 401 for all |
| 2 | Every route with permission check returns 403 | 403 when lacking permission |
| 3 | Every route returns `{ error: string }` on failure | Structured errors |
| 4 | No route returns raw stack traces | Clean error messages |
| 5 | Every route validates required body fields | 400 for missing fields |
| 6 | No route trusts client-supplied userId | Session-derived only |
| 7 | Every Supabase query result is null-checked | No uncaught null errors |
