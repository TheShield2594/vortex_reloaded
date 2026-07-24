# Full Code Review — Unwired Functionality, Premise Fit, Dead Code

> Reviewed: 2026-07-24
> Scope: full monorepo — apps/web, apps/signal, apps/cron, packages/db, packages/shared, supabase/, scripts/, spikes/, deploy/, CI
> Method: every "no consumer" claim below was verified by repo-wide search (including dynamic imports, barrel files, and app routes); high-impact claims were independently re-verified.

## Executive summary

The codebase is mid-flight through **two large transitions**, and almost every finding traces back to one of them:

1. **Rescope: Discord-style server app → focused DM app.** The live route tree is DM-only (`/api/dm/...`, `/channels/me`), but server/channel/thread concepts survive in the store, types, manifest, notifications, telemetry, and 75+ orphaned Supabase tables.
2. **Stack cutover: Supabase → SQLite/Drizzle + Better Auth (+ LiveKit + ntfy).** App code has fully cut over (`@vortex/db` in ~60 files, zero Supabase queries left), but the **deployment path, CI, README, and deploy docs have not** — the web Dockerfile can't build, no deploy path creates the SQLite schema, and CI still validates the dead Supabase schema.

**Most urgent (broken today):**

| # | Finding | Where |
|---|---------|-------|
| 1 | `gateway:subscribe` has **no channel-membership authorization** — any authenticated user can subscribe to any DM channel's live events (plaintext `message.created` included). Two comments cite a `checkChannelAccess` function that does not exist. | `apps/signal/src/gateway.ts:102-168` |
| 2 | `apps/web/Dockerfile` omits `packages/db`, so the containerized web build cannot resolve `@vortex/db` — the self-host image cannot build. | `apps/web/Dockerfile:12-25` |
| 3 | No deployment path ever creates the SQLite schema — `setup.sh` → `docker compose up` boots against an empty `vortex.db`. Only `packages/db` `db:migrate` (unwired) and the one-time Supabase import apply DDL. | `packages/db/src/migrate.ts`, `deploy/SELF-HOSTING.md:80` |
| 4 | Invite-code validation is broken end-to-end: the register page calls `/api/invites/validate` while logged out, but the proxy 403s all anonymous `/api/*` requests (route missing from `PUBLIC_ROUTES`), so **every invite code shows "Invalid invite code."** | `apps/web/proxy.ts:83-94`, `app/(auth)/register/page.tsx:44` |
| 5 | Step-up auth gate is enforced but the token is never issued (`issueStepUpToken` has zero callers) — **2FA disable and social account linking always fail with 403.** | `apps/web/lib/auth/step-up.ts:47`, `lib/auth/better-auth.ts:355-360` |
| 6 | Presence is split across two systems that fight: gateway presence lives in Redis, but a cron job marks everyone offline in SQLite every ~2 min because nothing writes `last_heartbeat_at` anymore (the HTTP heartbeat route has no caller). DM payloads still serve the DB status. | `app/api/cron/presence-cleanup/route.ts:49-58`, `apps/cron/index.js:80-84`, `app/api/presence/heartbeat/route.ts` |
| 7 | Polls compose but never render: the composer inserts `[POLL]…[/POLL]` blocks, but the renderer (`message-item.tsx`) was deleted in the rescope — polls appear as raw text with no voting. | `hooks/use-poll-creator.ts:5`, `components/chat/message-input.tsx:739` |
| 8 | Vercel cron schedules `/api/cron/scheduled-tasks`, which doesn't exist (404s daily); attachment decay is only scheduled by the self-host cron, so hosted deploys never purge expired attachments. | `apps/web/vercel.json:9` |

---

## Part 1 — Functionality that isn't wired yet

### 1A. Wired UI / gates pointing at missing halves (worst kind — user-visible breakage)

