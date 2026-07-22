# MVP Core Features — Gap Tracker

> Single source of truth for Tier 1 / Tier 2 feature gaps.
> Updated as features are completed during the hardening sprint.

## Emoji System

| Feature | Status | Notes |
|---------|--------|-------|
| Custom emoji upload (PNG/GIF/WEBP, 256 KB) | Done | `POST /api/servers/[serverId]/emojis` — gated by `MANAGE_EMOJIS` permission (bit 20) |
| Emoji autocomplete (`:name:`) | Done | `use-emoji-autocomplete` hook |
| Emoji management page in server settings | Done | `EmojisTab` in server-settings-modal |
| Fix double X close button in server settings (#671) | Done | Removed duplicate custom close button; `DialogContent` already provides one |
| Emoji attribution — uploader name & date | Done | API returns `uploader` join; shown in management UI |
| Audit logging for emoji upload/delete | Done | `audit_logs` entries with `emoji_uploaded` / `emoji_deleted` actions |
| CDN cache-bust on emoji delete | Done | `CDN-Cache-Control: no-store` header on DELETE response |
| Custom emojis in emoji picker (channels) | Done | Server custom emojis shown as "Custom" section at top of emoji picker in `message-input` |
| Custom emojis in emoji picker (DMs) | Done | All server custom emojis fetched via `GET /api/emojis/all` and shown grouped by server in DM picker |

## GIF / Media Picker

| Feature | Status | Notes |
|---------|--------|-------|
| GIF search (Klipy primary, Giphy fallback) | Done | `/api/gif/search` with server-side caching — Klipy is primary provider |
| Trending / featured GIFs section | Done | Shows "Trending" header when browsing without a query |
| Search autocomplete suggestions | Done | `/api/gif/suggestions` — Klipy autocomplete / Giphy related tags |
| Dual-provider support (Klipy + Giphy) | Done | `lib/gif-provider.ts` — Klipy preferred, Giphy as fallback (Tenor removed) |
| Emoji picker in DMs | Done | Full frimousse emoji picker with search, categories, skin tone selector in `dm-channel-area` |
| GIF picker in DMs | Done | Tabbed Emoji/GIF picker with search, trending, autocomplete suggestions in DM composer |
| GIF inline rendering in DMs | Done | Standalone Klipy/Giphy URLs render as inline images in DM messages |
| app-ads.txt for Klipy ads | Done | `public/app-ads.txt` — ad inventory authorization for Klipy monetization |
| Sticker search (Klipy primary, Giphy fallback) | Done | `/api/sticker/search` + `/api/sticker/trending` with server-side caching |
| Sticker picker in channels + DMs | Done | Tabbed Emoji/GIFs/Stickers picker — Discord-style unified picker |
| Separate "memes" picker tab | Gap | Low priority — could add as fourth picker tab |

## Voice / WebRTC

| Feature | Status | Notes |
|---------|--------|-------|
| Voice channels | Done | Socket.IO signal server + WebRTC |
| Compact voice view | Done | Recent addition |

## Real-Time Gateway (#592, #595, #597)

| Feature | Status | Notes |
|---------|--------|-------|
| Unified Socket.IO gateway — single transport for all events | Done | `RedisEventBus` + gateway handlers in signal server; replaces dual Supabase Realtime + Socket.IO connections (#592) |
| Redis Streams event bus (IEventBus impl) | Done | `apps/signal/src/event-bus.ts` — persists events per-channel (capped at 1000, 24h TTL), pub/sub fan-out across replicas (#592) |
| Gateway event types + shared constants | Done | `packages/shared/src/gateway-events.ts` — `GatewayClientEvents`, `GatewayServerEvents`, stream/presence constants (#592) |
| HTTP `/publish-event` endpoint | Done | API routes POST events to signal server for gateway fan-out; protected by `SIGNAL_REVOKE_SECRET` (#592) |
| Socket.IO presence manager (Redis-backed) | Done | `apps/signal/src/presence.ts` — offline detection ~10s via Socket.IO `pingTimeout` (was ~90s); per-server online user sets (#595) |
| Socket.IO typing indicators | Done | `gateway:typing` event; server-side auto-stop (5s); rate limited 30/min (#595) |
| Gateway presence hook (`useGatewayPresence`) | Done | `apps/web/hooks/use-gateway-presence.ts` — replaces HTTP heartbeat polling; multi-tab via BroadcastChannel (#595) |
| Gateway typing hook (`useGatewayTyping`) | Done | `apps/web/hooks/use-gateway-typing.ts` — drop-in for `useTyping`; routes through Socket.IO (#595) |
| Reconnection catch-up (Redis Streams replay) | Done | `gateway:resume` event; client sends `lastEventId` per channel; server replays from Redis Streams (up to 500 events); `gateway:resume-complete` signals success or gap-too-large (#597) |
| Gateway messages hook (`useGatewayMessages`) | Done | `apps/web/hooks/use-gateway-messages.ts` — drop-in for `useRealtimeMessages`; handles replay on reconnect (#597) |
| Client gateway context + provider | Done | `GatewayProvider` in `app-provider.tsx`; single Socket.IO connection shared via React context; auto-reconnect with exponential backoff (#592) |
| Message gap indicator after reconnection (#611) | Done | `chat-area.tsx` detects when refetch doesn't overlap with local messages; shows "You may have missed messages" banner; dismiss button; no false alerts for quick reconnections |
| Migrate components from Supabase Realtime to gateway (#696) | Done | Swapped `useRealtimeMessages` → `useGatewayMessages`, `useTyping` → `useGatewayTyping`, `usePresenceSync` → `useGatewayPresence` in all active components; added `publishGatewayEvent` utility + wired into message/reaction API routes |

## Moderation

| Feature | Status | Notes |
|---------|--------|-------|
| Audit log viewer | Done | `/moderation/timeline` |
| Role management | Done | CRUD with permission bitmasks |
| Content screening | Done | Accept/reject queue |

## PWA / Mobile

| Feature | Status | Notes |
|---------|--------|-------|
| Installable manifest + service worker | Done | `manifest.json`, `sw.js` with multi-strategy caching |
| Push notifications (Web Push VAPID) | Done | All users, 4-level settings hierarchy |
| Push permission soft-ask | Done | 60s delay, contextual prompt |
| Offline banner + connection state machine | Done | `use-connection-status` FSM, color-coded banner |
| Message outbox (offline queue) | Done | localStorage-persisted, flushes on reconnect |
| Mobile bottom tab bar (no drawer) | Done | 4-tab pill nav, drawer removed; server sidebar desktop-only |
| Servers page segmented control | Done | My Servers / Discover tabs, inline search, recent servers row |
| Mobile back-button handling | Done | Two-entry history stack prevents PWA exit |
| Branded splash + skeleton screens | Done | Shimmer animation, respects reduced-motion |
| SW update detection + toast | Done | Hourly polling, "New version available" toast |
| iOS splash screens | Done | 8 device sizes, SVG |
| App badge for unread mentions | Done | `use-tab-unread-title` → SW `setAppBadge()` |
| Web Share API | Done | `navigator.share()` in message context menu |
| `inputmode` on all inputs | Done | `search`, `email`, `numeric` where appropriate |
| `viewport-fit=cover` + `interactive-widget` | Done | Safe-area insets + keyboard resize |
| `format-detection: telephone=no` | Done | Prevents iOS auto-linking phone numbers |

## Onboarding / First-Time Experience

| Feature | Status | Notes |
|---------|--------|-------|
| Welcome screen (post-signup) | Done | `OnboardingFlow` component, shown when no servers + `onboarding_completed_at` is null |
| Two CTAs: Create server / Browse servers | Done | Links to template-powered creation or `/channels/discover` |
| Server template selector in onboarding | Done | Gaming, Study, Startup, Creator templates surfaced prominently |
| Server name + icon upload during onboarding | Done | Reuses existing icon upload to `server-icons` bucket |
| Auto-join server after creation | Done | Owner auto-joins via existing DB trigger |
| System bot welcome message in #general | Done | `POST /api/onboarding/welcome-message` — AutoMod posts in first text channel |
| Invite link surfaced post-creation | Done | Invite step shows full URL with copy button |
| `onboarding_completed_at` flag persisted | Done | `users.onboarding_completed_at` column (migration 00063) |
| DM empty state "Find People" CTA | Done | `dm-list.tsx` — buttons for "Find People" + "New Message" |
| Server sidebar empty state hint | Done | "No servers yet" label + pulsing "Create" button |
| Skip onboarding option | Done | "Skip for now" link on welcome screen |

## Auth / Security

| Feature | Status | Notes |
|---------|--------|-------|
| Email verification enforcement | Done | `proxy.ts` blocks unverified users → `/verify-email`; login API returns `emailUnverified`; resend button on verify page |
| Terms of Service page | Done | `/terms` — server component, public route, linked from register page |
| Privacy Policy page | Done | `/privacy` — server component, public route, linked from register page |
| Web app health endpoint | Done | `GET /api/health` — checks Supabase connectivity, returns latency; 503 when degraded |
| Markdown XSS sanitization | Done | `rehype-sanitize` with allowlist schema; only vortex-* elements + Twemoji imgs pass through |
| CSRF protection | Done | Origin/Referer validation in `proxy.ts` for all mutation requests to `/api/*`; passthrough routes use bearer tokens |
| Request body size limits | Done | `proxy.ts` rejects oversized payloads: 1 MB for JSON routes, 10 MB for upload routes; returns 413 |
| Input validation hardening | Done | Search query capped at 500 chars; command args at 4000; login email/password format + length checks; passkey registration field type + length validation |
| Signal server auth cache hardening | Done | Cache TTL reduced 30s→10s, fallback 120s→15s with forced disconnect; Redis-backed token revocation list; `/revoke-token` endpoint for immediate session invalidation (#540) |
| Signal server per-event auth validation | Done | `/force-disconnect` endpoint + Redis pub/sub for real-time eviction on kick/ban; 60-second periodic membership re-validation sweep for active voice peers (#542) |
| GDPR data export | Done | `GET /api/users/export` — JSON download of profile, messages, DMs, friends, servers, reactions; button in Security settings |
| Verify all migrations in Supabase | Done | Migration 00070: fixed `search_path` on 5 SECURITY DEFINER functions (00053, 00054, 00065, 00058); fixed NULL-in-IN-list on `user_activity_log.ref_type`; added compat shim for deprecated `auth.users.is_super_admin` in system bot (00015) |
| CSP nonce-based script policy | Done | Removed `unsafe-eval` and `unsafe-inline` from `script-src`; per-request nonce generated in `proxy.ts` with `strict-dynamic`; nonce propagated to layout via `x-nonce` header |
| CSP img-src/connect-src tightened (#544) | Done | Replaced `https:` / `wss:` wildcards with specific domain allowlists (Supabase, Klipy, Giphy, LiveKit, Sentry); domains derived from env vars |
| Username enumeration via friend request (#543) | Done | Normalized POST `/api/friends` responses — always returns generic "Friend request sent (if user exists)" regardless of username validity |
| Supabase `getUser()` error check in middleware (#550) | Done | `middleware.ts` now checks `error` from `getUser()` and returns `user: null` on failure instead of proceeding with undefined user |
| TURN credentials moved server-side (#538) | Done | Replaced `NEXT_PUBLIC_TURN_*` env vars with server-side `TURN_URL`/`TURN_SECRET`; new `GET /api/turn-credentials` generates ephemeral HMAC-based credentials (TURN REST API); clients fetch via `fetchIceServers()` helper |
| Step-up secret isolation (#541) | Done | Removed `STEP_UP_SECRET` fallback to `NEXTAUTH_SECRET`; production requires dedicated `STEP_UP_SECRET` env var |
| Webhook HMAC request signing (#547, #717) | Done | `POST /api/webhooks/[token]` **requires** `X-Webhook-Signature` header (HMAC-SHA256 with token as key); rejects unsigned requests with 401; timing-safe comparison |
| Rate limits on role assignment/removal (#551) | Done | `POST/DELETE /api/servers/[serverId]/members/[userId]/roles` — 10 actions per 5 min per moderator via `rateLimiter` |
| Timing-safe cron/webhook token comparison (#555) | Done | All 6 cron endpoints use `verifyBearerToken()` with `crypto.timingSafeEqual` instead of `===` |
| Gateway/signal server fail-closed auth (#687) | Done | `checkChannelAccess` (gateway.ts) and `checkChannelMembership` (index.ts) now return `false` on DB errors instead of `true` |
| Rate limiter fail-closed on webhook/oembed (#688) | Done | Webhook IP + token limiters and oembed limiter use `failClosed: true`; returns 429 when the limiter denies, including fail-closed backend-unavailable cases |
| Sanitize DB error messages in API responses (#689) | Done | Channel PATCH, voice-token GET, and role DELETE no longer expose raw `error.message`; generic messages with server-side logging |
| Top-level try/catch on channel PATCH, server DELETE, message PATCH (#690) | Done | All three handlers now wrapped in try/catch returning `{ error: "Internal server error" }` with 500 status |
| Ban route role hierarchy check (#691) | Done | `POST /api/servers/[serverId]/bans` now compares requester vs target max role position before allowing ban (mirrors kick handler) |
| Vulnerable dependency remediation (#692) | Done | `npm audit fix` + `serialize-javascript` override (>=7.0.5) resolves all 8 high/moderate CVEs including socket.io-parser DoS |

## Media Playback

| Feature | Status | Notes |
|---------|--------|-------|
| Inline audio player | Done | `<audio controls>` in `AttachmentDisplay` for `audio/*` MIME types |
| Inline video player | Done | `<video controls>` in `AttachmentDisplay` for `video/*` MIME types |
| Screen share system audio | Done | `getDisplayMedia({ audio: true })` in `use-voice.ts`; audio track forwarded to peers |

## Media Processing Pipeline (#598)

| Feature | Status | Notes |
|---------|--------|-------|
| Image variant DB schema | Done | Migration 00089 — `blur_hash TEXT`, `variants JSONB`, `processing_state` enum on attachments |
| Image processing library (Sharp) | Done | `lib/image-processing.ts` — generates blur placeholder (16px WEBP), thumbnail (200px), standard (1200px) variants |
| Async processing on message create | Done | `POST /api/messages` — fire-and-forget `processAttachmentImage()` for image attachments |
| Variant download support | Done | `GET /api/attachments/[id]/download?variant=thumbnail\|standard` — serves optimized variant with signed URL; falls back to original |
| Blur placeholder in chat UI | Done | `AttachmentDisplay` shows tiny WEBP blur while full image loads; hidden on load via `onLoad` handler |
| Optimized image serving (standard variant) | Done | Chat images load standard variant (1200px WEBP) instead of full-res original; lightbox still serves original |
| CLS prevention via aspect ratio | Done | `aspectRatio` CSS property set from image dimensions to prevent layout shift |

## Notifications

| Feature | Status | Notes |
|---------|--------|-------|
| Quiet hours (notification schedule) | Done | Migration 00064; `quiet_hours_enabled/start/end/timezone` columns; `isInQuietHours()` utility; push suppressed in `sendPushToUser()`; UI in Notifications settings |
| iOS PWA: force renotify:true (#599) | Done | `sw.js` — iOS reports backgrounded tabs as focused; UA detection forces `renotify:true` + `silent:false` on iOS |
| iOS PWA: unique notification tags (#600) | Done | `sw.js` — append timestamp to notification tag on iOS to prevent silent replacement; desktop keeps channel-based grouping |
| iOS PWA: omit action buttons (#601) | Done | `sw.js` — iOS Safari ignores notification actions; conditionally omit on iOS to save payload bytes |
| Push notification server/channel context (#602) | Done | `lib/push.ts` — server channel titles now show "ServerName — #channel"; DMs unchanged; threads show "> ThreadTitle" |
| Quiet hours timezone auto-detect (#603) | Done | `notifications-settings-page.tsx` — first-time activation uses `Intl.DateTimeFormat().resolvedOptions().timeZone`; DB default remains UTC for server-side safety |
| Typing indicator timeout 5s (#604) | Done | `use-typing.ts` — `TYPING_TIMEOUT_MS` increased from 3s to 5s; display timeout is 5.5s (includes 500ms network buffer) |
| Push notification sender avatar (#606) | Done | `lib/push.ts` — notification icon uses sender's `avatar_url`; system notifications (pins, invites) fall back to app icon |
| Suppress @everyone / @role mention toggles (#607) | Done | `suppress_everyone` + `suppress_role_mentions` columns on `user_notification_preferences`; checked in `sendPushToChannel()`; UI toggles in Notification settings |
| Test notification button (#609) | Done | `POST /api/notifications/test` — sends real push bypassing quiet hours; rate limited 1/30s; validates subscription exists; button in Notification settings |
| Notification volume slider (#612) | Done | `notification_volume` REAL column (migration 00093); slider in Notification settings (0–100%); `getNotificationVolume()` utility; persisted per-user; 0% = silent but visible |
| Distinct notification sounds (#615) | Done | `NotificationSoundType` enum (`message` \| `dm` \| `mention`); per-type audio files + Web Audio API fallback tones; DM notifications use warm arpeggio; mentions use attention double-tap |
| Fix notification preferences save 500 (#672) | Done | Added `notification_volume` to database types; added `push_notifications`, `show_message_preview`, `show_unread_badge` columns (migration 00096) + route handler BOOL_KEYS |

## Direct Messages

| Feature | Status | Notes |
|---------|--------|-------|
| Reactions in DMs | Done | `dm_reactions` table (migration 00082); `POST/DELETE /api/dm/channels/[channelId]/messages/[messageId]/reactions`; full emoji picker + quick reactions in `dm-channel-area`; realtime sync via Supabase; RLS fix via `is_dm_message_participant` SECURITY DEFINER (migration 00091, #591) |
| Date separators in DMs | Done | Day-boundary dividers ("Today", "Yesterday", "March 28, 2026") between messages in `dm-channel-area`; timestamps shown on non-grouped messages |
| Date separators in channels | Done | Day-boundary dividers ("Today", "Yesterday", "March 28, 2026") in `chat-area` and `thread-panel`; messages do not group across day boundaries |

## Threads

| Feature | Status | Notes |
|---------|--------|-------|
| Thread auto-archive (Discord-style) | Done | Migration 00065; `auto_archive_inactive_threads()` RPC; Vercel cron every 5 min; configurable durations: 1h, 24h, 3d, 1w; auto-unarchive on message send; duration selector in create modal + thread panel |

## Accessibility

| Feature | Status | Notes |
|---------|--------|-------|
| Screen reader live announcements for new messages | Done | `aria-live="polite"` region announces all incoming messages with author + preview; `role="log"` with `aria-relevant="additions"` on message container |
| Auto-detect `prefers-contrast: more` (#579) | Done | CSS `@media (prefers-contrast: more)` in `globals.css` + JS `matchMedia` detection in `use-apply-appearance.ts`; manual toggle overrides system preference |
| Color contrast WCAG AA compliance (#712) | Done | Bumped `--theme-text-muted` to `#a2aed0` and `--theme-text-faint` to `#a0abcb` in `globals.css`; all text tokens now meet 4.5:1 ratio against primary/secondary backgrounds |
| Missing landmarks, headings, and ARIA roles (#713) | Done | Auth layout `<div>` → `<main>`; channel name `<span>` → `<h1>`; DM message list `aria-live="polite"` + `role="log"`; plus menu `role="menu"` / `role="menuitem"`; day separator `role="separator"` + `aria-label`; progress bar `role="progressbar"` with `aria-value*`; password toggle `tabIndex={0}` |
| Message action buttons keyboard accessible (#714) | Done | Message container gets `tabIndex={0}` + `role="article"` + `aria-label`; existing `onFocus`/`onBlur` handlers now trigger action bar visibility for keyboard users; `focus-visible` ring styling |
| Form inputs missing accessible labels (#711) | Done | Registration form: added `htmlFor`/`id` to all 5 fields; chat textarea: `aria-label`; poll creator: `aria-label` on question + options; DM edit input: `aria-label` |

## App Store / Bot Apps

| Feature | Status | Notes |
|---------|--------|-------|
| App catalog with marketplace discovery | Done | `app_catalog`, `app_catalog_public` view, `/api/apps/discover` |
| Per-server app install/uninstall | Done | `server_app_installs`, permission-gated install/uninstall |
| Slash command registration + autocomplete | Done | `app_commands` table, `use-slash-command-autocomplete` hook, dropdown UI |
| Slash command execution with rate limiting | Done | `AppInteractionRuntime`, `/api/servers/[serverId]/apps/commands/execute` |
| Welcome Bot — channel assignment, custom message, rules | Done | `welcome_app_configs` table, `/api/servers/[serverId]/apps/welcome`, auto-posts on member join |
| Welcome Bot — DM on join option | Done | `dm_on_join` + `dm_message` fields in config |
| Welcome Bot — embed color + preview | Done | Color picker, live preview in settings |
| Giveaway Bot — channel assignment | Done | `giveaway_app_configs` table, `/api/servers/[serverId]/apps/giveaway` |
| Giveaway Bot — create timed giveaways | Done | Prize, description, duration, winner count; announcement posted by system bot |
| Giveaway Bot — enter/leave giveaways | Done | `/api/servers/[serverId]/apps/giveaway/[giveawayId]` with `enter`/`leave` actions |
| Giveaway Bot — draw winners + announce | Done | Random selection, winner announcement in channel |
| Giveaway Bot — end early, cancel, reroll | Done | Admin actions with confirmation dialogs |
| App config panels in server settings | Done | Inline config UI for all 5 apps in Apps tab |
| Discover page app install | Done | "Add to Server" picker on `/channels/discover` Apps tab |
| Permission-based app management | Done | `MANAGE_WEBHOOKS` / `USE_APPLICATION_COMMANDS` holders can install/uninstall (not just owners) |
| Channel list API endpoint | Done | `GET /api/servers/[serverId]/channels` |
| Standup Assistant — channel, schedule, questions | Done | `standup_app_configs` table, configurable questions (1-10), active days, reminder time/timezone |
| Standup Assistant — submit & view standups | Done | `standup_entries` table, daily per-user submission, team view in config panel |
| Standup Assistant — slash commands | Done | `/standup`, `/standupconfig`, `/standupview`, `/standupremind` |
| Incident Bot — channel, severity levels | Done | `incident_app_configs` table, customizable severity labels |
| Incident Bot — create & track incidents | Done | `incidents` table, status flow: investigating → identified → monitoring → resolved |
| Incident Bot — timeline updates | Done | `incident_updates` table, status change + message history |
| Incident Bot — channel announcements | Done | System bot posts on create, update, and resolve |
| Incident Bot — slash commands | Done | `/incident`, `/iupdate`, `/iresolve`, `/ilist`, `/itimeline` |
| Reminder Bot — personal reminders (up to 24h) | Done | `reminders` table, `reminder_app_configs`, per-user max limit |
| Reminder Bot — slash commands | Done | `/reminder`, `/reminders`, `/rcancel` |
| Giveaway Bot + Reminder Bot marketplace visibility | Done | Fixed via migration 00071 — upsert ensures `is_published = TRUE` (00066/00068 used `ON CONFLICT DO NOTHING` which silently skipped rows) |
| RSS Feed Bot — channel, add/remove feeds, fetch (#679) | Done | `rss_feed_app_configs` + `rss_feeds` tables, `/api/servers/[serverId]/apps/rss-feed`, auto-title detection, embed messages via system bot |
| RSS Feed Bot — slash commands | Done | `/rssfeed`, `/rsslist`, `/rssremove`, `/rssfetch` |
| Bible Bot — channel, API key, translation, daily verse (#480) | Done | `bible_app_configs` table, `/api/servers/[serverId]/apps/bible`, scripture.api.bible integration, embed color picker |
| Bible Bot — daily verse schedule + manual post | Done | Configurable time/timezone, rotating verse list, manual post button |
| Bible Bot — slash commands | Done | `/verse`, `/dailyverse`, `/bibleconfig` |
| RSS Feed Bot + Bible Bot marketplace visibility | Done | Fixed via migration 00104 — upsert ensures `is_published = TRUE` (00103 used `ON CONFLICT DO NOTHING` which silently skipped rows; same issue as 00071) |
| Premium marketplace card design (#673) | Done | Redesigned app cards with icon, trust badge pill, star rating, hover effects; improved visual hierarchy and spacing |
| Curated discovery sections (#674) | Done | `app_curated_sections` + `app_curated_entries` tables, `/api/apps/curated` endpoint; Featured / Trending / Staff Picks above catalog grid; graceful fallback when empty |
| Trust & permission transparency UX (#675) | Done | `TrustBadgeTooltip` with hover descriptions; `PermissionList` grouped by impact level (low/medium/high/critical); `AlertDialog` pre-install confirmation for elevated scopes; `TRUST_BADGE_INFO` + `APP_PERMISSION_META` in `@vortex/shared` |
| Server Settings Apps premium panel (#676) | Done | Redesigned `AppsTab` with `AppAvatar`, `TrustBadgePill`, relative install dates, skeleton loading, 2-col marketplace grid, hover-to-primary install buttons, dashed empty states |
| Discover Apps visual QA tests (#677) | Done | 41-test vitest suite covering card hierarchy, trust/rating placement, picker z-index/overflow, skeleton/empty-state consistency, permission grouping, confirmation flow, Settings panel layout |

## Vanity Invite URLs

| Feature | Status | Notes |
|---------|--------|-------|
| Vanity URL column on servers table | Done | Migration 00078 — `vanity_url TEXT UNIQUE` with slug format CHECK constraint |
| Vanity URL validation (3-32 chars, lowercase slug) | Done | Regex `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$` enforced at DB + API level |
| Vanity URL setting in server settings | Done | Owner-only UI in Invites tab with live preview and copy button |
| Invite lookup resolves vanity URLs | Done | `GET/POST /api/invites/[code]` checks `invite_code` then `vanity_url` |
| Vanity URL uniqueness check | Done | API checks uniqueness before save; DB UNIQUE constraint as safety net |

## Profile Badges & Achievements

| Feature | Status | Notes |
|---------|--------|-------|
| Badge definitions table (catalog) | Done | Migration 00079 — `badge_definitions` with category, rarity, icon, color |
| User badges table (assignments) | Done | `user_badges` with `UNIQUE(user_id, badge_id)`, awarded_by tracking |
| 10 default badge definitions seeded | Done | early_adopter, bug_hunter, server_owner, moderator, message_veteran, voice_regular, streak_master, event_host, community_star, verified |
| Badge catalog API | Done | `GET /api/badges` — public catalog of all badge definitions |
| User badges API (read/award/revoke) | Done | `GET/POST/DELETE /api/users/badges` — ADMINISTRATOR permission required for award/revoke |
| Profile badges component | Done | `ProfileBadges` with icon rendering, rarity glow, tooltips |
| Badges section in profile panel | Done | Shown between Roles and Connections sections |
| RLS policies for badges | Done | Public read; service_role manages inserts/updates |

## Attachment Retention / Decay

| Feature | Status | Notes |
|---------|--------|-------|
| Size-based expiry calculation (Fluxer-style) | Done | `@vortex/shared` `computeDecay()` — ≤5 MB → 3 years, ≥500 MB → 14 days, log-linear blend |
| Decay columns on attachments + dm_attachments | Done | Migration 00081 — `expires_at`, `last_accessed_at`, `purged_at`, `lifetime_days`, `decay_cost` |
| Backfill existing attachments with expiry | Done | Migration 00081 DO block computes expiry for all pre-existing rows |
| Expiry set on channel attachment upload | Done | `POST /api/messages` — `insertMessageWithAttachments()` calls `computeDecay()` |
| Expiry set on DM attachment upload | Done | `dm-channel-area.tsx` — `computeDecay()` called on DM file upload |
| Access-based renewal on channel download | Done | `GET /api/attachments/[id]/download` — `maybeRenewExpiry()` extends deadline when accessed near expiry |
| Access-based renewal on DM download | Done | `GET /api/dm/attachments/[id]/download` — same renewal logic |
| Purged file access returns 410 Gone | Done | Both download endpoints return 410 for purged attachments |
| Daily cleanup cron job | Done | `GET /api/cron/attachment-decay` — purges expired files from Supabase Storage in batches of 200 |
| Vercel cron schedule | Done | `vercel.json` — runs daily at midnight UTC |

## User Status / Presence (Fluxer-style)

| Feature | Status | Notes |
|---------|--------|-------|
| Server-side heartbeat endpoint | Done | `POST /api/presence/heartbeat` — client pings every 30s; updates `last_heartbeat_at` in users table |
| Stale-presence cron cleanup | Done | `GET /api/cron/presence-cleanup` — marks users with stale heartbeats (>90s) as offline; runs every minute via Vercel Cron |
| DB migration for heartbeat column | Done | Migration 00083 — `last_heartbeat_at TIMESTAMPTZ` + partial index on online/idle/dnd users |
| Multi-tab session coordination | Done | `BroadcastChannel` API syncs status across tabs; closing one tab doesn't mark offline when others remain |
| Status aggregation (multi-session) | Done | `@vortex/shared` `aggregateStatus()` — precedence: online > dnd > idle > offline; invisible overrides all |
| Idle detection (10min, Fluxer-style) | Done | 10-minute timeout with 25%-interval checks; tab visibility triggers instant idle |
| Presence constants in shared package | Done | `@vortex/shared` — heartbeat interval, stale threshold, idle timeout, activity throttle |
| DB-level status change listener | Done | `member-list.tsx` subscribes to `postgres_changes` on users table for immediate cron-triggered offline updates |
| sendBeacon as fast-path fallback | Done | Still used on tab close for immediate offline; heartbeat cron is the safety net |
| Last seen time for offline users (#608) | Done | `last_online_at` column on users; set on offline transition (cron + sendBeacon); relative time ("Active Xm/h/d ago") in member list; invisible→offline doesn't update timestamp |
| Role-grouped member list (#610) | Done | Online members grouped by highest-priority role (Discord-style); sections ordered by role position; role color in headers; no-role users under "Members"; offline section unchanged |

## Hardening — Bug Fixes (2026-04-01)

| Fix | Status | Notes |
|-----|--------|-------|
| Hardcoded `color: "white"` in badges (#578) | Done | Added `--theme-danger-foreground` design token; replaced all `color: "white"` on danger backgrounds with theme-aware token |
| Z-index scale misalignment (#577) | Done | Unified Tailwind config to match CSS variable scale; added `z-tabbar` (50) for mobile nav; replaced all `z-40` with semantic classes |
| Mobile touch targets below WCAG 44px (#573) | Done | Tab bar links → 44px; member list rows → `min-h-[44px]`; category buttons → `min-h-[44px]`; reaction chips → `min-h-[44px]` with padding |
| Audit log fire-and-forget (#554) | Done | `insertAuditLog` helper now logs errors; all direct `.from("audit_logs").insert()` calls updated to check and log errors |
| Server deletion cascade non-atomic (#553) | Done | Created `delete_server_cascade` RPC (migration 00084); single-transaction deletion replaces sequential per-table deletes |
| Webhook messages attributed to owner (#548) | Done | Added `webhook_id` FK column to messages (migration 00085); webhook route uses `SYSTEM_BOT_ID` as author; BOT badge shown in message UI |
| Role assignment + audit log atomic (#582) | Done | `assign_member_role` / `remove_member_role` RPCs (migration 00086); single-transaction role mutation + audit log replaces separate inserts |
| Automod rule reorder error handling (#572) | Done | `movePriority` and `toggleEnabled` now validate `Response.ok` and wrap in try/catch with toast notifications on failure |
| Webhook display metadata separation (#581) | Done | Added `webhook_display_name` / `webhook_avatar_url` columns (migration 00087); webhook route stores clean content; message-item renders identity from metadata |
| ChatArea decomposition — extracted hooks (#585) | Done | Created `useChatHistory` (pagination, backfill) and `useChatRealtime` (message/reaction callbacks) hooks in `components/chat/hooks/` |
| Event bus abstraction interface (#586) | Done | Added `IEventBus` interface with publish/subscribe/replay/acknowledge in `@vortex/shared`; typed event system with `VortexEvent` and `VortexEventType` |
| Signal server graceful shutdown + Redis TTL (#587) | Done | 30s connection-draining shutdown; Redis room key TTL (5min) with periodic refresh; crash recovery via auto-expiry; SIGINT+SIGTERM handling |
| Read position tracking API endpoints (#588) | Done | `POST /api/channels/:channelId/ack` for mark-as-read; `GET /api/users/me/read-states` for bulk hydration of channels, DMs, and threads |
| Mark as Read context menu + keyboard shortcut (#605) | Done | Right-click "Mark as Read" on unread channels in sidebar; `Ctrl/Cmd+Shift+M` marks all channels in current server as read |
| PATCH roles handler try/catch (#567) | Done | Already had top-level try/catch wrapping entire handler body |
| Server-templates POST try/catch + permission check (#568) | Done | Wrapped entire POST handler in try/catch; added membership verification before preview/apply/export modes |
| Voice-channel fetchParticipants double-cast (#569) | Done | Replaced `as unknown as` with local `VoiceStateWithUser` interface; added error handling for Supabase query |
| SearchResult discriminated union (#570) | Done | Split flat `SearchResult` into `MessageSearchResult \| TaskSearchResult \| DocSearchResult` discriminated union |
| Audit log insert failure handling in roles (#571) | Done | PATCH and DELETE role handlers now return 500 if audit log insert fails instead of silently continuing |
| CSS `color-scheme` for native dark mode (#574) | Done | Added `color-scheme: dark` to `:root`; added `color-scheme: light` to clarity preset; sakura-blossom already had it |
| CSS container queries for component responsiveness (#575) | Done | Added `container-type: inline-size` to channel sidebar, member list, message input, thread panel; responsive `@container` rules |
| Named view transitions (#576) | Done | Added `view-transition-name` to server sidebar, channel sidebar, chat area, and chat header surfaces; respects `prefers-reduced-motion` |
| Suspicious login detection enforcement (#545) | Done | `computeLoginRisk` now returns `action` field; score >= 60 requires MFA/email challenge; score >= 80 locks session and requires email verification |
| TypeScript `any` type cleanup (#546) | Done | All 46 files cleaned; remaining `SupabaseClient<any>` consolidated in `lib/supabase/untyped-table.ts` utility (intentional for ungenerated tables); ESLint `@typescript-eslint/no-explicit-any: error` rule added |
| Message send state icons (#616) | Done | Clock (queued), animated spinner (sending), alert triangle (failed) Lucide icons in `message-item.tsx`; text labels preserved for screen reader accessibility |

## Search (#593)

| Feature | Status | Notes |
|---------|--------|-------|
| Postgres tsvector on `direct_messages` table | Done | Migration 00089 — `search_vector` column with GIN index, auto-update trigger, backfill of existing rows |
| Server-side DM search via `/api/search` | Done | `dmChannelId` param; membership check; `textSearch` on `search_vector`; blocked-user filtering |
| Unified SearchModal for channels + DMs | Done | Single `SearchModal` component accepts `serverId` or `dmChannelId`; DM search for non-E2E channels, local search preserved for E2E |
| Rate limit tightened (10/min) | Done | Reduced from 20 to 10 searches/minute per user per issue spec |
| Filter syntax: `from:`, `has:`, `before:`, `after:` | Done | Supported across both server and DM search paths |

## Virtual Scrolling (#594)

| Feature | Status | Notes |
|---------|--------|-------|
| `@tanstack/react-virtual` installed | Done | Dynamic row heights via `measureElement`; overscan=10 |
| `VirtualizedMessageList` component | Done | Generic virtualizer with header/footer slots, bidirectional infinite scroll trigger, dynamic measurement |
| ChatArea integration | Done | Replaced direct DOM rendering with `VirtualizedMessageList`; removed `column-reverse` CSS; `DISPLAY_LIMIT` raised from 150 → 500; header/footer/voice recaps rendered as virtual rows; `useChatScroll` updated for standard scroll direction (#647) |
| Hooks updated (`use-chat-history`, `use-chat-realtime`) | Done | `DISPLAY_LIMIT` raised to 500 in all three locations |

## Redis Application Cache (#596)

| Feature | Status | Notes |
|---------|--------|-------|
| Upstash Redis as L2 cache backend | Done | `server-cache.ts` upgraded — L1 in-memory + L2 Redis; lazy Redis init; graceful fallback if Redis unavailable |
| `CACHE_TTLS` constants exported | Done | Server settings 60s, channel metadata 60s, member permissions 30s, role list 60s, automod rules 60s, user profile 120s, member count 300s |
| Cache invalidation on role mutations | Done | PATCH/DELETE/POST on roles, role reorder — invalidates `roles:`, `perms:`, `member-roles:` prefixes |
| Cache invalidation on automod mutations | Done | POST/PATCH/DELETE on automod rules — invalidates `automod:` prefix |
| Cache invalidation on channel updates | Done | PATCH channel — invalidates `channel:` key + `perms:` prefix |
| Cache invalidation on role assignment/removal | Done | POST/DELETE member roles — invalidates `member-roles:` + `perms:` prefixes |
| `invalidatePrefix` via Redis SCAN | Done | Non-blocking scan+delete for pattern-based invalidation; entries expire via TTL as safety net |
| Permission functions cached | Done | `getMemberPermissions` cached at `perms:{serverId}:{userId}`, `getChannelPermissions` at `chan-perms:{channelId}:{userId}` with 30s TTL (#648) |
| Channel permissions cache invalidation | Done | PUT/DELETE on `/api/channels/[channelId]/permissions` now calls `invalidateChannelPermissions()` (#648) |

## Performance Hardening (P0)

| Feature | Status | Notes |
|---------|--------|-------|
| Fix inline callbacks breaking React.memo | Done | Extracted 8 callbacks from `messages.map()` into `useCallback` hooks; `renderMessage` callback for virtualizer (#646) |
| Enable message list virtualization | Done | `VirtualizedMessageList` activated in ChatArea; removed `column-reverse` layout; `useChatScroll` updated for standard scroll direction (#647) |
| Cache permission checks with 30s TTL | Done | `getMemberPermissions` + `getChannelPermissions` wrapped with `cached()` from `server-cache.ts`; channel permission invalidation added (#648) |
| Replace Redis KEYS scan in presence cleanup | Done | Replaced blocking `redis.keys()` with cursor-based `redis.scan()`; cleanup interval changed from 10s → 5min (#649) |
| Add missing index on `direct_messages.dm_channel_id` | Done | Migration `00095_perf_dm_channel_index.sql` — composite index on `(dm_channel_id, created_at DESC)` (#650) |
| Fix reactions Realtime subscription filter | Done | Added `messagesRef`-based early-return filter in `use-realtime-messages.ts` for INSERT and DELETE events (#651) |
| Batch search permission checks — eliminate N+1 | Done | `getBatchChannelPermissions()` in `permissions.ts`; search route reduced from 350 → 3 DB queries (#653) |
| Optimize event replay from O(N) to O(log N) | Done | Redis XRANGE exclusive start `(entryId` + XREVRANGE lookup in `event-bus.ts` (#654) |
| Redis leader election for periodic membership checks | Done | `SET NX PX` leader lock in signal server; only one replica runs 60s sweep (#655) |
| Client-side offline message queue | Done | `vortex:flush-outbox` dispatched on socket reconnect; sending→pending reset on disconnect (#656) |
| Denormalize server_id to threads table | Done | Migration `00098`; direct `server_id` on threads; simplified RLS — no channel join for membership (#657) |
| Optimize RLS policies with subquery rewrite | Done | Migration `00099`; `channel_permissions` + `messages` policies use `IN (subquery)` pattern (#658) |

## Performance Hardening (P2)

| Feature | Status | Notes |
|---------|--------|-------|
| Reduce Sentry/OpenTelemetry bundle overhead | Done | `disableClientWebpackPlugin` for non-CI builds; tree-shake unused OTEL integrations (#659) |
| Replace raw img with next/image for avatars | Done | `OptimizedAvatarImage` component using next/image; updated message-item, member-list, sortable-channel-item (#660) |
| Add Suspense boundaries for streaming SSR | Done | Channels layout wrapped in Suspense with skeleton fallback for progressive rendering (#661) |
| Client-side typing indicator debounce | Done | 2s suppress window + 3s inactivity auto-stop in `use-gateway.ts`; ~80% fewer typing events (#662) |
| Batch ICE candidates for WebRTC signaling | Done | `ice-candidates-batch` event in signal server; 3-5x fewer signaling messages during call setup (#663) |
| Deduplicate presence broadcasts across servers | Done | Socket-level dedup in `gateway.ts`; each socket receives presence update once regardless of shared servers (#664) |
| Add composite indexes for common query patterns | Done | Migration `00100`; indexes on messages, direct_messages, notifications, threads, audit_logs (#665) |
| Slim down members route response payload | Done | `?fields=full` param; default slim projection omits bio, status_message, banner_color, custom_tag (#666) |
| Cap and stream audit log CSV export; slim events RSVP | Done | CSV export capped at 1000 rows with streaming; events RSVP returns only user_id+status (#667) |
| Offline message history caching in service worker | Done | Network-first API cache with 5min TTL for `/api/messages` and channel message endpoints (#670) |
| Signal server health endpoint hardened (#717) | Done | `/health` returns only `{ status: "ok" }` — removed `rooms.getStats()` that exposed channel IDs and user counts |
| Shared package tests in CI (#716) | Done | Added `npm test --workspace=packages/shared` to CI test job; removed `continue-on-error` from E2E job |
| Signal server Dockerfile multi-stage build (#715) | Done | Replaced manual `COPY packages/shared → node_modules` with proper npm workspace resolution; added `build` script + `tsconfig.build.json` to `@vortex/shared`; multi-stage Docker build |
| DMChannelArea shared utilities (#719) | Done | Extracted `formatDaySeparator`, `extractGifUrl`, `groupReactionsByEmoji` to `lib/utils/message-helpers.ts`; shared `DaySeparator` component used by both `ChatArea` and `DMChannelArea` |
| Tune Socket.IO ping/pong for faster disconnect detection (#669) | Done | `pingInterval` 25s→10s, `pingTimeout` 60s→20s in signal server; disconnect detection reduced from ~85s to ~30s |
| Giveaway relative timestamp handles future dates (#680) | Done | `TimestampDisplay` `:R` format now renders "in X hours/minutes/days" for future timestamps; proper singular/plural |
| LinkEmbed oembed client-side cache (#705) | Done | Module-level `Map<url, OGData>` cache + in-flight dedup in `link-embed.tsx`; eliminates redundant `/api/oembed` fetches when same URL mounts multiple times |
| Replace `select('*')` over-fetching in API routes (#704) | Done | Explicit column projections in `notification-settings`, `dm/route`, `voice/sessions/route`, `channels/[channelId]/route`; layout queries kept as `select('*')` since results are passed as full Row types to downstream components |

---

*Last updated: 2026-04-04 (sprint 4)*
