# Feature Gap Implementation Plans

> Generated: 2026-03-17
> Companion to: [feature-parity-audit.md](./feature-parity-audit.md)

This document provides concrete implementation plans for all 🔴 Critical and 🟡 Nice-to-have gaps.
🔴 Gaps 1–5 have been **scaffolded** (code written). Gap 6 is planned.
🟡 Gaps 7–24 are fully planned with file-level detail.

---

## Gap 1: Inline Audio/Video Player ✅ IMPLEMENTED

**Complexity:** S (Small)
**Stack fit:** Yes — native `<audio>` and `<video>` HTML5 elements, no new deps.

### Files Modified
- `apps/web/components/chat/message-item.tsx` — `AttachmentDisplay` component

### What Changed
- Added MIME-type detection: `isVideo = content_type?.startsWith("video/")`, `isAudio = content_type?.startsWith("audio/")`
- Video: Renders `<video controls preload="metadata">` with max-height 320px, filename + size label below
- Audio: Renders `<audio controls preload="metadata">` inside a styled card with file extension badge
- Both use existing `/api/attachments/{id}/download` URL pattern
- Only shown for `isDownloadable` (clean scan state) attachments
- Includes `<track kind="captions" />` for accessibility compliance on video

### Not Changed
- DM message rendering (`dm-channel-area.tsx`) — uses markdown-link pattern for images, not `AttachmentDisplay`. DMs would need separate work if file uploads are added to DMs beyond the current image-only flow.

---

## Gap 2: Screen Share with System Audio ✅ IMPLEMENTED

**Complexity:** S (Small)
**Stack fit:** Yes — browser-native `getDisplayMedia` API.

### Files Modified
- `apps/web/lib/webrtc/use-voice.ts` — P2P WebRTC screen share

### What Changed
- Changed `audio: false` → `audio: true` in `getDisplayMedia()` constraints
- Added audio track forwarding: after capturing, `stream.getAudioTracks()[0]` is added to each peer connection via `pc.addTrack(audioTrack, stream)`
- Added cleanup: `onended` handler now also stops audio tracks

### Not Changed
- `use-livekit-voice.ts` — LiveKit handles `setScreenShareEnabled()` internally and already supports system audio capture by default when the browser offers it. No change needed.
- The dual WebRTC/LiveKit architecture is preserved.

---

## Gap 3: Notification Quiet Hours ✅ IMPLEMENTED

**Complexity:** M (Medium)
**Stack fit:** Yes — Supabase columns + Intl.DateTimeFormat for timezone math.

### Files Created
- `supabase/migrations/00064_quiet_hours.sql` — Adds 4 columns to `user_notification_preferences`
- `apps/web/lib/quiet-hours.ts` — `isInQuietHours()` utility

### Files Modified
- `apps/web/app/api/user/notification-preferences/route.ts` — Extended type, GET select, PUT validation for new fields
- `apps/web/lib/push.ts` — `sendPushToUser()` checks quiet hours before sending
- `apps/web/components/settings/notifications-settings-page.tsx` — New "Quiet Hours" UI section

### Schema
```sql
ALTER TABLE user_notification_preferences
  ADD quiet_hours_enabled  BOOLEAN DEFAULT FALSE,
  ADD quiet_hours_start    TIME    DEFAULT '22:00',
  ADD quiet_hours_end      TIME    DEFAULT '08:00',
  ADD quiet_hours_timezone TEXT    DEFAULT 'UTC';
```

### How It Works
1. User enables quiet hours and sets start/end times + timezone in Settings > Notifications
2. When `sendPushToUser()` fires, it queries the user's quiet hours preferences
3. `isInQuietHours()` uses `Intl.DateTimeFormat` to convert current UTC time to user's local timezone
4. If current time falls within the quiet window, push is suppressed (function returns early)
5. Supports overnight ranges (e.g., 22:00 → 08:00) and same-day ranges (e.g., 09:00 → 17:00)

---

## Gap 4: Screen Reader aria-live for Chat ✅ IMPLEMENTED

**Complexity:** S (Small)
**Stack fit:** Yes — native ARIA attributes.

### Files Modified
- `apps/web/components/chat/chat-area.tsx`

### What Changed
1. **Message container** — Added `aria-label="Message history"` and `aria-relevant="additions"` to the scroll container (`role="log"`)
2. **Live announcements** — Moved the `setLiveAnnouncement()` call to fire for ALL incoming messages from other users, not just when the user is scrolled away. Includes a content preview (first 120 chars) so screen reader users get context.
3. The existing `aria-live="polite"` region and typing announcement region were already present and are now more useful.