- **HIGH — Step-up auth token never issued.** `better-auth.ts:355-360` blocks `/two-factor/disable` and `/link-social` behind `hasValidStepUpToken()`, but `issueStepUpToken` (`lib/auth/step-up.ts:47`) has zero callers, so the `vtx_step_up` cookie can never exist. The client actively calls both blocked endpoints (`two-factor-section.tsx:102`, `connections-section.tsx:50`) — they always 403.
- **HIGH — Invite validation blocked by the proxy.** `/api/invites/validate` is deliberately auth-free and IP-rate-limited, but it's not in `PUBLIC_ROUTES` (`proxy.ts:83-94`), so the logged-out register page's debounced check always gets 403 → "Invalid invite code" for valid codes.
- **HIGH — Poll renderer missing.** See summary #7. `MAX_POLL_OPTIONS`'s own comment references `message-item.tsx`, which no longer exists.
- **HIGH — Keyboard shortcut system fully unwired but advertised.** `use-keyboard-shortcuts.ts`, `keyboard-shortcuts-modal.tsx`, and `use-push-to-talk.ts` have no importers, yet the live keybinds settings page (`components/settings/keybinds-settings-page.tsx:5-28`) documents Ctrl+K, Ctrl+F, Alt+arrows, Space push-to-talk, deafen/mute, Ctrl+/ — none of which work.
- **HIGH — Profile data can be edited but never viewed.** All five profile display components (`profile-badges.tsx`, `profile-activity.tsx`, `profile-connections.tsx`, `profile-interest-tags.tsx`, `profile-pinned-items.tsx`) have zero importers; the editing UI and API routes are live.
- **HIGH — Olm one-time key top-up never called.** `topUpOneTimeKeys` (`lib/olm-protocol-store.ts:335`) has no callers, so E2EE devices exhaust their claimed one-time keys and never replenish.
- **MEDIUM — Voice settings page describes device pickers that don't exist.** No wired code calls `enumerateDevices`/`setSinkId` (`voice-settings-page.tsx:41-43`).
- **MEDIUM — "Pinned messages" button is a "coming soon" toast** (`dm-channel-area.tsx:1418-1420`); app-store's `showPinnedPanel` has zero consumers.
- **MEDIUM — "Link previews" appearance toggle is a no-op.** `use-apply-appearance.ts:63` sets `data-link-previews`, which nothing reads; the feature it governed was deleted along with the `/api/oembed` consumer.
- **MEDIUM — Badges can never be awarded.** `users/badges` POST/DELETE expect a `CRON_SECRET` service caller that doesn't exist anywhere, and the route isn't in the proxy's `PASSTHROUGH_ROUTES`, so a cookie-less service call would be rejected by CSRF/session checks before reaching the handler (`app/api/users/badges/route.ts:64,126`, `proxy.ts:77-80,167-178`). Net: `profile-badges.tsx` always renders null (and is itself unwired — see above).

### 1B. Signal server: features advertised in code comments that don't function

- **HIGH — Token revocation list has no writer.** `POST /revoke-token` (`apps/signal/src/index.ts:95`) is called by nothing; `isTokenRevoked` (index.ts:398,460) is always false. The documented security property (forced logout / password change invalidating gateway JWTs before expiry) does not exist at runtime.
- **HIGH — Real-time presence is a no-op end to end.** `serverIds` is hardcoded `[]` (`gateway.ts:142,427`) so no socket ever joins a `presence:` room and every presence broadcast loop iterates zero times; `PresenceManager.startCleanup(onStaleUser)` never invokes its callback (`presence.ts:204-245`); client-side `addPresenceListener` (`use-gateway-context.tsx:119`) has zero consumers. Clients send heartbeats into Redis that nothing reads back out.
- **HIGH — Reconnection catch-up delivers into the void.** Server replays events on `gateway:resume` (`gateway.ts:375-389`), but `addReplayListener` (`use-gateway-context.tsx:124`) has zero registered consumers and `onResumeComplete` is never wired — replayed missed messages are received and discarded.
- **MEDIUM — The signal test suite tests code production never loads.** `rooms.parity-check.ts` is CI's only signal test but exercises only `InMemoryRoomManager`; neither `rooms.ts` nor `redis-rooms.ts` is imported by `index.ts` at all (see Part 3).
- **LOW — `gateway:subscribed` and `server-shutdown` are emitted; no client listens** (`gateway.ts:162`, `index.ts:551`).

