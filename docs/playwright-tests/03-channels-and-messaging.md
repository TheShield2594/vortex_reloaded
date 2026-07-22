# 03 — Channels & Messaging

> Covers: channel CRUD, text messaging, message editing/deletion, reactions, emoji/GIF/sticker pickers, mentions, replies, pins, typing indicator, markdown rendering, link embeds, attachments inline, date separators, message search, message context menu.

**Components under test:**
- `chat-area.tsx`, `message-input.tsx`, `message-item.tsx`, `reply-preview.tsx`
- `emoji-suggestions.tsx`, `custom-emoji-grid.tsx`, `mention-suggestions.tsx`
- `slash-command-suggestions.tsx`, `typing-indicator.tsx`, `markdown-renderer.tsx`
- `link-embed.tsx`, `image-lightbox.tsx`, `pinned-messages-panel.tsx`
- `create-channel-modal.tsx`, `edit-channel-modal.tsx`, `channel-permissions-editor.tsx`
- `announcement-channel.tsx`, `forum-channel.tsx`, `media-channel.tsx`
- `category-header.tsx`, `sortable-channel-item.tsx`
- API: `/api/messages`, `/api/messages/[messageId]/reactions`, `/api/messages/[messageId]/pin`
- API: `/api/servers/[serverId]/channels`, `/api/channels/[channelId]`
- API: `/api/channels/[channelId]/permissions`, `/api/servers/[serverId]/channels/[channelId]/messages/[messageId]`

---

## 3.1 Channel CRUD

### `channel-create.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should create text channel | Click `+` on category → enter name → create | Channel appears in sidebar |
| 2 | should create voice channel | Select voice type → name → create | Voice channel appears with speaker icon |
| 3 | should create announcement channel | Select announcement type → create | Announcement channel with megaphone icon |
| 4 | should create forum channel | Select forum type → create | Forum channel with forum icon |
| 5 | should create media channel | Select media type → create | Media channel appears |
| 6 | should create channel under specific category | Select target category | Channel nested under correct category |
| 7 | should reject empty channel name | Submit with no name | Validation error |
| 8 | should enforce channel name format | Enter "My Channel!" | Auto-slugified or rejected |
| 9 | should require MANAGE_CHANNELS permission | Login as regular user → try create | Create button hidden |

### `channel-edit-delete.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should edit channel name | Right-click channel → Edit → change name | Name updated |
| 2 | should edit channel topic/description | Edit → change topic → save | Topic shown in channel header |
| 3 | should delete channel | Right-click → Delete → confirm | Channel removed from sidebar |
| 4 | should reorder channels via drag-and-drop | Drag channel to new position | Order persisted |
| 5 | should move channel between categories | Drag to different category | Channel moves |

### `channel-permissions.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open channel permissions editor | Channel settings → Permissions | Editor opens |
| 2 | should set role-specific permissions per channel | Override `SEND_MESSAGES` for a role | Permission saved |
| 3 | should deny message send when permission removed | Remove SEND_MESSAGES for role → login as that role | Input disabled / message blocked |
| 4 | should show permission overrides indicator | Set an override | Channel shows lock icon |

---

## 3.2 Sending Messages

### `message-send.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should send a text message | Type message → press Enter | Message appears in chat; sent to server |
| 2 | should send message via send button | Type → click send | Message sent |
| 3 | should show message in real time | User A sends → User B's view | Message appears via realtime subscription |
| 4 | should show author name and avatar | Send message | Author info displayed |
| 5 | should show timestamp on message | Send message | Timestamp visible on hover or grouped |
| 6 | should group consecutive messages from same author | Send 3 messages rapidly | Messages grouped; single author header |
| 7 | should not group messages across day boundaries | Send message at 11:59pm and 12:01am | Date separator between them |
| 8 | should show date separators ("Today", "Yesterday") | View messages from different days | Correct labels |
| 9 | should handle empty message submission | Press Enter with empty input | Nothing sent |
| 10 | should reject message exceeding max length | Paste 4001+ characters | 400 validation error; message not created (max 4000 chars) |
| 11 | should support multiline messages | Shift+Enter for newline | Newlines preserved |
| 12 | should trim leading/trailing whitespace | Send "  hello  " | "hello" displayed |
| 13 | should send message with keyboard shortcut | Type → Enter | Sends (not newline) |

### `message-send-button.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should disable send button when input empty | Clear input | Button grayed out |
| 2 | should enable send button when input has text | Type text | Button becomes active |
| 3 | should disable input when no SEND_MESSAGES perm | Login as restricted user | Input shows permission message |

---

## 3.3 Message Editing

### `message-edit.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should edit own message | Right-click → Edit → change text → save | Message updated; "(edited)" indicator shown |
| 2 | should cancel edit with Escape | Start editing → press Escape | Original message restored |
| 3 | should not allow editing others' messages | Right-click someone else's message | Edit option hidden |
| 4 | should show edit history indicator | Edit message | "(edited)" label visible |
| 5 | should preserve markdown after edit | Edit markdown message → save | Markdown still renders |
| 6 | should edit via keyboard shortcut (Up arrow) | Press Up arrow in empty input | Last message enters edit mode |