### Not Changed
- The `role="log"` and `aria-atomic="true"` structure was already correct. No structural changes to the message list.

---

## Gap 5: User Data Export (GDPR) ✅ IMPLEMENTED

**Complexity:** M (Medium)
**Stack fit:** Yes — standard Supabase queries + JSON download.

### Files Created
- `apps/web/app/api/users/export/route.ts` — GET endpoint that assembles user data

### Files Modified
- `apps/web/components/settings/security-settings-page.tsx` — Added "Your Data" section with Download button

### How It Works
1. `GET /api/users/export` authenticates via Supabase session (same pattern as all other API routes)
2. Runs 7 parallel queries to gather: profile, messages (10k), DM messages (10k), friendships, server memberships, notification preferences, reactions (5k)
3. Returns JSON with `Content-Disposition: attachment` header to trigger browser download
4. UI button in Security & Privacy settings triggers fetch → blob → download via temporary `<a>` element

### Data Included
| Category | Source Table | Limit |
|---|---|---|
| Profile | `users` | 1 row |
| Messages | `messages` | 10,000 |
| DM Messages | `dm_messages` | 10,000 |
| Friendships | `friendships` | All |
| Server Memberships | `server_members` + `servers` | All |
| Notification Preferences | `user_notification_preferences` | 1 row |
| Reactions | `reactions` | 5,000 |

### Future Enhancements
- Add file attachment export (ZIP with actual files from Supabase Storage)
- Add background job processing for very large exports
- Add rate limit (once per 24h) — currently client-gated only

---

## Gap 6: Public Bot API + Token Auth 📋 PLANNED

**Complexity:** L (Large) — ~1-2 weeks
**Stack fit:** Mostly yes. Requires new auth path (bearer token) alongside existing session cookies.

### Overview
Create a bot user type and token-based authentication so external developers can build integrations. This is the highest-effort gap but critical for ecosystem growth.

### Migration: `00065_bot_tokens.sql`

```sql
-- Bot accounts (subset of users table)
CREATE TABLE IF NOT EXISTS public.bot_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  username    TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url  TEXT,
  bio         TEXT,
  is_public   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API tokens for bots
CREATE TABLE IF NOT EXISTS public.bot_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id      UUID NOT NULL REFERENCES public.bot_accounts(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,  -- SHA-256 of the token (never store plaintext)
  name        TEXT NOT NULL DEFAULT 'default',
  scopes      TEXT[] NOT NULL DEFAULT ARRAY['messages.read', 'messages.write'],
  last_used_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bot installations per server
CREATE TABLE IF NOT EXISTS public.bot_installations (
  bot_id     UUID NOT NULL REFERENCES public.bot_accounts(id) ON DELETE CASCADE,
  server_id  UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  installed_by UUID NOT NULL REFERENCES public.users(id),
  permissions INTEGER NOT NULL DEFAULT 0,  -- bitmask from @vortex/shared
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, server_id)
);

ALTER TABLE public.bot_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_installations ENABLE ROW LEVEL SECURITY;
```

### New Files

| File | Purpose |
|---|---|
| `apps/web/app/api/bots/route.ts` | CRUD for bot accounts (create, list owned bots) |
| `apps/web/app/api/bots/[botId]/tokens/route.ts` | Token generation + revocation |
| `apps/web/app/api/bots/[botId]/install/route.ts` | Install bot to a server |
| `apps/web/lib/bot-auth.ts` | Token validation middleware: hash incoming bearer token, look up `bot_tokens`, resolve bot_id + scopes |
| `packages/shared/src/index.ts` | Add `BOT_SCOPES` enum (no new permission bits needed — bots use existing permission bitmask via `bot_installations.permissions`) |

### Modified Files

| File | Change |
|---|---|
| `apps/web/proxy.ts` | Add bearer token path: if `Authorization: Bot <token>` header present, resolve bot identity instead of Supabase session. Route to same API handlers but with bot context. |
| `apps/web/lib/server-auth.ts` | Add `getBotPermissions()` that reads `bot_installations.permissions` for the current server |

### Auth Flow
1. Developer creates bot account via UI or `POST /api/bots`
2. Generates a token via `POST /api/bots/{id}/tokens` — plaintext shown once, SHA-256 stored
3. Server admin installs bot via `POST /api/bots/{id}/install` with permission bitmask
4. Bot makes API calls with `Authorization: Bot <token>` header
5. `proxy.ts` detects the header, resolves bot identity, and attaches it to the request context
6. Existing API routes check permissions using the bot's installed permission bitmask

### Scopes
- `messages.read` — Read messages in installed servers
- `messages.write` — Send messages
- `members.read` — Read member lists
- `channels.read` — Read channel lists
- `reactions.write` — Add reactions
- `webhooks.manage` — Manage webhooks

