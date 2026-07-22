# 11 — App Store & Bots

> Covers: app catalog, app installation, Welcome Bot, Giveaway Bot, Standup Assistant, Incident Bot, Reminder Bot, slash command execution, app config panels.

**Components under test:**
- `apps-tab.tsx`, `welcome-app-config.tsx`, `giveaway-app-config.tsx`
- `standup-app-config.tsx`, `incident-app-config.tsx`, `reminder-app-config.tsx`
- API: `/api/apps/discover`
- API: `/api/servers/[serverId]/apps`, `/api/servers/[serverId]/apps/commands`
- API: `/api/servers/[serverId]/apps/commands/execute`
- API: `/api/servers/[serverId]/apps/welcome`
- API: `/api/servers/[serverId]/apps/giveaway`, `/api/servers/[serverId]/apps/giveaway/[giveawayId]`
- API: `/api/servers/[serverId]/apps/standup`
- API: `/api/servers/[serverId]/apps/incidents`, `/api/servers/[serverId]/apps/incidents/[incidentId]`
- API: `/api/servers/[serverId]/apps/reminder`
- Hooks: `use-slash-command-autocomplete.ts`

---

## 11.1 App Catalog & Installation

### `app-catalog.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show app catalog in server settings | Server settings → Apps | App list shown |
| 2 | should show app details (name, description) | View catalog | Details visible |
| 3 | should install an app | Click Install on app | App installed; config panel shown |
| 4 | should uninstall an app | Click Uninstall → confirm | App removed |
| 5 | should require MANAGE_WEBHOOKS or USE_APPLICATION_COMMANDS | Login as regular user | Install button hidden |
| 6 | should show marketplace on discover page | Navigate to discover → Apps | Public app catalog |
| 7 | should install from Discover page | Click "Add to Server" → select server | App installed on chosen server |
| 8 | should show installed apps indicator | View already-installed app | "Installed" badge |

---

## 11.2 Welcome Bot

### `welcome-bot.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open Welcome Bot config | Server settings → Apps → Welcome Bot | Config panel shown |
| 2 | should set welcome channel | Select channel → save | Channel assignment saved |
| 3 | should set custom welcome message | Enter message → save | Custom message saved |
| 4 | should configure rules text | Enter rules → save | Rules saved |
| 5 | should enable DM on join | Toggle DM on join → set message → save | DM settings saved |
| 6 | should set embed color | Pick color | Color saved |
| 7 | should show live preview | Configure message | Preview updates in real time |
| 8 | should auto-post welcome on member join | New member joins | Welcome message posted in channel |
| 9 | should DM new member when DM on join enabled | New member joins | DM received |
| 10 | should not post when bot is disabled | Disable bot → member joins | No welcome message |

---

## 11.3 Giveaway Bot

### `giveaway-bot.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open Giveaway Bot config | Server settings → Apps → Giveaway Bot | Config panel shown |
| 2 | should set giveaway channel | Select channel → save | Saved |
| 3 | should create a timed giveaway | Fill prize, description, duration, winners → create | Giveaway created; announcement posted |
| 4 | should enter a giveaway | Click enter on giveaway message | User entered |
| 5 | should leave a giveaway | Click leave | User removed from entries |
| 6 | should draw winners automatically | Fast-forward mocked clock (`page.clock.advance()`) to giveaway end | Winners selected; announcement posted |
| 7 | should end giveaway early | Admin clicks "End Early" | Winners drawn immediately |
| 8 | should cancel giveaway | Admin clicks "Cancel" → confirm | Giveaway cancelled |
| 9 | should reroll winners | Admin clicks "Reroll" | New winners selected |
| 10 | should show giveaway announcement in channel | Create giveaway | System bot posts announcement |
| 11 | should show winner announcement | Giveaway ends | Winner names posted |

---

## 11.4 Standup Assistant

### `standup-assistant.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open Standup config | Server settings → Apps → Standup | Config panel |
| 2 | should set standup channel | Select channel → save | Saved |
| 3 | should configure questions (1-10) | Add/edit/remove questions → save | Questions saved |
| 4 | should set active days | Select Mon-Fri → save | Days saved |
| 5 | should set reminder time and timezone | Set 9:00 AM EST → save | Saved |
| 6 | should submit standup via UI | Fill answers → submit | Entry saved |
| 7 | should submit standup via `/standup` command | Type `/standup` → fill | Entry saved |
| 8 | should view team standups | Open team view | All submissions for today |
| 9 | should use `/standupconfig` command | Type `/standupconfig` | Config options shown |
| 10 | should use `/standupview` command | Type `/standupview` | Team view shown |
| 11 | should use `/standupremind` command | Type `/standupremind` | Reminder sent |
| 12 | should enforce daily per-user submission limit | Submit twice | Second rejected |

---

## 11.5 Incident Bot

### `incident-bot.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open Incident Bot config | Server settings → Apps → Incident Bot | Config panel |
| 2 | should set incident channel | Select channel → save | Saved |
| 3 | should customize severity levels | Edit labels → save | Custom labels saved |
| 4 | should create incident via UI | Fill title, severity, description → create | Incident created; announcement posted |
| 5 | should create incident via `/incident` command | Type `/incident title severity` | Incident created |
| 6 | should update incident status | Change investigating → identified → monitoring | Status updated; timeline entry |
| 7 | should update via `/iupdate` command | Type `/iupdate` → fill | Update posted |
| 8 | should resolve incident | Mark resolved or `/iresolve` | Incident resolved; announcement |
| 9 | should view incident timeline | Open incident → view updates | Full timeline shown |
| 10 | should use `/ilist` to list incidents | Type `/ilist` | Active incidents listed |
| 11 | should use `/itimeline` to view timeline | Type `/itimeline [id]` | Timeline shown |
| 12 | should follow status flow | investigating → identified → monitoring → resolved | Each transition valid |

---

## 11.6 Reminder Bot

### `reminder-bot.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open Reminder Bot config | Server settings → Apps → Reminder Bot | Config panel |
| 2 | should create reminder via `/reminder` | Type `/reminder 1h Review PR` | Reminder set |
| 3 | should list reminders via `/reminders` | Type `/reminders` | Active reminders listed |
| 4 | should cancel reminder via `/rcancel` | Type `/rcancel [id]` | Reminder cancelled |
| 5 | should enforce max 24h duration | Set 25h | Error |
| 6 | should enforce per-user max limit | Create beyond limit | Error |
| 7 | should fire reminder at scheduled time | Fast-forward mocked clock to trigger time | Reminder notification received |

---

## 11.7 Slash Command Execution

### `slash-command-execution.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should execute registered command | Type `/standup` → submit | Command processed by `AppInteractionRuntime` |
| 2 | should enforce rate limiting | Execute command 10 times rapidly | Rate limited after threshold |
| 3 | should show command autocomplete | Type `/` | Available commands listed |
| 4 | should show command arguments help | Select command | Argument descriptions shown |
| 5 | should handle command execution error | Mock runtime error | Error message shown to user |
| 6 | should require USE_APPLICATION_COMMANDS | Login without permission | Commands not available |

---

## 11.8 App Config Panels

### `app-config-panels.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show inline config for all 5 apps | Server settings → Apps | Config UI for each installed app |
| 2 | should save config changes | Edit config → save | Changes persisted |
| 3 | should validate config fields | Enter invalid data | Validation errors |
| 4 | should reset config to defaults | Click reset | Default values restored |
| 5 | should show channel list for channel selection | Click channel dropdown | Server channels listed via `/api/servers/[serverId]/channels` |