### 1C. API routes with no caller

- `/api/oembed` — SSRF-hardened link-preview scraper; the `link-embed.tsx` consumer no longer exists. **HIGH** (keep-or-kill decision needed; docs still claim it's wired).
- `/api/reports` — deliberately dormant per issue #16 (POST), but that decision leaves **no way for a user to report abuse** in an encrypted-DM app, and the GET handler isn't covered by that decision. **MEDIUM**
- `/api/friends/suggestions` — no autocomplete UI calls it; add-friend posts a raw username instead. **MEDIUM**
- `/api/presence/heartbeat` — orphaned by the gateway migration; sole writer of the data cron's presence-cleanup depends on (see summary #6). **MEDIUM**
- `/api/internal/command-bar-log` — telemetry for a command bar that no longer exists; requires `serverId`. **MEDIUM**
- `/api/badges` (public catalog), `/api/health/readiness` — no consumers. **LOW**
- `/api/notification-settings` PUT/DELETE — no callers (GET is called but is a documented no-op; see Part 2). **LOW**

### 1D. Deployment / CI wiring gaps

- **HIGH — Web Dockerfile missing `packages/db`** (summary #2).
- **HIGH — No SQLite schema creation on deploy** (summary #3). `docker-compose.yml`, both Dockerfiles, `setup.sh`, and `SELF-HOSTING.md` never run `db:migrate`.
- **HIGH/MEDIUM — Vercel cron mismatch** (summary #8): `scheduled-tasks` doesn't exist; `attachment-decay` is never scheduled on Vercel.
- **MEDIUM — `packages/db` tests and type-check never run in CI** (`ci.yml` covers shared/web/signal only), while a whole CI job still validates the dead Supabase schema.
- **MEDIUM — Undocumented required env vars.** `SIGNAL_SERVER_URL`, `SIGNAL_REVOKE_SECRET`, `NEXT_PUBLIC_SIGNAL_URL`, `STEP_UP_SECRET_PREV` are absent from `.env.local.example`; `gateway-publish.ts:34` silently skips realtime fan-out when `SIGNAL_REVOKE_SECRET` is unset — a deploy following the example file gets silently degraded realtime.
- **MEDIUM — Offline outbox: two implementations, zero listeners.** `stores/message-outbox.ts` and `lib/chat-outbox.ts` are both unimported; `vortex:flush-outbox` is dispatched (`use-gateway.ts:161`) but nothing listens; the send path just restores the draft on failure. Both have test suites testing dead code. Offline/outbox is a README-level feature claim.
- **MEDIUM — Connection banner unwired.** `connection-banner.tsx` + `use-connection-status.ts` are never rendered — no connectivity feedback despite the PWA premise.

---

## Part 2 — Wired, but needs work to fit the premise

### 2A. Stack-cutover debt (Supabase → SQLite/Better Auth)

- **HIGH — README describes the retired architecture.** Supabase + Supabase Auth + "P2P WebRTC full-mesh over Socket.IO signaling" + Vercel/Railway; reality is SQLite/Drizzle + Better Auth + **LiveKit SFU** (signal server only relays ring events — `gateway.ts:250-288`) + docker-compose self-host. README:150 references a `hooks/webrtc/` directory that doesn't exist. `deploy/README.md` has the same problem and contradicts `deploy/SELF-HOSTING.md` (`npx supabase db push`, `SUPABASE_JWT_SECRET`, deleted `lib/auth/supabase-jwt.ts`).
- **HIGH — All ~100 tables in `supabase/migrations/` are orphaned.** Zero app code queries Supabase. ~75 are Discord-era tables (servers, roles, channels, threads, webhooks, giveaways, automod, events, the entire apps platform, `ai_provider_configs`, `ai_personas`, voice-intelligence tables) that were deliberately dropped and never ported; the rest were ported into the Drizzle schema. The `supabase/` tree (plus `supabase/config.toml`) is a cutover artifact to archive or delete once data migration is final.
- **MEDIUM — CI still enforces the dead schema and exports Supabase env vars.** `migration-smoke` validates RLS on `servers`/`channels`/`messages`; `ci.yml:88-143` sets `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_JWT_SECRET` and cites the deleted `lib/auth/supabase-jwt.ts`. No smoke test exists for the live Drizzle migrations.
- **MEDIUM — `types/database.ts` (3,561 lines) types the entire old Supabase/Discord schema** for ~10 actually-imported aliases. Legacy `RoleRow` is consumed by exactly one file (the itself-unwired `user-profile-popover.tsx`).
- **MEDIUM — e2e suite targets the deleted architecture.** `e2e/server-chat.spec.ts` navigates `/servers` (no such route); `e2e/utils.ts:6-9` gates on Supabase env vars nothing sets, so the authed tests skip forever; `playwright.config.ts` still says `supabase start`. `load-test.yml:70` POSTs `/api/auth/login`, which Better Auth doesn't expose (it's `/api/auth/sign-in/email`) — the load test measures 404s.
- **LOW — Build-config leftovers:** `next.config.js` `@supabase` splitChunks group and `*.supabase.co/.in` image hosts; `optimized-avatar-image.tsx:33` branches on `src.includes("supabase")`; `@supabase/supabase-js` declared-but-unused in `packages/shared/package.json:18`; stale `bundle-analysis-report.md`.
- **LOW — Signal container carries vestigial SQLite plumbing.** Dockerfile installs python3/make/g++ "for better-sqlite3" and compose mounts `./data` + sets `DATABASE_URL` for signal, but signal has no DB dependency and reads neither. The compose header's "both processes read/write the same file" claim is false.
- **LOW — `apps/signal/fly.toml` cannot build** (points at nonexistent `../../Dockerfile.signal`); railway.toml/docker-compose are the real paths.

### 2B. Rescope debt (Discord clone → focused DM app)

- **HIGH — Mention autocomplete is permanently empty.** The full pipeline mounts, but the only call site passes `EMPTY_MEMBERS` (`message-input.tsx:131-132`) and no roles/personas — `@` suggestions can never appear. In a DM/group app it should suggest conversation participants; the role-color and AI-persona branches (`mention-suggestions.tsx:72-130`, `RoleForMention`/`PersonaForMention` in app-store) are Discord/AI-bot leftovers.
- **HIGH — PWA manifest advertises deleted features.** Shortcut "Discover Servers" → `/discover` (404); "New DM" → `/channels/me?new=1`, a param nothing reads (`manifest.json:113,127-143`).
- **MEDIUM — Notifications still carry `server_id`.** `app/api/notifications/route.ts:16` serves it; the notifications page builds `/channels/${server_id}/${channel_id}` URLs (`page.tsx:113-114,198`) that can only 404 — its own comment admits the branch is structurally dead.
- **MEDIUM — Notification override chain is a three-layer no-op.** `/api/notification-settings` is a documented "truthful no-op" still fetched on every app load (`app-store.ts:174`, `app-provider.tsx:52`) into `notificationModes` that zero components read; `resolveNotification`'s server>channel>thread hierarchy always runs with nulls and a hardcoded `[]` (`lib/push.ts:269`). Consequence for the premise: **no way to mute a DM conversation.**
- **MEDIUM — Typing indicators always display "Unknown".** Server hardcodes `displayName = "Unknown"` (`gateway.ts:209`); the client renders it (`dm-channel-area.tsx:2095`); `use-gateway-typing.ts:27` takes `_currentDisplayName` unused.
- **MEDIUM — Group-call ring protocol has no per-callee semantics.** Any single member's decline clears the caller's ringing state even if others may accept; non-accepting members' incoming-call toasts persist indefinitely (`dm-call.tsx:160-170`, `gateway.ts:277`).
- **MEDIUM — `voice-audio-store` still models per-server EQ overrides** no caller can set (`serverOverridesByUser`, `setServerOverride`, `participantMixByServer` — all serverId params passed `undefined`).
- **MEDIUM — Gateway init/subscribe race.** `gateway:init` unconditionally overwrites `socketStates` with an empty `subscribedChannels` set; if the concurrent `gateway:subscribe` validation wins the race, typing/call-signal are silently rejected afterward (`gateway.ts:430-435` vs `use-gateway.ts:140-146`).
- **MEDIUM — Rate-limiting asymmetry on DM mutations.** Message create is limited (15/10s) but edit/delete, reactions add/remove, profile PATCH, and presence POST are not; reaction spam fans out over the gateway unthrottled.
- **MEDIUM — Sentry tunnel drops the auth surface.** `/api/sentry-tunnel` is in neither `PASSTHROUGH_ROUTES` nor `PUBLIC_ROUTES`, so errors from `/login`, `/register`, `/verify-email` are 403'd; the 1 MB body cap will also 413 session-replay envelopes.
- **MEDIUM — PWA share_target half-finished.** `/api/share` redirects to `/channels/me?share_text=...`, params nothing reads; file shares are dropped at a TODO (`route.ts:56-58`) — OS-shared content silently vanishes.
- **LOW — Proxy matcher doesn't exempt `/sw.js`, `.wasm`, `.wav`, theme `.css`** from the session gate — after logout the SW update check gets a login redirect, stalling updates (`proxy.ts:272-276`).
- **LOW — Residual server/channel plumbing:** `navigation.ts` reserved prefixes `/channels/discover|servers` and a `/channels/:serverId/:channelId` branch; `gateway-publish.ts:23` `serverId` field no caller sets; `use-emoji-autocomplete.ts` `serverEmojis` always `[]`; stale server-flavored docstrings in `logger.ts` and `api-helpers.ts`; stale docs (`mvp-core-features.md` describes server emoji management; `CONTRIBUTING.md:142-145` tells contributors to import a `PERMISSIONS` export that no longer exists — repeated in several `.claude/commands/*` briefs).
- **LOW — Shared event-bus header still says "Phase 1: Interface + Supabase adapter (current)"** — no such adapter exists; optional `acknowledge()` was never implemented (`packages/shared/src/event-bus.ts:8-10,111`).

### 2C. Security-relevant (fix regardless of premise)

- **HIGH — Missing gateway subscribe authorization** (summary #1). Also makes `revokeChannelAccess` cosmetic: a removed member can just re-subscribe.
- **HIGH — Presence-cleanup actively corrupts user status** (summary #6) — active users get flipped offline in data still served to clients.

---

## Part 3 — Dead code

### 3A. Whole files with zero importers (verified repo-wide)

| File | Notes | Sev |
|---|---|---|
| `apps/signal/src/rooms.ts` (145 ln) + `redis-rooms.ts` (211 ln) | Abandoned P2P mesh room layer; only the CI parity check touches the in-memory half; `RedisRoomManager` imported by nothing; no `join-room`/`offer`/`answer`/`ice-candidate` handler exists server- or client-side | HIGH |
| `stores/message-outbox.ts` + `lib/chat-outbox.ts` | Two parallel offline outboxes, both dead, both with tests | HIGH |
| `components/user-profile-popover.tsx` (263 ln) → `hooks/use-friendship-actions.ts` → `lib/social-actions.ts` → `components/ui/alert-dialog.tsx` | Whole chain transitively dead; friends-sidebar duplicates the API calls inline; `@radix-ui/react-alert-dialog` dep still declared | HIGH |
| `components/modals/profile-settings-modal.tsx` | Duplicates the live `settings/profile-settings-page.tsx` | MED |
| `components/chat/image-lightbox.tsx` → `hooks/use-reduced-motion.ts` | Attachments open via `<a target="_blank">` instead | MED |
| `components/voice/voice-grid-layout.tsx` | dm-channel-area implements its own tile grid inline | MED |
| `lib/voice/stt-provider.ts` (159 ln) + `lib/voice/vortex-recap-events.ts` (189 ln) | Voice-transcription/"Vortex Recap" AI spike; also premise-conflicting | MED |
| `lib/events.ts` (127 ln) | Discord-style scheduled-events recurrence + iCal export; only its test imports it | MED |
| `e2e/server-chat.spec.ts` | Tests deleted `/servers` routes with deleted Supabase auth | MED |
| `components/connection-banner.tsx` → `hooks/use-connection-status.ts` | See 1D | MED |
| `hooks/use-keyboard-shortcuts.ts`, `use-push-to-talk.ts`, `components/modals/keyboard-shortcuts-modal.tsx` | See 1A | MED |
| `lib/api-client.ts`, `lib/reply-navigation.ts`, `lib/a11y/focus-trap.ts`, `types/database-extended.ts` | reply-jump reimplemented inline in dm-channel-area | LOW |
| `hooks/use-swipe.ts`, `use-pull-to-refresh.ts`, `use-file-preview.ts`, `use-view-transition.ts`, `use-async-action.ts`, `use-error-handler.ts` | Zero importers each | LOW |
| `components/ui/scroll-area.tsx`, `optimized-avatar-image.tsx`, `loading-button.tsx`, `glass-icon.tsx`, `themed-dialog-content.tsx`, `error-boundary.tsx` | `@radix-ui/react-scroll-area` dep still declared | LOW |
| `supabase/config.toml` | Configures a local Supabase stack nothing starts | MED |
| `apps/signal/fly.toml` | References a Dockerfile that doesn't exist | LOW |

Also: `components/chat/custom-emoji-grid.tsx` is imported at `dm-channel-area.tsx:15` but never rendered (import-only dead), and its docstring is a server-emoji leftover.

### 3B. Dead state / unused exports in live files

- **`lib/stores/app-store.ts` — 27 of ~37 fields/actions have zero consumers** (`memberListOpen`, `threadPanelOpen`, `workspaceOpen`, `showSearchModal`, `showKeyboardShortcuts`, `showCreateChannelThread`, `showSummary`, `showPinnedPanel`, `overflowOpen`, `notificationModes`, `messageCache`, `mobilePendingAction`, plus their setters/togglers). Only `currentUser`, `activeChannelId`, unread counts, and `loadNotificationSettings` are live. **HIGH** (misleading surface; many are legacy concepts).
- **Signal:** unused `PresenceManager` methods (`heartbeat`, `getPresence`, `getServerOnlineUsers`, `getMultiplePresence`); dead re-export `RedisEventBus` from `gateway.ts:549`; `rate-limiter.ts` header claims an index.ts coupling that doesn't exist.
- **packages/shared:** unused exports `GATEWAY_PUBLISH_RATE_LIMIT`, `EVENT_STREAM_TTL_SECONDS`, `GATEWAY_PING_TIMEOUT_MS`, `EPHEMERAL_EVENT_TYPES`, `PresenceEntry`, `StreamEvent`, plus attachment-decay/presence internals (`extendExpiry`, `computeCost`, `PRESENCE_HEARTBEAT_INTERVAL_MS`, …). Note: `PRESENCE_CLEANUP_INTERVAL_MS` is imported by `apps/signal/src/presence.ts:20` but shadowed by a local constant **30× larger** — silent drift. `voice.peer_joined/peer_left/state_changed` event types are mesh-era remnants never published or handled.
- **apps/web unused exports** (each verified): `lib/perf.ts` (`perfMarkNavStart`/`perfLogSinceNav`/`perfClearNav`), `lib/notification-manager.ts` (`getActiveChannelId`/`getActiveDmChannelId`/`clearAllNotifications`), `lib/blocking.ts` (`filterMentionsByBlockState`), `lib/dm-encryption.ts` (`exportPrivateKey`/`importPrivateKey`/`nextKeyVersion` — no client-side rotation workflow exists), `lib/storage/local-storage.ts` (`readUploadFile`), `lib/utils/api-helpers.ts` (`notFound`/`dbError`), `lib/utils/storage.ts` (string/JSON pairs), `lib/attachment-security-constants.ts` (`HIGH_RISK_MIME_PREFIXES`), `lib/attachment-validation.ts` (`validateAttachments`/`validateAttachmentContent`), `lib/auth/base64url.ts` (both exports), `lib/auth/step-up.ts` (`clearStepUpToken`/`STEP_UP_WINDOW_SECONDS`), `lib/auth/invites.ts` (`normalizeInviteCode`/`INVITE_VALIDATION_MESSAGES`), `lib/auth/better-auth.ts` (`pruneExpiredLoginAttempts`), `lib/olm-protocol-store.ts` (`signWithOwnAccount` + several internal-only exports), plus assorted constants (`AUDIO_PRESETS`, `EQ_TRACK_PROCESSOR_NAME`, `EMOJI_SHORTCODES`, local-search caps, `PULL_REFRESH_THRESHOLD`).

### 3C. Duplicates where only one copy is live

- Outbox: two dead implementations (3A).
- Friend actions: dead `social-actions.ts`/`use-friendship-actions.ts` vs live inline fetches in `friends-sidebar.tsx:130-191`.
- Voice grid: dead `voice-grid-layout.tsx` vs inline grid in dm-channel-area.
- Reply jump: dead `lib/reply-navigation.ts` vs inline logic in dm-channel-area (~1405).
- Two E2EE stacks both live in the send path: legacy ECDH/AES-GCM conversation keys (`lib/dm-encryption.ts` + `/api/dm/keys/*`) **and** Olm (`lib/olm-protocol.ts` + `/api/dm/olm/*`) both register device keys per channel (`dm-channel-area.tsx:480-649`) — consolidation target, not yet dead.

### 3D. Masking effect

`config/style-guardrails-baseline.json` enumerates many of the dead components (error-boundary, glass-icon, profile-*, image-lightbox, user-profile-popover, connection-banner, themed-dialog-content), keeping them green in the guardrails check while hiding that they're orphaned.

---

## Verified non-findings (checked, intentionally not flagged)

- `@vortex/db` is heavily used (~60 files) — the Drizzle layer is the live data path.
- The Supabase→SQLite migration toolkit (`packages/db/src/migration/`) is deliberately standalone and wired to npm scripts + runbook.
- `deploy/livekit.yaml.example` is live (consumed by `setup.sh`, run by compose); LiveKit is the real call path with P2P only as an unconfigured fallback.
- `packages/shared` event-bus/presence are types/constants only — no duplicate implementations vs apps/signal.
- Spikes (`spikes/`) are intentional exploration; the EQ spike's production port landed at `lib/voice/eq-track-processor.ts`.
- Group trust model (`packages/db/src/schema/trust.ts`) is fully consumed by the membership-log and safety-number routes.
- All registered service-worker message handlers have wired senders.

## Suggested order of attack

1. **Security/correctness now:** gateway subscribe authorization (+ make revoke non-cosmetic); stop presence-cleanup from corrupting status; fix invite validation (add route to `PUBLIC_ROUTES`); issue or remove the step-up gate.
2. **Make self-host actually work:** web Dockerfile + schema migration on boot; drop signal's phantom DB mounts; fix `vercel.json` or drop it.
3. **Decide keep-or-kill per unwired feature** (outbox, shortcuts, profile display, lightbox, oembed/link previews, reports UI, poll renderer, mention sources) — then either wire or delete with its dead API routes.
4. **Burn the Supabase/Discord residue:** archive `supabase/`, retool CI (test `packages/db`, drop migration-smoke + Supabase env), shrink `types/database.ts`, rewrite README/deploy docs, purge server/thread concepts from store/manifest/notifications.
