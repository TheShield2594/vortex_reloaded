# 04 — Direct Messages

> Covers: DM list, DM conversations, DM message send/edit/delete, DM reactions, DM calls, DM search, DM attachments, DM emoji/GIF/sticker pickers, date separators, friends sidebar, encryption keys.

**Components under test:**
- `dm-list.tsx`, `dm-channel-area.tsx`, `dm-area.tsx`, `dm-call.tsx`
- `me-shell.tsx`, `friends-sidebar.tsx`, `dm-local-search-modal.tsx`
- Pages: `channels/me/page.tsx`, `channels/me/[channelId]/page.tsx`
- API: `/api/dm/channels`, `/api/dm/channels/[channelId]`, `/api/dm/channels/[channelId]/messages`
- API: `/api/dm/channels/[channelId]/messages/[messageId]`, `/api/dm/channels/[channelId]/messages/[messageId]/reactions`
- API: `/api/dm/channels/[channelId]/members`, `/api/dm/channels/[channelId]/call`
- API: `/api/dm/channels/[channelId]/keys`, `/api/dm/keys/device`, `/api/dm`
- API: `/api/dm/attachments/[attachmentId]/download`

---

## 4.1 DM List & Navigation

### `dm-list.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show DM list | Navigate to `/channels/me` | DM list displayed |
| 2 | should show recent conversations | View DM list | Conversations sorted by recency |
| 3 | should show unread indicator | Receive DM while on other page → return | Unread badge on conversation |
| 4 | should show user avatar and status | View DM list | Avatar + online/offline status |
| 5 | should show last message preview | View DM list | Snippet of last message shown |
| 6 | should open conversation on click | Click DM item | Conversation loads |
| 7 | should show "Find People" CTA when empty | New user with no DMs | "Find People" + "New Message" buttons |
| 8 | should start new DM from user search | Click "New Message" → search user → select | New DM channel created |
| 9 | should close/hide a DM conversation | Right-click → Close | DM removed from list (not deleted) |
| 10 | should show group DM with multiple avatars | Open group DM | Multiple avatars stacked |

---

## 4.2 DM Messaging

### `dm-send-message.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should send a DM | Open DM → type → send | Message appears in conversation |
| 2 | should receive DM in real time | User A sends to User B | User B sees message immediately |
| 3 | should edit own DM | Right-click → Edit → change → save | Message updated with "(edited)" |
| 4 | should delete own DM | Right-click → Delete → confirm | Message removed |
| 5 | should show date separators in DMs | Messages across days | "Today", "Yesterday", date labels |
| 6 | should group consecutive messages | Send 3 messages in a row | Grouped under single author header |
| 7 | should not group messages across day boundaries | Messages spanning midnight | Separated by date divider |
| 8 | should support markdown in DMs | Send `**bold**` | Renders as bold |
| 9 | should render inline links | Send URL | Clickable link |
| 10 | should show typing indicator in DMs | Other user types | "User is typing..." |

### `dm-reactions.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should add reaction to DM message | Hover → react → pick emoji | Reaction added |
| 2 | should use quick reactions in DMs | Click quick react button | Reaction added |
| 3 | should toggle reaction on click | Click existing reaction | Toggled on/off |
| 4 | should show reaction count | Both users react with same emoji | Count shows 2 |
| 5 | should show full emoji picker for reactions | Click react → "more" | Full picker opens |
| 6 | should sync reactions in real time | User A reacts → User B sees | Reaction appears via realtime |

---

## 4.3 DM Emoji / GIF / Sticker Pickers

### `dm-pickers.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open emoji picker in DM | Click emoji button | Picker opens with search, categories, skin tone |
| 2 | should show all server custom emojis in DM picker | Open picker | Custom emojis grouped by server name |
| 3 | should open GIF picker in DM | Click GIF tab | GIF search + trending |
| 4 | should send GIF in DM | Search → click GIF | GIF URL sent; renders inline |
| 5 | should open sticker picker in DM | Click Stickers tab | Sticker grid |
| 6 | should send sticker in DM | Click sticker | Sticker sent |
| 7 | should render GIF inline in DM messages | Send standalone Klipy/Giphy URL | Renders as inline image |

---

## 4.4 DM Search

### `dm-search.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open DM local search | Click search icon or Ctrl+F | Search modal opens |
| 2 | should search messages in current DM | Type query → search | Matching messages shown |
| 3 | should highlight search matches | View results | Search term highlighted |
| 4 | should jump to message on result click | Click search result | Scrolls to message in conversation |
| 5 | should handle no results | Search for nonsense | "No results" state |

---

## 4.5 DM Calls (Voice/Video)

### `dm-calls.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should initiate DM call | Click call button in DM | Call UI appears; ringing state |
| 2 | should show incoming call UI | Receive call | Incoming call notification with accept/decline |
| 3 | should accept incoming call | Click accept | Call connected; voice active |
| 4 | should decline incoming call | Click decline | Call ended for initiator |
| 5 | should end active call | Click hang up | Call ended for both parties |
| 6 | should mute/unmute during call | Click mute toggle | Mic muted/unmuted |
| 7 | should toggle video during call | Click video toggle | Camera on/off |

---

## 4.6 DM Attachments

### `dm-attachments.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should upload file in DM | Click attach → select file | File uploaded and sent |
| 2 | should show file preview for images | Send image | Thumbnail rendered inline |
| 3 | should download DM attachment | Click download on attachment | File downloads |
| 4 | should compute decay expiry on upload | Upload file | `expires_at` set based on file size |
| 5 | should renew expiry on download near expiry | Download attachment near expiry | `expires_at` extended |
| 6 | should show 410 for purged attachment | Access purged file | "File no longer available" |

---

## 4.7 DM Encryption Keys

### `dm-encryption.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should register device key | Open DMs on new device | Device key registered via `/api/dm/keys/device` |
| 2 | should exchange channel keys | Open DM with user | Channel keys exchanged via `/api/dm/channels/[channelId]/keys` |
| 3 | should handle key mismatch gracefully | Simulate key mismatch | Appropriate error/re-key prompt |

---

## 4.8 Friends Sidebar

### `friends-sidebar.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show friends list | Navigate to `/channels/friends` | Friends listed |
| 2 | should show online/offline friends | View list | Status indicators |
| 3 | should send friend request | Click "Add Friend" → enter username | Request sent |
| 4 | should accept friend request | View pending → Accept | Friend added |
| 5 | should decline friend request | View pending → Decline | Request removed |
| 6 | should remove friend | Right-click friend → Remove | Friend removed |
| 7 | should start DM from friends list | Click "Message" on friend | DM conversation opens |
| 8 | should show friend suggestions | View suggestions section | Suggested users listed |
| 9 | should block a user | Right-click → Block | User blocked; DMs blocked |
| 10 | should unblock a user | Settings → Blocked → Unblock | User unblocked |
