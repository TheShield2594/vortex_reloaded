# 02 — Server Management

> Covers: server CRUD, server settings, templates, invites, vanity URLs, server discovery, server icons, server themes, member management.

**Components under test:**
- `create-server-modal.tsx`, `server-settings-modal.tsx`, `invite-modal.tsx`
- `server-sidebar.tsx`, `server-sidebar-wrapper.tsx`, `channel-sidebar.tsx`
- `template-manager.tsx`, `theme-identity-section.tsx`, `server-settings-admin.tsx`
- Pages: `channels/[serverId]/page.tsx`, `channels/[serverId]/settings/page.tsx`, `channels/discover/page.tsx`
- API: `/api/servers`, `/api/servers/[serverId]`, `/api/servers/[serverId]/invites`, `/api/servers/discover`, `/api/server-templates`
- API: `/api/servers/[serverId]/settings/theme`, `/api/servers/[serverId]/members/*`

---

## 2.1 Server Creation

### `create-server.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open create server modal | Click `+` in server sidebar | Modal opens with template options |
| 2 | should create server with name only | Enter name → submit | Server created; redirected to server; user is owner |
| 3 | should create server with icon upload | Enter name + upload icon | Server has custom icon |
| 4 | should create server from Gaming template | Select Gaming template → enter name → submit | Server created with gaming channels (e.g., #general, #looking-for-group) |
| 5 | should create server from Study template | Select Study → name → submit | Study-specific channels created |
| 6 | should create server from Startup template | Select Startup → name → submit | Startup channels (e.g., #standup, #engineering) |
| 7 | should create server from Creator template | Select Creator → name → submit | Creator channels |
| 8 | should reject empty server name | Submit with no name | Validation error |
| 9 | should reject server name > max length | Enter very long name | Validation error |
| 10 | should auto-join owner to new server | Create server | Owner appears in member list |
| 11 | should send system welcome message | Create server | AutoMod welcome message in #general |
| 12 | should show server in sidebar after creation | Create server | Server icon appears in server sidebar |

---

## 2.2 Server Settings

### `server-settings-general.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open server settings | Click server name → Settings | Settings modal opens |
| 2 | should update server name | Change name → save | Name updated in sidebar and header |
| 3 | should update server icon | Upload new icon → save | Icon updated |
| 4 | should update server description | Enter description → save | Description saved |
| 5 | should only allow owner/admin to access settings | Login as regular member → try settings | Settings option hidden or 403 |
| 6 | should show all setting tabs | Open settings | Overview, Roles, Channels, Emojis, Invites, Apps, etc. visible |

### `server-settings-theme.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should set custom server theme | Pick color → save | Theme applied to server UI |
| 2 | should preview theme before saving | Change color | Live preview shown |
| 3 | should reset theme to default | Click reset | Default theme restored |

---

## 2.3 Server Templates

### `server-templates.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should list available templates | Open create server modal | Templates grid shown |
| 2 | should preview template channels | Hover/click template | Channel list preview |
| 3 | should create channels from template | Select template → create | All template channels exist |
| 4 | should fetch templates from API | Intercept GET `/api/server-templates` | Valid template data returned |

---

## 2.4 Invites

### `server-invites.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should generate invite link | Server settings → Invites → Create | Invite URL generated |
| 2 | should copy invite link to clipboard | Click copy button | Link copied; toast confirmation |
| 3 | should join server via invite link | Navigate to `/invite/[code]` as another user | Server joined; redirect to server |
| 4 | should show invite preview page | Visit invite link while logged out | Server name, icon, member count shown |
| 5 | should reject expired invite | Use expired code | Error: "Invite expired" |
| 6 | should reject invalid invite code | Visit `/invite/bogus123` | Error: "Invalid invite" |
| 7 | should not allow re-joining if already a member | Visit invite link as existing member | "Already a member" message; redirect to server |
| 8 | should require login to accept invite | Visit invite while logged out | Redirect to login → then back to invite |

---

## 2.5 Vanity URLs

### `vanity-urls.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should set vanity URL (owner only) | Server settings → Invites → Set vanity | URL saved; preview shown |
| 2 | should enforce slug format (3-32 chars, lowercase) | Enter "AB" | Validation error |
| 3 | should reject invalid characters | Enter "my server!!" | Validation error |
| 4 | should check uniqueness before saving | Enter taken slug | "Already in use" error |
| 5 | should resolve vanity URL to server | Visit `/invite/my-server` | Resolves to correct server |
| 6 | should copy vanity URL | Click copy | Full URL copied |
| 7 | should show live preview of URL | Type slug | Preview updates in real time |
| 8 | should only allow server owner to set vanity | Login as non-owner admin | Vanity field hidden/disabled |

---

## 2.6 Server Discovery

### `server-discovery.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show discover page | Navigate to `/channels/discover` | Discover page loads |
| 2 | should list public servers | View discover page | Server cards shown |
| 3 | should search servers by name | Type in search → results | Filtered results shown |
| 4 | should join server from Discover page | Click join on a server card | Server joined; appears in sidebar |
| 5 | should show server details (members, description) | View server card | Info displayed |
| 6 | should paginate/infinite scroll results | Scroll down | More servers load |

---

## 2.7 Member Management

### `server-members.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should list server members | Open member list panel | Members listed with roles |
| 2 | should show online/offline status | View member list | Status indicators visible |
| 3 | should open user profile on click | Click member name | Profile popover shown |
| 4 | should kick a member (with permission) | Right-click member → Kick → confirm | Member removed; audit log entry |
| 5 | should ban a member (with permission) | Right-click member → Ban → confirm | Member banned; audit log entry |
| 6 | should timeout a member | Right-click → Timeout → set duration | Member timed out; audit log entry |
| 7 | should change member nickname | Member settings → set nickname | Nickname displayed |
| 8 | should assign role to member | Right-click → Roles → select role | Role assigned; permissions updated |
| 9 | should not allow kicking higher-role members | Try to kick admin as mod | Action blocked |
| 10 | should not allow banning server owner | Try to ban owner | Action blocked |

---

## 2.8 Server Deletion / Leaving

### `server-leave-delete.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should leave a server | Server settings → Leave Server → confirm | Removed from server; sidebar updated |
| 2 | should not allow owner to leave without transfer | Owner clicks leave | Prompt to transfer ownership or delete |
| 3 | should delete server (owner only) | Server settings → Delete → type name → confirm | Server deleted; redirect |
| 4 | should not allow non-owner to delete | Login as admin → try delete | Option hidden or 403 |

---

## 2.9 Screening (Member Verification)

### `server-screening.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show screening form to new members | Join server with screening enabled | Screening questions displayed |
| 2 | should accept screening answers | Fill answers → submit | Access granted to channels |
| 3 | should configure screening in server settings | Settings → Screening → add questions | Questions saved |
| 4 | should block channel access until screening complete | Try to view channels before screening | Content hidden/blocked |