### What This Does NOT Change
- Existing permission bitmask system (bots reuse it via `bot_installations.permissions`)
- Existing WebRTC/LiveKit voice architecture (bots are text-only initially)
- Existing offline/outbox message consistency model
- Existing server templates schema

---

# 🟡 Nice-to-Have Gap Plans

---

## Gap 7: Thread Auto-Archive 📋 PLANNED

**Complexity:** S (Small)
**Stack fit:** Yes — cron job + existing `archived`/`archived_at`/`auto_archive_duration` columns.

### Context
The `threads` table already has `archived` (bool), `archived_at` (timestamptz), and `auto_archive_duration` (integer, minutes, default 1440 = 24h). The columns exist but nothing sets them automatically.

### Files to Create

| File | Purpose |
|---|---|
| `apps/web/app/api/cron/thread-archive/route.ts` | Cron handler: queries threads where `archived = false AND updated_at < NOW() - auto_archive_duration` and bulk-sets `archived = true, archived_at = NOW()` |

### Files to Modify

| File | Change |
|---|---|
| `apps/web/vercel.json` | Add cron schedule: `{ "path": "/api/cron/thread-archive", "schedule": "0 * * * *" }` (hourly) |

### Implementation
```sql
-- The cron route runs this (via service-role client):
UPDATE threads
SET archived = TRUE, archived_at = NOW()
WHERE archived = FALSE
  AND updated_at < NOW() - (auto_archive_duration || ' minutes')::interval;
```

Auth pattern: Bearer `CRON_SECRET` header (same as `event-reminders`). Returns `{ archived: count }`.

---

## Gap 8: Outgoing Webhooks / Event Subscriptions 📋 PLANNED

**Complexity:** M (Medium)
**Stack fit:** Yes — leverages existing `app_event_subscriptions` table from apps platform.

### Context
The `app_event_subscriptions` table already exists (migration 00021) with `app_install_id`, `event_key`, and `enabled` columns. The `server_app_install_credentials` table can store the outgoing webhook URL. What's missing is the event dispatch pipeline.

### Migration: `00065_outgoing_webhooks.sql`

```sql
CREATE TABLE IF NOT EXISTS public.outgoing_webhooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id   UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id  UUID REFERENCES public.channels(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Outgoing Webhook',
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,                -- HMAC signing secret
  events      TEXT[] NOT NULL DEFAULT ARRAY['message.created'],
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.outgoing_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Server admins manage outgoing webhooks"
  ON public.outgoing_webhooks FOR ALL
  USING (EXISTS (
    SELECT 1 FROM server_members sm
    WHERE sm.server_id = outgoing_webhooks.server_id
      AND sm.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM server_members sm
    WHERE sm.server_id = outgoing_webhooks.server_id
      AND sm.user_id = auth.uid()
  ));
```

### Files to Create

| File | Purpose |
|---|---|
| `apps/web/lib/outgoing-webhooks.ts` | `dispatchEvent(serverId, event, payload)` — queries `outgoing_webhooks` for matching events, sends POST with HMAC-SHA256 signature in `X-Vortex-Signature` header, 5s timeout, fire-and-forget |
| `apps/web/app/api/servers/[serverId]/outgoing-webhooks/route.ts` | CRUD for outgoing webhook registrations (requires MANAGE_WEBHOOKS permission) |

### Files to Modify

| File | Change |
|---|---|
| `apps/web/app/api/servers/[serverId]/channels/[channelId]/messages/[messageId]/route.ts` | After message insert, call `dispatchEvent(serverId, "message.created", { message, channel, author })` |

### Supported Events (initial set)
- `message.created` — new message in a channel
- `member.joined` — user joins server
- `member.left` — user leaves server
- `reaction.added` — reaction on a message

### Payload Format
```json
{
  "event": "message.created",
  "server_id": "...",
  "timestamp": "2026-03-17T...",
  "data": { ... }
}
```

Header: `X-Vortex-Signature: sha256=<HMAC of body using webhook secret>`

---

## Gap 9: Channel Archiving 📋 PLANNED

**Complexity:** S (Small)
**Stack fit:** Yes — simple boolean column + sidebar/input gating.

### Migration: `00066_channel_archiving.sql`

```sql
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.users(id) ON DELETE SET NULL;
```

### Files to Modify