---

## 3.4 Message Deletion

### `message-delete.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should delete own message | Right-click → Delete → confirm | Message removed |
| 2 | should delete others' messages with MANAGE_MESSAGES | Login as mod → delete member's message | Message removed; audit log entry |
| 3 | should show confirmation dialog | Click delete | "Are you sure?" dialog |
| 4 | should not allow deleting others' messages without permission | Login as regular user | Delete option hidden |

---

## 3.5 Reactions

### `message-reactions.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should add reaction via emoji picker | Hover message → click react → pick emoji | Reaction added below message |
| 2 | should add quick reaction | Hover → click quick react emoji | Reaction added |
| 3 | should show reaction count | Multiple users react with same emoji | Count shows "3" etc. |
| 4 | should toggle own reaction on click | Click existing reaction | Reaction toggled (add/remove) |
| 5 | should show who reacted on hover | Hover reaction bubble | Tooltip with usernames |
| 6 | should add custom server emoji reaction | Open picker → custom section → click | Custom emoji reaction shown |
| 7 | should remove reaction | Click own reaction | Reaction removed |
| 8 | should support multiple different reactions | Add 3 different emojis | All 3 shown |

---

## 3.6 Emoji System

### `emoji-picker.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open emoji picker | Click emoji icon in message input | Picker opens |
| 2 | should search emojis | Type in search field | Filtered results |
| 3 | should select emoji and insert in input | Click emoji | Emoji inserted at cursor position |
| 4 | should show emoji categories | Open picker | Categories tabs (Smileys, People, etc.) |
| 5 | should show custom server emojis at top | Open picker in server channel | "Custom" section with server emojis |
| 6 | should show skin tone selector | Click skin tone button | Skin tone options |
| 7 | should close picker after selection | Click emoji | Picker closes; focus returns to input |

### `emoji-autocomplete.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should trigger autocomplete on `:` | Type `:smi` | Suggestions dropdown |
| 2 | should filter suggestions as you type | Type `:smile` → `:smiling` | Results narrow |
| 3 | should insert emoji on selection | Click suggestion or press Enter | `:smile:` replaced with emoji |
| 4 | should show custom emojis in autocomplete | Type `:custom` | Server custom emojis appear |
| 5 | should navigate suggestions with arrow keys | Type `:sm` → press down arrow | Selection moves |
| 6 | should dismiss with Escape | Type `:sm` → press Escape | Suggestions close |

### `custom-emojis.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should upload custom emoji (PNG) | Server settings → Emojis → upload PNG | Emoji saved; appears in picker |
| 2 | should upload custom emoji (GIF animated) | Upload GIF | Animated emoji works |
| 3 | should upload custom emoji (WEBP) | Upload WEBP | Emoji saved |
| 4 | should reject file > 256 KB | Upload large file | Error: "File too large" |
| 5 | should reject non-image file | Upload .txt | Error: "Invalid file type" |
| 6 | should show uploader attribution | View emoji management | Uploader name + date shown |
| 7 | should delete custom emoji | Click delete on emoji → confirm | Emoji removed |
| 8 | should require MANAGE_EMOJIS permission | Login as regular user | Upload button hidden |
| 9 | should create audit log on upload | Upload emoji | `emoji_uploaded` audit entry |
| 10 | should create audit log on delete | Delete emoji | `emoji_deleted` audit entry |
| 11 | should show custom emojis in DM picker | Open emoji picker in DM | All server emojis grouped by server |

---

## 3.7 GIF Picker

### `gif-picker.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open GIF picker tab | Click GIF tab in picker | GIF grid shown |
| 2 | should show trending GIFs by default | Open picker without search | "Trending" header + GIFs |
| 3 | should search GIFs | Type search query | Search results shown |
| 4 | should show autocomplete suggestions | Type partial query | Suggestions dropdown |
| 5 | should send GIF on click | Click GIF | GIF URL sent as message |
| 6 | should render GIF inline in chat | Send GIF URL | GIF renders as image |
| 7 | should fallback from Klipy to Giphy | Mock Klipy failure | Giphy results shown |
| 8 | should handle search with no results | Search for nonsense string | "No results" state |

---

## 3.8 Sticker Picker

### `sticker-picker.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open sticker picker tab | Click Stickers tab | Sticker grid shown |
| 2 | should show trending stickers | Open without search | Trending stickers |
| 3 | should search stickers | Type query | Filtered stickers |
| 4 | should send sticker on click | Click sticker | Sticker sent as message |
| 5 | should render sticker inline | Send sticker | Sticker displays in chat |

---

## 3.9 Mentions

