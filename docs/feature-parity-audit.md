# Feature Parity Audit — VortexChat vs. Discord / Stoat

> Audited: 2026-03-18
> Auditor: Automated codebase analysis
> Scope: Full codebase scan of apps/web, packages/shared, supabase/migrations, apps/signal
> Stoat source: [github.com/stoatchat/for-web](https://github.com/stoatchat/for-web) — open-source Discord alternative (formerly Revolt), Solid.js web client

Legend: **Present** = feature exists in that platform | **—** = absent or negligible

Gap severity:
- 🔴 Critical — users will notice its absence immediately
- 🟡 Nice-to-have — improves polish/retention
- 🟢 Intentional skip — out of scope for VortexChat's vision

---

## 1. Messaging

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Markdown (bold, italic, strikethrough, lists) | ✅ GFM via react-markdown + remark-gfm | ✅ | ✅ | Parity |
| Code blocks + syntax highlighting | ✅ 40+ languages via prism-react-renderer | ✅ | ✅ | Parity |
| Rich-text formatting toolbar (WYSIWYG) | ❌ | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| @user mentions + autocomplete | ✅ `mention-suggestions.tsx` | ✅ | ✅ | Parity |
| @everyone / @here | ✅ MENTION_EVERYONE permission bit | ✅ | ✅ MentionEveryone perm | Parity |
| Pinned messages | ✅ `pinned-messages-panel.tsx` | ✅ | ✅ | Parity |
| Message editing | ✅ | ✅ | ✅ | Parity |
| Message deletion (soft-delete) | ✅ | ✅ | ✅ ManageMessages perm | Parity |
| Typing indicators | ✅ `use-typing.ts` + `typing-indicator.tsx` | ✅ | ✅ | Parity |
| Message scheduling | ❌ | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| Draft persistence | ✅ Debounced auto-save to localStorage | ✅ | ❌ | Parity except Stoat |
| Message forwarding | ❌ | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| Polls | ✅ Poll creator in message input | ✅ | ❌ | Stoat lacks polls |
| Link previews / oEmbed | ✅ `link-embed.tsx` + `/api/oembed` with SSRF protection | ✅ | ✅ SendEmbeds perm | Parity |
| Slash commands | ✅ App commands with autocomplete | ✅ | ❌ | Stoat lacks slash commands |
| Masquerade (post as alt identity) | ❌ | ❌ | ✅ Masquerade perm | 🟢 Stoat-unique feature — skip |

---

## 2. Threads & Replies

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Reply to message (inline quote) | ✅ `reply-preview.tsx` | ✅ | ✅ | Parity |
| Threaded conversations (panel) | ✅ `thread-panel.tsx`, `thread-list.tsx` | ✅ | ❌ | Stoat lacks threads — **VortexChat ahead** |
| Create thread modal | ✅ `create-thread-modal.tsx` | ✅ | ❌ | Stoat lacks threads |
| Thread notification following | ✅ Thread member subscriptions via `/api/threads/[id]/members` | ✅ | ❌ | Stoat lacks threads |
| Thread-only / forum channels | ✅ `forum-channel.tsx` with sort (recent/popular/unanswered) | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Thread permissions (public/private) | ✅ CREATE_PUBLIC_THREADS + CREATE_PRIVATE_THREADS bits | ✅ | ❌ | Stoat lacks threads |
| Thread archival (auto-archive after inactivity) | ✅ Discord-style auto-archive cron + configurable durations (1h/24h/3d/1w) | ✅ | ❌ | Stoat lacks threads |

---

## 3. Reactions & Emoji

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Unicode emoji picker | ✅ frimousse picker with search, categories, skin tones | ✅ | ✅ | Parity |
| Emoji reactions on messages | ✅ `reactions-client.ts`, real-time sync | ✅ | ⚠️ Partial (React perm exists, implementation limited) | **VortexChat ahead** of Stoat |
| Custom server emoji (upload) | ✅ PNG/GIF/WEBP, 256 KB, management page, attribution | ✅ | ✅ | Parity |
| Emoji autocomplete (`:name:`) | ✅ `use-emoji-autocomplete` hook | ✅ | ✅ | Parity |
| GIF picker (Klipy/Giphy) | ✅ Klipy primary, Giphy fallback, trending, search, suggestions | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Animated emoji / stickers | ✅ Klipy sticker API (search + trending), tabbed picker in channels + DMs | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Super reactions / reaction effects | ❌ | ✅ (Nitro) | ❌ | 🟢 Intentional skip — paywall feature |

---

## 4. File & Media

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| File uploads + storage | ✅ Supabase Storage buckets | ✅ | ✅ UploadFiles perm | Parity |
| Image preview + lightbox | ✅ `image-lightbox.tsx` with zoom/pan/gallery nav | ✅ | ✅ | Parity |
| Video embed (YouTube, etc.) | ✅ oEmbed + YouTube embed in Stage channels | ✅ | ✅ SendEmbeds | Parity |
| Inline audio player | ✅ `<audio>` in `message-item.tsx` | ✅ | ✅ | Parity |
| Inline video player | ✅ `<video>` in `message-item.tsx` | ✅ | ✅ | Parity |
| Malware scanning on uploads | ❌ Removed | ❌ | ❌ | N/A |
| Media channel (gallery view) | ✅ `media-channel.tsx` | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Max file size enforcement | ✅ 10 MB upload route limit in proxy.ts | ✅ | ✅ 20 MB default | Parity |

---

## 5. Voice & Video

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Voice channels (always-on) | ✅ WebRTC P2P + LiveKit SFU dual mode | ✅ | ✅ Connect+Speak perms | Parity |
| DM voice calls | ✅ `dm-call.tsx`, `incoming-call-ui.tsx` | ✅ | ✅ | Parity |
| Multi-participant video | ✅ Camera toggle, 720p, adaptive grid | ✅ | ⚠️ Built but not deployed on flagship | **VortexChat ahead** of Stoat |
| Voice activity detection | ✅ hark.js speaking indicators | ✅ | ⚠️ Basic | Parity |
| Noise suppression | ✅ Audio pipeline compressor + noise gate; LiveKit native | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Stage channels (speaker/audience) | ✅ `stage` channel type, request-to-speak | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Voice intelligence (transcripts + summaries) | ✅ STT provider, consent, retention cron | ❌ | ❌ | **Ahead** of both Discord and Stoat |
| Video background blur/virtual BG | ❌ | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| Hand raise (general voice) | ❌ Only stage "request to speak" | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| Voice reconnection | ✅ `voice-reconnection-manager.ts` | ✅ | ⚠️ Basic | Parity |

---

## 6. Screen Share

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Screen sharing (getDisplayMedia) | ✅ Separate screen stream track | ✅ | ⚠️ Built but not deployed on flagship | **VortexChat ahead** of Stoat |
| Spotlight / focus view | ✅ Click to enlarge, compact tile view | ✅ | ⚠️ Basic | Parity |
| Annotation / drawing on screen | ❌ | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| Multi-presenter (concurrent shares) | ❌ One share at a time | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| Audio sharing with screen | ✅ `audio: true` in getDisplayMedia + track forwarding | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Presenter controls (pause, switch window) | ✅ Toggle on/off; auto-stop on track end | ✅ | ⚠️ Basic | Parity |

---

## 7. Search

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Full-text message search | ✅ Postgres `websearch_to_tsquery` | ✅ | ✅ Basic | Parity |
| Filter by user (`from:`) | ✅ | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Filter by date (`before:/after:`) | ✅ | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Filter by content type (`has:`) | ✅ `has:link`, `has:image`, `has:file` | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Cross-channel search | ✅ Server-wide scope | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Saved searches / search history | ❌ | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| DM local search | ✅ `dm-local-search-modal.tsx` | ✅ | ✅ | Parity |
| Quick switcher | ✅ `quickswitcher-modal.tsx` (Ctrl+K) | ✅ | ❌ | **VortexChat ahead** of Stoat |

---

## 8. Notifications

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Web Push (VAPID) | ✅ `push.ts`, service worker | ✅ | ✅ Web push | Parity |
| Push permission soft-ask | ✅ 60s delay, contextual prompt | ❌ | ❌ | **Ahead** of Discord/Stoat |
| Per-channel notification mode | ✅ `notificationModes` with mute per channel | ✅ | ✅ | Parity |
| Notification preferences (mentions, replies, etc.) | ✅ 4-level hierarchy, `notification-preferences` API | ✅ | ⚠️ Basic | **VortexChat ahead** of Stoat |
| DND / status-based suppression | ✅ `dnd` user status | ✅ | ✅ | Parity |
| Notification schedule (quiet hours) | ✅ `quiet-hours.ts` + settings UI | ✅ | ❌ | **VortexChat ahead** of Stoat |
| App badge (unread count) | ✅ `setAppBadge()` via service worker | ✅ | ✅ | Parity |
| Desktop notification sounds | ✅ Sound toggle in settings | ✅ | ✅ | Parity |
| Mobile push (native app) | ❌ PWA push only | ✅ | ❌ PWA only | 🟡 Discord has native app push; PWA push covers most cases |

---

## 9. Bots & Integrations

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Incoming webhooks | ✅ Per-channel webhooks, token-based posting | ✅ | ✅ ManageWebhooks perm | Parity |
| Outgoing webhooks | ❌ | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| Slash commands (app-based) | ✅ App command execution + autocomplete | ✅ | ❌ | **VortexChat ahead** of Stoat |
| App install catalog | ✅ `apps-tab.tsx`, `/api/servers/[id]/apps` | ✅ | ❌ | **VortexChat ahead** of Stoat |
| OAuth app installs | ❌ Internal app model only | ✅ | ❌ | 🟡 Discord has OAuth app marketplace |
| Public bot SDK / API docs | ❌ OpenAPI spec exists but internal only | ✅ | ✅ revolt.js, revolt.py, Rust crate | 🔴 Both Discord and Stoat have public SDKs; VortexChat doesn't |
| Zapier / Make connector | ❌ | ✅ | ❌ | 🟡 Discord has Zapier integration |
| System/AutoMod bot | ✅ Welcome messages, automod actions | ✅ | ❌ | **VortexChat ahead** of Stoat |

---

## 10. Channels & Organization

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Text channels | ✅ | ✅ | ✅ | Parity |
| Voice channels | ✅ | ✅ | ✅ | Parity |
| Category grouping | ✅ `category` channel type, collapsible | ✅ | ✅ | Parity |
| Announcement channels | ✅ `announcement-channel.tsx` — restricted posting | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Forum / Q&A channels | ✅ `forum-channel.tsx` — post list, sort, drill-down | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Media channels (gallery) | ✅ `media-channel.tsx` | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Stage channels | ✅ Speaker/audience model | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Channel reordering | ✅ `reorder_channels` RPC | ✅ | ✅ | Parity |
| Channel permissions overrides | ✅ `channel-permissions-editor.tsx` | ✅ | ✅ Per-role allow/deny | Parity |
| Channel archiving | ❌ `archived` field in threads only; no channel archive | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| Temporary channels (auto-expire) | ✅ Migration 00016 | ❌ | ❌ | **Ahead** |
| Sub-channels / sections | ❌ | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |

---

## 11. Server / Workspace Management

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Server creation + invite codes | ✅ | ✅ | ✅ InviteOthers perm | Parity |
| Invite expiry + max uses | ✅ Multiple expire options (30m–7d), use limits | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Server discovery (public directory) | ✅ `/channels/discover` | ✅ | ✅ /discover route | Parity |
| Server templates (import/export) | ✅ 4 built-in templates, JSON import/export | ✅ | ❌ | **Ahead** |
| Audit logs | ✅ `audit-log-page.tsx`, emoji/moderation/role events | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Role management (bitmask permissions) | ✅ 20-bit Discord-style bitmask | ✅ | ✅ Granular bitmask perms | Parity |
| Permission Sandbox | ✅ `permission-sandbox.tsx` | ❌ | ❌ | **Ahead** |
| Data export (GDPR) | ✅ `GET /api/users/export` + settings UI | ✅ | ✅ GDPR compliant | Parity |
| SSO / SAML | ❌ OAuth connections only | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| Vanity invite URL | ❌ | ✅ | ❌ | 🟡 Discord has vanity URLs for large communities |
| Server boosting / premium tiers | ❌ | ✅ | ❌ All features free | 🟢 Intentional skip — Stoat also "all features free" |
| Self-hosting (open source) | ❌ | ❌ | ✅ Docker Compose | 🟢 Stoat-unique — different deployment model |

---

## 12. Moderation

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Ban / kick members | ✅ BAN_MEMBERS + KICK_MEMBERS bits | ✅ | ✅ BanMembers+KickMembers | Parity |
| Member timeout | ✅ MODERATE_MEMBERS + `/timeout` API | ✅ | ✅ TimeoutMembers perm | Parity |
| AutoMod keyword filters | ✅ `keyword_filter` + `regex_filter` triggers | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Anti-spam (mention/link/rapid) | ✅ Mention spam, link spam, rapid message detection | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Content screening (review queue) | ✅ Accept/reject queue | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Moderation timeline | ✅ Full timeline per member | ❌ | ❌ | **Ahead** |
| Report system + appeals | ✅ `report-modal.tsx`, `/appeals` | ✅ | ✅ Report messages | Parity |
| Raid protection (auto-detect) | ❌ Rapid-message as proxy only | ✅ | ❌ | 🟡 Discord has explicit raid mode; lower priority for smaller communities |
| Verification levels (phone, email age) | ❌ Email verified only | ✅ | ❌ | 🟡 Discord-specific — useful for large public servers |
| AutoMod actions (quarantine, timeout, alert) | ✅ Block, quarantine, timeout, warn, alert_channel | ✅ | ❌ | **VortexChat ahead** of Stoat |

---

## 13. Accessibility

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Keyboard shortcuts | ✅ 12+ shortcuts, `keyboard-shortcuts-modal.tsx` | ✅ | ⚠️ Basic | Parity |
| Focus trap in modals | ✅ `focus-trap.ts` | ✅ | ❌ | **VortexChat ahead** of Stoat |
| ARIA labels | ✅ Present on buttons, tabs, dialogs | ✅ | ⚠️ Minimal | **VortexChat ahead** of Stoat |
| Screen reader optimization | ✅ `aria-live` regions + live announcements in `chat-area.tsx` | ⚠️ | ❌ | **VortexChat ahead** of both |
| High contrast mode | ❌ Saturation toggle only | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| Font scaling | ✅ Small / Normal / Large | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Reduced motion support | ✅ `prefers-reduced-motion` respected | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Link/content skip navigation | ❌ | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |

---

## 14. Mobile / PWA

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| Installable PWA (manifest + SW) | ✅ Multi-strategy caching | ❌ | ✅ /pwa route | Parity with Stoat; **ahead** of Discord |
| Offline banner + outbox | ✅ FSM-based, localStorage queue | ✅ | ❌ | **VortexChat ahead** of Stoat |
| Mobile bottom tab bar | ✅ Responsive `md:` breakpoint | ✅ | ⚠️ Basic | Parity |
| Mobile back-button handling | ✅ Two-entry history stack | ✅ | ⚠️ Basic | Parity |
| Splash / skeleton screens | ✅ Shimmer, reduced-motion | ✅ | ❌ | **VortexChat ahead** of Stoat |
| SW update detection | ✅ Hourly polling + toast | ✅ | ❌ | **VortexChat ahead** of Stoat |
| iOS splash screens | ✅ 8 device sizes | ❌ | ❌ | **VortexChat ahead** of both |
| Web Share API | ✅ `navigator.share()` in context menu | ❌ | ❌ | **VortexChat ahead** of both |
| Input modes (`inputmode`) | ✅ Search, email, numeric | ❌ | ❌ | **VortexChat ahead** of both |
| Native mobile app | ❌ PWA only | ✅ | ✅ Android (Kotlin) + iOS | 🟢 Intentional — PWA-first strategy |
| Push on PWA (iOS 16.4+) | ✅ VAPID-based | ❌ | ❌ | **Ahead** on PWA push |

---

## 15. API & Developer Tools

| Feature | VortexChat | Discord | Stoat | Notes / Gap Severity |
|---|---|---|---|---|
| REST API (internal) | ✅ Full Next.js API routes | ✅ | ✅ Delta REST API | Parity |
| OpenAPI spec | ✅ `/api/docs` (authenticated) | ❌ | ✅ Auto-generated from API | Parity with Stoat; **ahead** of Discord |
| Public developer API / bot token auth | ❌ Session-cookie only | ✅ | ✅ Bot token auth | 🔴 Both Discord and Stoat have this |
| Bot SDK / library | ❌ | ✅ | ✅ revolt.js, revolt.py, Rust | 🔴 Both have multi-language SDKs |
| Webhook (incoming) | ✅ Per-channel token | ✅ | ✅ | Parity |
| Webhook (outgoing / events) | ❌ | ❌ | ❌ | Not a gap — neither Discord nor Stoat has this |
| Embed API (widget for websites) | ❌ | ✅ | ❌ | 🟢 Discord-specific |
| Custom status / rich presence | ✅ Status message + emoji | ✅ | ✅ | Parity |
| OAuth2 for third-party apps | ❌ | ✅ | ❌ | 🟡 Needed for app ecosystem |
| Rate limiting on API | ✅ Upstash Redis-backed | ✅ | ✅ | Parity |

---

## Top 10 Priority Items (status-tracked)

### Recently Closed

| Rank | Gap | Impact | Effort | Rationale |
|---|---|---|---|---|
| **1** | **Inline audio/video player** | High | Low | `<audio>`/`<video>` in `message-item.tsx` |
| **2** | **Screen share with system audio** | High | Low | `audio: true` in `getDisplayMedia()` + track forwarding |
| **3** | **Notification schedule (quiet hours)** | High | Medium | `quiet-hours.ts` + migration + settings UI |
| **4** | **Screen reader `aria-live` regions for chat** | Medium | Low | `aria-live` + live announcements in `chat-area.tsx` |
| **5** | **Data export (GDPR compliance)** | High | Medium | `GET /api/users/export` + settings UI |
| **7** | **Thread auto-archive** | Medium | Low | Discord-style auto-archive with configurable durations (1h/24h/3d/1w), cron job, auto-unarchive on message send. |
| **10** | **Sticker packs** | Low | Medium | Klipy sticker API (search + trending) with tabbed picker in channels + DMs. |

Note: ranks 6, 8, and 9 are intentionally omitted here because they remain open — see the "Open Gaps" section below.

### Open Gaps

| Rank | Gap | Severity | Impact | Effort | Rationale |
|---|---|---|---|---|---|
| **6** | **Public bot API + token auth** | 🔴 | High | High | Introduce bot tokens, separate from user sessions. Critical for ecosystem growth but significant work. ~1-2 weeks. |
| **8** | **Bot SDK / library** | 🔴 | High | High | Both Discord and Stoat offer multi-language SDKs. Depends on #6 (public API). ~2-3 weeks. |
| **9** | **Raid protection (auto-detect)** | 🟡 | Medium | Medium | Discord has explicit raid mode. Extend existing automod system with join-rate detection + lockdown. ~3-5 days. |

### All 🟡 Nice-to-Have Gaps (with implementation plans)

Full implementation plans for most gaps below are in [critical-gap-implementation-plans.md](./critical-gap-implementation-plans.md).

| # | Gap | Severity | Complexity | Plan Section |
|---|---|---|---|---|
| 14 | OAuth app installs | 🟡 | M | No plan yet — Discord-style OAuth app marketplace |
| 16 | Mobile push (native app) | 🟡 | L | Gap 16 — deferred (Capacitor wrapper) |
| 17 | Zapier / Make connector | 🟡 | S | Gap 17 — depends on public API (#6) |
| 18 | OAuth2 for third-party apps | 🟡 | L | Gap 18 — OAuth2 server, depends on #6 |
| 20 | Vanity invite URLs | 🟡 | S | Gap 20 — single column + route |
| 21 | Raid protection | 🟡 | M | Gap 21 — extends automod system |
| 22 | Verification levels | 🟡 | S | Gap 22 — server setting + join gate |

---

## Areas Where VortexChat Is **Ahead**

| Feature | VortexChat | Discord & Stoat |
|---|---|---|
| Voice intelligence (transcripts + summaries) | ✅ Full pipeline with consent | Neither Discord nor Stoat has this |
| Permission Sandbox | ✅ Test permissions before applying | Neither Discord nor Stoat has this |
| Server templates (import/export) | ✅ 4 built-in + JSON portability | Discord has basic templates; Stoat has none |
| Moderation timeline (per-member) | ✅ Full action history | Neither Discord nor Stoat has this |
| Temporary channels (auto-expire) | ✅ | Neither Discord nor Stoat has this |
| PWA push on iOS | ✅ VAPID + SW-based | Discord uses native apps; Stoat PWA lacks push |
| All features free (no paywall) | ✅ | Stoat also free; Discord gates features behind Nitro |
| Threads & forum channels | ✅ Full thread system + forum channels | Stoat has no threads or forums |
| AutoMod system | ✅ Keyword/regex filters, anti-spam, review queue | Stoat lacks AutoMod entirely |
| Advanced search filters | ✅ `from:`, `before:`, `after:`, `has:` | Stoat has basic search only |

## Areas Where Stoat Is **Ahead**

| Feature | Stoat | VortexChat |
|---|---|---|
| Public bot SDK (multi-language) | ✅ JS, Python, Rust, Go, C#, Swift + community libs | ❌ Internal API only |
| Self-hostable (open source) | ✅ Docker Compose, full FOSS (AGPL-3.0) | ❌ SaaS only |
| Masquerade (alt identity posting) | ✅ Unique feature | ❌ |
| Platform bridges (Discord, Matrix) | ✅ revcord, matrix-appservice-revolt | ❌ |
| Native mobile apps | ✅ Android (Kotlin) + iOS | ❌ PWA only |

---

*This audit should be re-run quarterly or after major feature sprints.*
*Last updated: 2026-03-18 — Slack and Teams removed from comparison (enterprise platforms outside VortexChat's target market). Comparison now focuses on Discord and Stoat only. 🔴 Gaps 1–5 implemented, Gap 7 (thread auto-archive) implemented, Gap 10 (stickers) implemented.*
