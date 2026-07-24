# VortexChat

<p align="center">
  <img src="apps/web/public/icon-192.png" alt="VortexChat" width="80" />
</p>

<h1 align="center">VortexChat</h1>

<p align="center">
  An open-source, focused chat app — encrypted DMs, small group chats, and voice calls with a real audio EQ. Built with Next.js, SQLite, and LiveKit, self-hostable with a single Docker Compose stack.
</p>

<p align="center">
  <a href="https://coderabbit.ai"><img src="https://img.shields.io/coderabbit/prs/github/TheShield2594/vortexchat?utm_source=oss&utm_medium=github&utm_campaign=TheShield2594%2Fvortexchat&labelColor=171717&color=FF570A&label=CodeRabbit+Reviews" alt="CodeRabbit Reviews" /></a>
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/SQLite-Drizzle%20ORM-003b57?logo=sqlite&logoColor=white" alt="SQLite + Drizzle" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

---

## Features

### Messaging

- **1:1 and group DMs** — real-time messaging over a Socket.IO gateway (the `signal` service), zero polling
- **End-to-end encryption** — optional E2EE for direct messages
- **Reactions** — emoji reactions, live-synced across clients
- **Replies** — reply to messages, edit, soft-delete
- **File uploads** — images and files stored on local disk (`./data/uploads`), served through the app
- **Search** — SQLite FTS5 full-text search within a conversation + local search index
- **Slash commands, GIFs & stickers** — built-in composer shortcuts, GIF/sticker/meme pickers

### Voice & Video

