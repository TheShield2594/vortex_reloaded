# 08 — Search & Discovery

> Covers: global message search, server search, user search, quickswitcher, discover page (servers, apps), local DM search.

**Components under test:**
- `search-modal.tsx`, `quickswitcher-modal.tsx`, `dm-local-search-modal.tsx`
- Pages: `channels/discover/page.tsx`, `discover/page.tsx`
- API: `/api/search`, `/api/servers/discover`, `/api/apps/discover`
- API: `/api/friends/suggestions`

---

## 8.1 Global Message Search

### `message-search.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open search modal | Click search icon or Ctrl+K | Search modal opens |
| 2 | should search messages by content | Type query → submit | Matching messages returned |
| 3 | should filter search by channel | Select channel filter | Only channel messages shown |
| 4 | should filter search by author | Select author filter | Only that user's messages |
| 5 | should filter search by date range | Set before/after dates | Date-filtered results |
| 6 | should show message context in results | View result | Surrounding messages visible |
| 7 | should jump to message on click | Click result | Navigates to message in channel |
| 8 | should respect channel permissions | Search as user without channel access | No results from hidden channels |
| 9 | should handle no results | Search nonsense | "No results found" |
| 10 | should cap query length at 500 chars | Enter 501+ chars | 400 Bad Request |
| 11 | should highlight matching text | View results | Query terms highlighted |
| 13 | should require authentication | Search without login | 401 Unauthorized |
| 12 | should paginate results | Many results → scroll | More results load |

---

## 8.2 Quickswitcher

### `quickswitcher.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open quickswitcher | Ctrl+K / Cmd+K | Quickswitcher modal opens |
| 2 | should search channels by name | Type channel name | Matching channels listed |
| 3 | should search servers by name | Type server name | Matching servers |
| 4 | should search DM conversations | Type username | DM conversations |
| 5 | should navigate on selection | Click/Enter on result | Navigated to selected item |
| 6 | should navigate with arrow keys | Arrow down/up → Enter | Correct item selected |
| 7 | should show recent items when empty | Open quickswitcher | Recent channels/DMs shown |
| 8 | should close on Escape | Press Escape | Modal closes |
| 9 | should close on selection | Select item | Modal closes |

---

## 8.3 Server Discovery

### `server-discover.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show discover page with tabs | Navigate to `/channels/discover` | My Servers / Discover tabs |
| 2 | should show segmented control (My Servers / Discover) | View page | Segmented control visible |
| 3 | should search public servers | Type in search → results | Filtered servers |
| 4 | should show server cards with info | View discover | Name, icon, description, member count |
| 5 | should join server from discover | Click join | Server joined; appears in sidebar |
| 6 | should show recent servers row | View "My Servers" tab | Recently visited servers |
| 7 | should show inline search | Type in search field | Results filter inline |

---

## 8.4 App Discovery

### `app-discover.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show Apps tab on discover page | Navigate to discover → Apps tab | App catalog shown |
| 2 | should search apps | Type app name | Filtered results |
| 3 | should show app details | Click app | Description, features, install button |
| 4 | should install app from Discover page | Click "Add to Server" → select server | App installed |
| 5 | should show installed indicator | View app already installed | "Installed" badge |
| 6 | should allow unauthenticated browsing | Browse apps without login | Apps catalog visible (public endpoint) |

---

## 8.5 Friend Suggestions

### `friend-suggestions.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show friend suggestions | Navigate to friends page | Suggestions section |
| 2 | should send friend request from suggestion | Click "Add Friend" | Request sent |
| 3 | should dismiss suggestion | Click dismiss/X | Suggestion removed |
| 4 | should require authentication | Access suggestions without login | 401 Unauthorized |