| File | Change |
|---|---|
| `apps/web/components/layout/channel-sidebar.tsx` | Archived channels rendered in collapsed "Archived" section at bottom with lock icon; excluded from default channel list unless expanded |
| `apps/web/components/chat/message-input.tsx` | If `channel.archived`, show read-only banner instead of composer: "This channel is archived and read-only" |
| `apps/web/app/api/servers/[serverId]/channels/[channelId]/route.ts` | PATCH accepts `{ archived: boolean }` — requires MANAGE_CHANNELS permission. Sets `archived_at` and `archived_by` on archive. Inserts audit log entry. |
| `apps/web/components/modals/edit-channel-modal.tsx` | Add "Archive channel" toggle in channel settings |

### Permission
Uses existing `MANAGE_CHANNELS` permission bit — no new bits needed.

---

## Gap 10: Sticker Packs 📋 PLANNED

**Complexity:** M (Medium)
**Stack fit:** Yes — extends existing emoji system (Supabase Storage + same upload patterns).

### Migration: `00067_sticker_packs.sql`

```sql
CREATE TABLE IF NOT EXISTS public.sticker_packs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id   UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stickers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id     UUID NOT NULL REFERENCES public.sticker_packs(id) ON DELETE CASCADE,
  server_id   UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  url         TEXT NOT NULL,
  format      TEXT NOT NULL CHECK (format IN ('png', 'gif', 'webp', 'lottie')),
  width       INTEGER NOT NULL DEFAULT 320,
  height      INTEGER NOT NULL DEFAULT 320,
  uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sticker_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view stickers" ON public.stickers FOR SELECT
  USING (EXISTS (SELECT 1 FROM server_members WHERE server_id = stickers.server_id AND user_id = auth.uid()));
CREATE POLICY "Members view sticker packs" ON public.sticker_packs FOR SELECT
  USING (EXISTS (SELECT 1 FROM server_members WHERE server_id = sticker_packs.server_id AND user_id = auth.uid()));
```

### Files to Create

| File | Purpose |
|---|---|
| `apps/web/app/api/servers/[serverId]/stickers/route.ts` | CRUD: upload sticker (Supabase Storage `server-stickers` bucket), list by pack, delete. Requires MANAGE_WEBHOOKS or ADMINISTRATOR. |
| `apps/web/components/chat/sticker-picker.tsx` | Tab in existing emoji/GIF picker showing sticker packs as grid. Click sends sticker as special message with `[sticker:id]` content format. |

### Files to Modify

| File | Change |
|---|---|
| `apps/web/components/chat/message-input.tsx` | Add "Stickers" as third tab in picker (`pickerTab: "emoji" \| "gif" \| "sticker"`) |
| `apps/web/components/chat/message-item.tsx` | Detect `[sticker:uuid]` pattern in content; render as 160×160 image instead of text |
| `apps/web/components/modals/server-settings-modal.tsx` | Add "Stickers" tab alongside existing "Emojis" tab |

---

## Gap 11: Message Scheduling 📋 PLANNED

**Complexity:** M (Medium)
**Stack fit:** Yes — DB table + cron job (same pattern as event-reminders).

### Migration: `00068_scheduled_messages.sql`

```sql
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel_id      UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  server_id       UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  scheduled_for   TIMESTAMPTZ NOT NULL,
  sent            BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_messages_pending
  ON scheduled_messages (scheduled_for) WHERE sent = FALSE;

ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own scheduled messages"
  ON public.scheduled_messages FOR ALL
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());
```

### Files to Create

| File | Purpose |
|---|---|
| `apps/web/app/api/scheduled-messages/route.ts` | POST to create, GET to list user's pending, DELETE to cancel |
| `apps/web/app/api/cron/scheduled-messages/route.ts` | Cron (every minute): query `WHERE sent = false AND scheduled_for <= NOW()`, insert as real messages, mark `sent = true` |

### Files to Modify

| File | Change |
|---|---|
| `apps/web/components/chat/message-input.tsx` | Add clock icon next to send button. Click opens date/time picker. Shift+Enter could also open scheduler. Submit calls `/api/scheduled-messages` instead of direct send. |

---

## Gap 12: Rich-Text Formatting Toolbar 📋 PLANNED

**Complexity:** S (Small)
**Stack fit:** Yes — toolbar inserts markdown syntax around selection, no new deps.

### Context
The message input is a plain `<textarea>`. Discord doesn't have a toolbar either. This would be a convenience wrapper that inserts markdown syntax.

### Files to Create