- **Voice & video calls** — self-hosted [LiveKit](https://livekit.io) SFU with coturn TURN/STUN fallback, for both 1:1 DMs and small group chats
- **Audio EQ** — per-user audio settings (bass/treble/noise suppression), not a fixed default
- **Screen share** — `getDisplayMedia`, published to the LiveKit room

### Personalization

- **Per-conversation themes** — set a theme preset per DM/group chat, shared with everyone in it
- **Appearance settings** — theme presets, accent colors, fonts, message density, and more, applied account-wide
- **Profiles** — display name, bio, status, custom tag, banner color
- **Badges & connections** — Steam/YouTube account connections

### Social

- **Friends** — friend requests, suggestions, status — the way you find people to chat with
- **Presence** — online/offline/idle presence via the Socket.IO gateway
- **Blocking** — user blocking with configurable policy enforcement

### Platform

- **Auth** — email/password + passkeys + MFA via [Better Auth](https://better-auth.com), with login-risk lockout and recovery codes
- **Push notifications** — Web Push via VAPID, or self-hosted [ntfy](https://ntfy.sh)
- **PWA** — installable progressive web app with offline support
- **Rate limiting** — Redis-backed rate limiting on API routes
- **Error monitoring** — Sentry integration
- **Offline / outbox** — message consistency with reconnect replay ([docs](./docs/message-consistency-model.md))
- **Quiet hours** — configurable notification suppression

---

## Tech Stack

| Layer | Tech |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS, Radix UI |
| **Database** | SQLite via Drizzle ORM (`@vortex/db`), FTS5 full-text search |
| **Auth** | Better Auth (email/password, passkeys, MFA) |
| **Realtime gateway** | Node.js + Socket.IO (+ Redis adapter for clustering) |
| **Voice/video** | LiveKit SFU + coturn (TURN/STUN) |
| **File storage** | Local disk (`./data/uploads`), bind-mounted volume |
| **State** | Zustand |
| **Rate limiting / cache** | Redis |
| **Monitoring** | Sentry |
| **Build** | Turborepo (npm workspaces) |
| **Deployment** | Self-hosted Docker Compose (web · signal · cron · redis · livekit · coturn · ntfy) |

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm 10+

> **Just want to run it?** For a production self-hosted deploy (all services,
> LiveKit voice, TLS), skip this section and follow
> [`deploy/SELF-HOSTING.md`](./deploy/SELF-HOSTING.md) — `scripts/setup.sh` +
> `docker compose up -d`. The steps below are for local development.

### 1. Clone & install

```bash
git clone https://github.com/TheShield2594/vortexchat.git
cd vortexchat
npm install
```

### 2. Create the SQLite database

```bash
# Generates ./packages/db/data/vortex.db (Drizzle migrations + FTS5 triggers).
# Override the location with DATABASE_URL=file:/absolute/path.db
npm run db:migrate --workspace=packages/db
```

### 3. Configure environment

```bash
cp apps/web/.env.local.example apps/web/.env.local
cp apps/signal/.env.example apps/signal/.env
# Set DATABASE_URL and BETTER_AUTH_SECRET at minimum (see the example files)
```

### 4. Run dev servers

```bash
# Both at once (via Turborepo)
npm run dev

# Or individually:
npm run web       # Next.js on http://localhost:3000
npm run signal    # Socket.IO realtime gateway
```

---

## Project Structure

```
vortexchat/
├── apps/
│   ├── web/                    # Next.js 16 frontend + API routes
│   │   ├── app/
│   │   │   ├── (auth)/         # Login, register
│   │   │   ├── api/            # REST endpoints (DMs, friends, auth, voice, ...)
│   │   │   ├── channels/       # Main chat interface (DMs, friends, settings)
│   │   │   ├── settings/       # User settings
│   │   │   └── ...             # Privacy, terms, verify-email, etc.
│   │   ├── components/
│   │   │   ├── chat/           # Composer, emoji/mention/slash-command pieces
│   │   │   ├── voice/          # Voice call UI, grid layout
│   │   │   ├── dm/             # DM area, DM/group calls, conversation theme picker
│   │   │   ├── notifications/  # Notification bell, push prompts
│   │   │   ├── layout/         # App shell, user panel
│   │   │   ├── modals/         # Search, profile settings, keyboard shortcuts
│   │   │   ├── onboarding/     # New user welcome flow
│   │   │   └── ui/             # Shared UI primitives (Radix-based)
│   │   └── lib/
│   │       ├── auth/           # Better Auth server/client config
│   │       ├── webrtc/         # Call media toggle hook (LiveKit)
│   │       ├── voice/          # Audio settings / EQ pipeline
│   │       ├── stores/         # Zustand state management
│   │       └── ...             # Utils, DM theme presets, etc.
│   ├── signal/                 # Node.js Socket.IO realtime gateway
│   │   └── src/
│   │       ├── index.ts        # Socket.IO server entry
│   │       ├── rooms.ts        # In-memory room state
│   │       └── redis-rooms.ts  # Redis-backed room state (clustering)
│   └── cron/                   # Periodic task runner (calls web API routes)
├── packages/
│   ├── db/                     # Drizzle schema, SQLite client, migrations
│   │   ├── src/schema/         # Table definitions
│   │   └── migrations/         # Generated SQL migrations + journal
│   └── shared/                 # Shared types, event-bus/gateway/presence contracts
│       └── src/index.ts
├── scripts/                    # Dev tooling (dep cycles, migration smoke test, setup.sh)
├── docs/                       # Architecture docs, feature tracking
├── deploy/                     # Self-hosting guide + LiveKit config example
├── .github/workflows/          # CI
├── turbo.json                  # Turborepo pipeline config
├── docker-compose.yml          # Self-hosted service stack
└── CONTRIBUTING.md             # Contribution guidelines
```

---

## Per-Conversation Theming

Any member of a DM or group chat can set a shared theme preset for that conversation (`PATCH /api/dm/channels/{channelId}/theme`), stored on `dm_channels.theme_preset`. It reuses the same preset catalog as user-level appearance settings, applied by setting `data-theme-preset` on the conversation's root element so the existing theme CSS cascades to everyone viewing it. See `apps/web/lib/dm-theme.ts` and `apps/web/components/dm/conversation-theme-picker.tsx`.

---

## Deployment

VortexChat is self-hosted as a single Docker Compose stack — see
[`deploy/SELF-HOSTING.md`](./deploy/SELF-HOSTING.md) for full instructions
(`scripts/setup.sh` generates secrets and config, then `docker compose up -d`).

| Service | Role |
|---|---|
| `web` | Next.js frontend + API routes (:3000) |
| `signal` | Socket.IO realtime gateway (:3001) |
| `cron` | Periodic task runner |
| `redis` | Cache, rate limiting, event bus |
| `livekit` + `coturn` | Self-hosted voice/video (SFU + TURN/STUN) |
| `ntfy` | Optional self-hosted push notifications |

The database is SQLite — a single file (`./data/vortex.db`) bind-mounted into
`web` and `signal`, not a separate service.

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for development guidelines and conventions.

---

## License

MIT