### `mentions.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should trigger mention autocomplete on `@` | Type `@us` | User suggestions dropdown |
| 2 | should show matching users | Type `@john` | Users matching "john" listed |
| 3 | should insert mention on selection | Click user suggestion | `@username` inserted with special formatting |
| 4 | should mention render as highlighted in message | View sent message with mention | Mention is highlighted/clickable |
| 5 | should show `@everyone` option | Type `@every` | `@everyone` in suggestions |
| 6 | should show `@here` option | Type `@here` | `@here` in suggestions |
| 7 | should mention roles | Type `@Admin` | Role mention option |
| 8 | should notify mentioned user | Mention user → check their notifications | Notification received |

---

## 3.10 Replies

### `message-replies.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should reply to a message | Right-click → Reply | Reply preview shown above input |
| 2 | should show reply reference in sent message | Send reply | Reply shows linked original message |
| 3 | should cancel reply | Click X on reply preview | Reply preview removed |
| 4 | should jump to original message on click | Click reply reference | Scrolls to and highlights original |
| 5 | should show "message deleted" for deleted original | Delete original → view reply | "Original message was deleted" |

---

## 3.11 Pinned Messages

### `pinned-messages.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should pin a message | Right-click → Pin → confirm | Message pinned |
| 2 | should open pinned messages panel | Click pin icon in channel header | Panel opens with pinned messages |
| 3 | should unpin a message | Click unpin in panel | Message unpinned |
| 4 | should jump to pinned message in chat | Click pinned message | Scrolls to message |
| 5 | should require MANAGE_MESSAGES to pin | Login as regular user | Pin option hidden |

---

## 3.12 Typing Indicator

### `typing-indicator.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show typing indicator when another user types | User A types → User B sees | "UserA is typing..." shown |
| 2 | should show multiple users typing | 2 users type simultaneously | "UserA and UserB are typing..." |
| 3 | should hide indicator when user stops typing | Stop typing after delay | Indicator disappears |
| 4 | should hide indicator when message is sent | User sends message | Indicator gone |

---

## 3.13 Markdown Rendering

### `markdown-rendering.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should render **bold** text | Send `**bold**` | Bold text displayed |
| 2 | should render *italic* text | Send `*italic*` | Italic text displayed |
| 3 | should render `inline code` | Send `` `code` `` | Code with monospace font |
| 4 | should render code blocks with syntax highlighting | Send triple-backtick code block | Highlighted code block |
| 5 | should render bulleted lists | Send `- item` | Bulleted list |
| 6 | should render numbered lists | Send `1. item` | Numbered list |
| 7 | should render links | Send `https://example.com` | Clickable link |
| 8 | should render blockquotes | Send `> quote` | Blockquote styling |
| 9 | should render strikethrough | Send `~~text~~` | Strikethrough |
| 10 | should sanitize XSS attempts | Send `<script>alert('xss')</script>` | Script tag stripped; text shown |
| 11 | should sanitize iframe injection | Send `<iframe src="evil">` | iframe stripped |
| 12 | should allow vortex-* custom elements | Send custom element | Passes through sanitizer |
| 13 | should render Twemoji images | Send unicode emoji | Twemoji rendered |

---

## 3.14 Link Embeds & oEmbed

### `link-embeds.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show link preview for URLs | Send a URL with OG tags | Preview card with title, description, image |
| 2 | should render YouTube embed | Send YouTube link | Embed player shown |
| 3 | should render Twitter/X embed | Send tweet link | Tweet card shown |
| 4 | should handle URL with no OG data | Send plain URL | Just the link, no preview |
| 5 | should handle oEmbed API errors | Mock oEmbed failure | Link displayed without embed; no error |
| 6 | should render GIF URLs inline | Send Klipy/Giphy URL | GIF inline image |

---

## 3.15 Channel Types

### `announcement-channel.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show announcement channel UI | Navigate to announcement channel | Special header/styling |
| 2 | should restrict posting to authorized roles | Login as regular user | Cannot post |
| 3 | should allow publishing announcements | Authorized user posts | Published to followers |

### `forum-channel.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show forum post list | Navigate to forum channel | Post list view |
| 2 | should create new forum post | Click new post → fill title + body | Post created |
| 3 | should reply to forum post | Open post → type reply | Reply added |
| 4 | should sort posts by recent/popular | Change sort | Order changes |

### `media-channel.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show media gallery view | Navigate to media channel | Gallery grid |
| 2 | should upload media to channel | Upload image/video | Appears in gallery |
| 3 | should open media in lightbox | Click media item | Lightbox opens |

---

## 3.16 Slash Commands

### `slash-commands.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should trigger command autocomplete on `/` | Type `/` in input | Command suggestions dropdown |
| 2 | should filter commands as you type | Type `/give` | Filtered commands shown |
| 3 | should show command description | View autocomplete | Description for each command |
| 4 | should execute command on selection | Select `/standup` → fill args → send | Command executed |
| 5 | should show error for invalid command | Type `/nonexistent` → send | Error message |
| 6 | should require USE_APPLICATION_COMMANDS | Login as restricted user | Commands not available |