| File | Purpose |
|---|---|
| `apps/web/components/chat/formatting-toolbar.tsx` | Row of buttons: **B** (bold), *I* (italic), ~~S~~ (strikethrough), `<>` (code), ``` (code block), > (quote), list. Each wraps selection with markdown syntax (e.g., `**selection**`). |

### Files to Modify

| File | Change |
|---|---|
| `apps/web/components/chat/message-input.tsx` | Import `FormattingToolbar`. Render above textarea when `showFormattingToolbar` is true (toggle via button or Ctrl+Shift+M). Pass `textareaRef` so toolbar can read selection and insert markdown. |

### Implementation Notes
- Toolbar reads `textarea.selectionStart`/`selectionEnd`, wraps selection with syntax markers
- If no selection, inserts placeholder: `**bold text**` with inner text selected
- Each button has tooltip showing keyboard shortcut (Ctrl+B, Ctrl+I, etc.)
- Keyboard shortcuts handled in `composer-keybindings.ts`

---

## Gap 13: Video Background Blur 📋 PLANNED

**Complexity:** M (Medium)
**Stack fit:** Requires new dependency — `@mediapipe/selfie_segmentation` or TensorFlow.js `@tensorflow-models/body-segmentation`.
**New dep:** Yes — `@mediapipe/selfie_segmentation` (~2MB WASM)

### Files to Create

| File | Purpose |
|---|---|
| `apps/web/lib/webrtc/video-background.ts` | `createBackgroundBlurProcessor(stream)` — uses MediaPipe Selfie Segmentation to separate person from background. Returns a new `MediaStream` with blurred background composited via `OffscreenCanvas`. |

### Files to Modify

| File | Change |
|---|---|
| `apps/web/lib/webrtc/use-voice.ts` | In `toggleVideo()`, optionally pass camera stream through `createBackgroundBlurProcessor()` before adding to peer connections. Controlled by `backgroundBlur` state boolean. |
| `apps/web/lib/webrtc/use-livekit-voice.ts` | LiveKit has built-in background blur via `BackgroundBlur()` processor — just enable it on `createLocalVideoTrack({ processor: BackgroundBlur() })` |
| `apps/web/components/voice/voice-channel.tsx` | Add "Blur background" toggle button in voice controls bar |
| `apps/web/lib/stores/voice-audio-store.ts` | Add `backgroundBlur: boolean` to persisted settings |

### Trade-offs
- ~2MB WASM download on first use (lazy-loaded)
- CPU-intensive: ~30% on mid-range devices. Should show warning.
- Discord doesn't have this, so it's not expected by the core audience. Slack/Teams do.

---

## Gap 14: Hand Raise in General Voice 📋 PLANNED

**Complexity:** S (Small)
**Stack fit:** Yes — signaling event through existing Socket.IO / LiveKit data channel.

### Context
Stage channels already have "Request to Speak" tied to `canSpeak` permission. General voice channels need a lighter "hand raise" that's purely visual, not permission-gated.

### Files to Modify

| File | Change |
|---|---|
| `packages/shared/src/index.ts` | Add to `SignalingEvents`: `'hand-raise': { raised: boolean }`. Add to `SignalingServerEvents`: `'peer-hand-raised': { peerId: string; raised: boolean }`. No new permission bits. |
| `apps/signal/src/index.ts` | Handle `hand-raise` event: broadcast `peer-hand-raised` to room peers |
| `apps/web/lib/webrtc/use-voice.ts` | Add `handRaised` state + `toggleHandRaise()`. Emit `hand-raise` via socket. Track `peerHandRaises` map from `peer-hand-raised` events. |
| `apps/web/lib/webrtc/use-livekit-voice.ts` | Use LiveKit `localParticipant.setMetadata(JSON.stringify({ handRaised }))` for state sync. Read from participant metadata in room events. |
| `apps/web/lib/webrtc/use-unified-voice.ts` | Expose `handRaised`, `toggleHandRaise`, `peerHandRaises` in unified interface |
| `apps/web/components/voice/voice-channel.tsx` | Add ✋ button in controls bar. Show raised-hand indicator on participant tiles (yellow badge). |
| `apps/web/components/voice/voice-grid-layout.tsx` | Render hand-raise emoji overlay on participant tiles where `peerHandRaises[peerId]` is true |

---

## Gap 15: Saved Searches 📋 PLANNED

**Complexity:** S (Small)
**Stack fit:** Yes — localStorage for simplicity (no migration needed).

### Files to Modify

| File | Change |
|---|---|
| `apps/web/components/modals/search-modal.tsx` | Add "Save search" button next to search input. Saved searches stored in localStorage under `vortexchat:saved-searches:${userId}` as `Array<{ query, filters, savedAt }>`. Show saved searches in dropdown when search input is focused and empty. "Remove" button per saved search. Max 20 saved searches. |

### Alternative (DB-backed)
If persistence across devices is wanted, add a `user_saved_searches` table with `user_id`, `query`, `filters` (JSONB), `created_at`. But localStorage is simpler and sufficient initially.

---

## Gap 16: Mobile Push (Native App) 📋 PLANNED

**Complexity:** L (Large)
**Stack fit:** No — requires Capacitor or React Native wrapper, separate build pipeline.
**Verdict:** 🟢 Intentional skip for now. PWA push works on Android and iOS 16.4+. A native wrapper would be a major project (~2-4 weeks) with ongoing maintenance. Revisit when user base demands it.

### If Pursued
- **Approach:** Capacitor wrapper around the existing Next.js PWA
- **Files to create:** `apps/mobile/` directory with Capacitor config, native push registration via `@capacitor/push-notifications`, and custom URL scheme handling
- **Estimated effort:** L (2-4 weeks)

---

## Gap 17: Outgoing Webhooks — Zapier/Make Connector 📋 PLANNED

**Complexity:** S (Small) — depends on Gap 8 (outgoing webhooks)
**Stack fit:** Yes — once outgoing webhooks exist, Zapier/Make connect via standard webhook triggers.

### Implementation
Once outgoing webhooks (Gap 8) are built, Zapier/Make integration is automatic:
1. User creates a Zap/Scenario with "Webhooks by Zapier" / "Custom Webhook" trigger
2. Copies the Zapier/Make webhook URL
3. Creates an outgoing webhook in VortexChat pointing to that URL
4. Events flow: VortexChat → outgoing webhook → Zapier/Make → downstream actions

No additional code needed beyond Gap 8. Could optionally add a "Connect to Zapier" button in the outgoing webhooks UI that opens Zapier's integration page.

---

## Gap 18: OAuth2 for Third-Party Apps 📋 PLANNED

**Complexity:** L (Large)
**Stack fit:** Partially — requires OAuth2 authorization server, which is a significant addition.

### Context
The existing apps platform (`app_catalog`, `server_app_installs`) is internal-only. Third-party developers would need an OAuth2 flow to get access tokens for their apps.

### Prerequisite
Gap 6 (Bot API + token auth) should be built first. OAuth2 is the next evolution.

### Migration: `00069_oauth_apps.sql`

```sql
CREATE TABLE IF NOT EXISTS public.oauth_applications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  icon_url      TEXT,
  redirect_uris TEXT[] NOT NULL,
  client_secret TEXT NOT NULL,             -- hashed
  scopes        TEXT[] NOT NULL DEFAULT ARRAY['identify'],
  is_public     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.oauth_authorizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          UUID NOT NULL REFERENCES public.oauth_applications(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  server_id       UUID REFERENCES public.servers(id) ON DELETE CASCADE,
  scopes          TEXT[] NOT NULL,
  access_token    TEXT NOT NULL UNIQUE,      -- hashed
  refresh_token   TEXT UNIQUE,               -- hashed
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Files to Create

| File | Purpose |
|---|---|
| `apps/web/app/api/oauth/authorize/route.ts` | Authorization endpoint: show consent screen, redirect with code |
| `apps/web/app/api/oauth/token/route.ts` | Token exchange: code → access_token + refresh_token |
| `apps/web/app/api/oauth/revoke/route.ts` | Token revocation |
| `apps/web/app/(auth)/authorize/page.tsx` | Consent screen UI: "App X wants to access your account" |
| `apps/web/app/api/oauth/applications/route.ts` | Developer portal: CRUD for OAuth apps |

### Scopes
- `identify` — Read user profile
- `servers` — List user's servers
- `messages.read` — Read messages in authorized servers
- `messages.write` — Send messages
- `bot` — Combined scope for bot-style access

---

## Gap 19: SSO / SAML 📋 PLANNED

**Complexity:** M (Medium)
**Stack fit:** Yes — Supabase Auth natively supports SAML via configuration.

### Implementation
Supabase Auth supports SAML 2.0 SSO out of the box. The work is mostly configuration + UI.

### Files to Create

| File | Purpose |
|---|---|
| `apps/web/app/api/auth/sso/route.ts` | Initiates SAML login flow via `supabase.auth.signInWithSSO({ domain })` |
| `apps/web/components/settings/server-settings-admin.tsx` | Add "SSO Configuration" section for server admins: enable/disable SSO, upload IdP metadata XML, set domain |

### Files to Modify

| File | Change |
|---|---|
| `apps/web/app/(auth)/login/page.tsx` | Add "Sign in with SSO" button below email/password form. Shows domain input field, calls `/api/auth/sso`. |

### Supabase Config
```toml
# supabase/config.toml
[auth.external.saml]
enabled = true
```

Provider-specific metadata uploaded per-organization via Supabase dashboard or management API.

### Trade-offs
- Only relevant for enterprise/education deployments
- Supabase Cloud Pro plan required for SAML
- Consider gating behind a server-level "Enterprise" setting

---

## Gap 20: Vanity Invite URLs 📋 PLANNED

**Complexity:** S (Small)
**Stack fit:** Yes — single column addition to `servers` table.

### Migration: `00070_vanity_invite.sql`

```sql
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS vanity_url TEXT UNIQUE;

-- Only allow alphanumeric + hyphens, 3-32 chars
ALTER TABLE public.servers
  ADD CONSTRAINT vanity_url_format CHECK (vanity_url IS NULL OR vanity_url ~ '^[a-z0-9-]{3,32}$');
```

### Files to Modify

| File | Change |
|---|---|
| `apps/web/app/invite/[code]/page.tsx` | Before looking up `invites` table, check if `code` matches a `servers.vanity_url`. If so, redirect to that server's join flow. |
| `apps/web/components/modals/server-settings-modal.tsx` | Add "Vanity URL" input in server settings (owner only). Validates format, checks uniqueness via API before saving. Shows preview: `vortexchat.app/invite/your-name`. |
| `apps/web/app/api/servers/[serverId]/route.ts` | PATCH accepts `{ vanity_url }` — requires server owner. Validates format + uniqueness. |

---

## Gap 21: Raid Protection 📋 PLANNED

**Complexity:** M (Medium)
**Stack fit:** Yes — extends existing automod system.

### Context
The automod engine already has `rapid_message` detection. Raid protection adds join-rate monitoring.

### Migration: `00071_raid_protection.sql`

```sql
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS raid_mode BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS raid_mode_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raid_auto_threshold INTEGER NOT NULL DEFAULT 10,  -- joins per minute
  ADD COLUMN IF NOT EXISTS raid_auto_action TEXT NOT NULL DEFAULT 'lockdown'
    CHECK (raid_auto_action IN ('lockdown', 'verify', 'alert'));
```

### Files to Create

| File | Purpose |
|---|---|
| `apps/web/lib/raid-detection.ts` | `checkJoinRate(serverId)` — counts joins in last 60 seconds from `server_members`. If above threshold, triggers auto-action: sets `raid_mode = true`, pauses invites, posts alert to first text channel. |

### Files to Modify

| File | Change |
|---|---|
| `apps/web/app/api/servers/[serverId]/members/route.ts` | After member join, call `checkJoinRate(serverId)`. If raid mode is active, reject new joins with "Server is in lockdown" message. |
| `apps/web/components/modals/server-settings-modal.tsx` | Add "Raid Protection" toggle in moderation settings: enable auto-detect, set threshold, set action (lockdown/verify/alert). Manual "Enable/Disable Raid Mode" toggle. |
| `apps/web/components/admin/admin-activity-timeline.tsx` | Show raid mode activation/deactivation in activity timeline |

---

## Gap 22: Verification Levels 📋 PLANNED

**Complexity:** S (Small)
**Stack fit:** Yes — server-level setting + join-gate check.

### Migration: `00072_verification_levels.sql`

```sql
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS verification_level INTEGER NOT NULL DEFAULT 0;
  -- 0 = none, 1 = email verified, 2 = account age > 5 min, 3 = member > 10 min, 4 = phone verified
```

### Files to Modify

| File | Change |
|---|---|
| `apps/web/app/api/servers/[serverId]/members/route.ts` | On join, check `servers.verification_level` against the joining user's `email_confirmed_at`, `created_at`, and membership duration. Block join if level not met, return descriptive error. |
| `apps/web/components/modals/server-settings-modal.tsx` | Add "Verification Level" dropdown in moderation settings (None / Low / Medium / High / Highest) with descriptions matching Discord's levels. |

### Note
Phone verification (level 4) would require Twilio integration — mark as out-of-scope initially. Levels 0-3 use data already available in Supabase Auth.

---

## Gap 23: High Contrast Mode 📋 PLANNED

**Complexity:** S (Small)
**Stack fit:** Yes — CSS variable theme preset (same system as existing 5 themes).

### Files to Modify

| File | Change |
|---|---|
| `apps/web/lib/stores/appearance-store.ts` | Add `highContrast: boolean` to store state (default `false`). When enabled, override CSS variables with WCAG AAA contrast values (minimum 7:1 ratio for text). |
| `apps/web/components/settings/appearance-settings-page.tsx` | Add "High Contrast" toggle in accessibility section (next to existing Saturation toggle). When enabled, applies high-contrast overrides on top of any theme preset. |
| `apps/web/components/layout/app-provider.tsx` | In the CSS variable injection logic, apply high-contrast overrides after theme preset when `highContrast` is enabled. |

### High Contrast Overrides
```css
--theme-text-bright: #ffffff;
--theme-text-primary: #f0f0f0;
--theme-text-secondary: #d0d0d0;
--theme-text-muted: #b0b0b0;
--theme-bg-secondary: #1a1a1a;
--theme-bg-tertiary: #2a2a2a;
--theme-accent: #6ea8fe;          /* Brighter blue for visibility */
--theme-danger: #ff6b6b;
--theme-success: #69db7c;
```

---

## Gap 24: Skip Navigation Links 📋 PLANNED

**Complexity:** S (Small)
**Stack fit:** Yes — standard HTML pattern, no deps.

### Files to Modify

| File | Change |
|---|---|
| `apps/web/components/layout/channels-shell.tsx` | Add skip links as first child: `<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to content</a>` and `<a href="#message-input" className="sr-only focus:not-sr-only ...">Skip to message input</a>`. Styled to appear as floating pill on focus. |
| `apps/web/components/chat/chat-area.tsx` | Add `id="main-content"` to the message scroll container |
| `apps/web/components/chat/message-input.tsx` | Add `id="message-input"` to the textarea |
| `apps/web/components/dm/dm-channel-area.tsx` | Same `id` attributes for DM view consistency |

### Implementation
```tsx
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:rounded-md focus:text-sm focus:font-semibold"
  style={{ background: "var(--theme-accent)", color: "white" }}
>
  Skip to content
</a>
```

---

# Summary — All Gaps

## 🔴 Critical Gaps

| # | Gap | Status | Complexity | New Deps? |
|---|---|---|---|---|
| 1 | Inline audio/video player | ✅ Done | S | No |
| 2 | Screen share system audio | ✅ Done | S | No |
| 3 | Quiet hours | ✅ Done | M | No |
| 4 | Screen reader aria-live | ✅ Done | S | No |
| 5 | Data export | ✅ Done | M | No |
| 6 | Bot API + tokens | 📋 Planned | L | No |

## 🟡 Nice-to-Have Gaps

| # | Gap | Status | Complexity | New Deps? |
|---|---|---|---|---|
| 7 | Thread auto-archive | 📋 Planned | S | No |
| 8 | Outgoing webhooks | 📋 Planned | M | No |
| 9 | Channel archiving | 📋 Planned | S | No |
| 10 | Sticker packs | 📋 Planned | M | No |
| 11 | Message scheduling | 📋 Planned | M | No |
| 12 | Formatting toolbar | 📋 Planned | S | No |
| 13 | Video background blur | 📋 Planned | M | Yes (MediaPipe ~2MB WASM) |
| 14 | Hand raise (general voice) | 📋 Planned | S | No |
| 15 | Saved searches | 📋 Planned | S | No |
| 16 | Mobile push (native app) | 🟢 Deferred | L | Yes (Capacitor) |
| 17 | Zapier/Make connector | 📋 Planned | S | No (depends on #8) |
| 18 | OAuth2 for third-party apps | 📋 Planned | L | No |
| 19 | SSO / SAML | 📋 Planned | M | No (Supabase native) |
| 20 | Vanity invite URLs | 📋 Planned | S | No |
| 21 | Raid protection | 📋 Planned | M | No |
| 22 | Verification levels | 📋 Planned | S | No |
| 23 | High contrast mode | 📋 Planned | S | No |
| 24 | Skip navigation links | 📋 Planned | S | No |

## Recommended Implementation Order (🟡 gaps only)

Priority based on user impact ÷ effort:

1. **Skip navigation links** (#24) — trivial, immediate a11y win
2. **High contrast mode** (#23) — trivial, a11y compliance
3. **Channel archiving** (#9) — simple, frequently requested
4. **Thread auto-archive** (#7) — columns already exist, just a cron job
5. **Formatting toolbar** (#12) — low effort, improves onboarding for non-technical users
6. **Vanity invite URLs** (#20) — simple column + route
7. **Saved searches** (#15) — localStorage only, quick win
8. **Hand raise** (#14) — small signaling addition, good UX in voice
9. **Verification levels** (#22) — simple join-gate check
10. **Outgoing webhooks** (#8) — unlocks Zapier/Make (#17) as a bonus
11. **Message scheduling** (#11) — cron + UI, moderate effort
12. **Raid protection** (#21) — extends existing automod
13. **Sticker packs** (#10) — retention feature, extends emoji system
14. **Video background blur** (#13) — heavy dep, CPU-intensive
15. **SSO / SAML** (#19) — enterprise, Supabase config
16. **OAuth2 for apps** (#18) — large, depends on Bot API (#6)
17. **Mobile native app** (#16) — largest effort, deferred
