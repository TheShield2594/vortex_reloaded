# VortexChat

<p align="center">
  <img src="apps/web/public/icon-192.png" alt="VortexChat" width="80" />
</p>

<h1 align="center">VortexChat</h1>

<p align="center">
  A full-featured, open-source real-time chat platform — think Discord, built with Next.js, Supabase, and WebRTC.
</p>

<p align="center">
  <a href="https://coderabbit.ai"><img src="https://img.shields.io/coderabbit/prs/github/TheShield2594/vortexchat?utm_source=oss&utm_medium=github&utm_campaign=TheShield2594%2Fvortexchat&labelColor=171717&color=FF570A&label=CodeRabbit+Reviews" alt="CodeRabbit Reviews" /></a>
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20Realtime-3ecf8e?logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

---

## Features

### Messaging

- **Real-time messaging** — Supabase Realtime (Postgres CDC), zero polling
- **Reactions** — emoji reactions, live-synced across clients
- **Replies & threads** — reply to messages, edit, soft-delete; full threaded conversations with auto-archive
- **File uploads** — images and files via Supabase Storage
- **Search** — full-text message search + local search index
- **Slash commands** — built-in channel command bar

### Servers & Channels

- **Servers** — create/join with invite codes, icon uploads
- **Server discovery** — public server directory
- **Blueprints** — import/export reusable server configurations (Gaming, Study, Startup, Creator starters)
- **Channel types** — text, voice, forum, stage, announcement, media, categories
- **Roles** — 21-bit bitmask permission system (Discord-style), free color picker
- **Webhooks** — incoming webhook support per channel

### Voice & Video

- **Voice chat** — dual-mode: P2P WebRTC (self-hosted signal server) or LiveKit SFU
- **Voice activity detection** — speaking indicators via hark.js
- **Screen share** — `getDisplayMedia`, streamed over WebRTC/LiveKit
- **DM calls** — voice calls in direct messages
- **Vortex Recap** — AI-powered transcripts and summaries

### Social

- **Direct messages** — 1:1 DMs with real-time updates and optional E2EE
- **Friends** — friend requests, suggestions, status
- **Profiles** — display name, bio, status, custom tag, banner color
- **Member list** — online/offline presence via Supabase Realtime Presence
- **Blocking** — user blocking with configurable policy enforcement

### Platform

- **Auth** — email/password + magic link via Supabase Auth
- **Push notifications** — Web Push via VAPID
- **PWA** — installable progressive web app with offline support
- **Moderation** — reports, appeals, Mod Ledger, member timeouts
- **Admin panel** — activity timeline, Permission Sandbox
- **Rate limiting** — Upstash Redis-backed rate limiting on API routes
- **Error monitoring** — Sentry integration
- **Offline / outbox** — message consistency with reconnect replay ([docs](./docs/message-consistency-model.md))
- **Quiet hours** — configurable notification suppression
- **GIFs & stickers** — GIF provider integration, sticker and meme support

---

## Tech Stack

| Layer | Tech |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS, Radix UI |
| **Database** | Supabase (PostgreSQL + Realtime + Storage) |
| **Auth** | Supabase Auth |
| **Voice signaling** | Node.js + Socket.IO (+ Redis adapter for clustering) |
| **Voice transport** | WebRTC (P2P) or LiveKit (SFU) |
| **State** | Zustand |
| **Rate limiting** | Upstash Redis |
| **Monitoring** | Sentry |
| **Build** | Turborepo (npm workspaces) |
| **Deployment** | Vercel (web) · Railway (signal) · Supabase Cloud (DB) |

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm 10+
- Supabase CLI (`npx supabase`)

### 1. Clone & install

```bash
git clone https://github.com/TheShield2594/vortexchat.git
cd vortexchat
npm install
```

### 2. Start Supabase locally

```bash
npx supabase start
npx supabase db push    # apply migrations
```

### 3. Configure environment

```bash
cp apps/web/.env.local.example apps/web/.env.local
cp apps/signal/.env.example apps/signal/.env
# Fill in your Supabase keys (from `npx supabase status`)
```

### 4. Run dev servers

```bash
# Both at once (via Turborepo)
npm run dev

# Or individually:
npm run web       # Next.js on http://localhost:3000
npm run signal    # WebRTC signaling server
```

> **LiveKit (optional):** Set `NEXT_PUBLIC_LIVEKIT_URL` in `apps/web/.env.local` to switch voice from P2P WebRTC to a LiveKit SFU. If unset, the self-hosted signal server is used.

---

## Project Structure

```
vortexchat/
├── apps/
│   ├── web/                    # Next.js 16 frontend + API routes
│   │   ├── app/
│   │   │   ├── (auth)/         # Login, register
│   │   │   ├── api/            # 30+ REST endpoints
│   │   │   ├── channels/       # Main chat interface
│   │   │   ├── discover/       # Server discovery
│   │   │   ├── appeals/        # Moderation appeals
│   │   │   ├── settings/       # User settings
│   │   │   ├── invite/         # Invite link handler
│   │   │   └── ...             # Privacy, terms, verify-email, etc.
│   │   ├── components/
│   │   │   ├── chat/           # MessageItem, ChatArea, MessageInput
│   │   │   ├── voice/          # VoiceChannel, voice intelligence
│   │   │   ├── dm/             # DM area, DM calls
│   │   │   ├── roles/          # RoleManager
│   │   │   ├── moderation/     # Moderation timeline
│   │   │   ├── admin/          # Admin panel, permission sandbox
│   │   │   ├── notifications/  # Notification bell, push prompts
│   │   │   ├── layout/         # ServerSidebar, ChannelSidebar, MemberList
│   │   │   ├── modals/         # Create server/channel, profile, settings
│   │   │   ├── onboarding/     # New user onboarding
│   │   │   └── ui/             # Shared UI primitives (Radix-based)
│   │   └── lib/
│   │       ├── supabase/       # Client, server, proxy helpers
│   │       ├── webrtc/         # useVoice, useLivekitVoice, useUnifiedVoice
│   │       ├── voice/          # Audio settings, voice intelligence
│   │       ├── stores/         # Zustand state management
│   │       └── ...             # Permissions, moderation, utils, etc.
│   └── signal/                 # Node.js WebRTC signaling server
│       └── src/
│           ├── index.ts        # Socket.IO server entry
│           ├── rooms.ts        # In-memory room state
│           ├── redis-rooms.ts  # Redis-backed room state (clustering)
│           └── voice-state-sync.ts
├── packages/
│   └── shared/                 # Shared types, permission bitmasks, utilities
│       └── src/index.ts        # PERMISSIONS, helpers, ChannelType, etc.
├── supabase/
│   └── migrations/             # SQL migrations + RLS policies
├── scripts/                    # Dev tooling (dep cycles, parity reports, etc.)
├── docs/                       # Architecture docs, feature tracking
├── deploy/                     # Deployment guide (Vercel + Railway + Supabase)
├── .github/workflows/          # CI + parity reporting
├── turbo.json                  # Turborepo pipeline config
├── docker-compose.yml          # Local dev services
└── CONTRIBUTING.md             # Contribution guidelines
```

---

## Permissions

Defined in [`packages/shared/src/index.ts`](./packages/shared/src/index.ts) and imported via `@vortex/shared`. Never hardcode permission bits.

| Permission | Bit | Value |
|---|---|---|
| `VIEW_CHANNELS` | 0 | 1 |
| `SEND_MESSAGES` | 1 | 2 |
| `MANAGE_MESSAGES` | 2 | 4 |
| `KICK_MEMBERS` | 3 | 8 |
| `BAN_MEMBERS` | 4 | 16 |
| `MANAGE_ROLES` | 5 | 32 |
| `MANAGE_CHANNELS` | 6 | 64 |
| `ADMINISTRATOR` | 7 | 128 |
| `CONNECT_VOICE` | 8 | 256 |
| `SPEAK` | 9 | 512 |
| `MUTE_MEMBERS` | 10 | 1024 |
| `STREAM` | 11 | 2048 |
| `MANAGE_WEBHOOKS` | 12 | 4096 |
| `MANAGE_EVENTS` | 13 | 8192 |
| `MODERATE_MEMBERS` | 14 | 16384 |
| `CREATE_PUBLIC_THREADS` | 15 | 32768 |
| `CREATE_PRIVATE_THREADS` | 16 | 65536 |
| `SEND_MESSAGES_IN_THREADS` | 17 | 131072 |
| `USE_APPLICATION_COMMANDS` | 18 | 262144 |
| `MENTION_EVERYONE` | 19 | 524288 |
| `MANAGE_EMOJIS` | 20 | 1048576 |

`ADMINISTRATOR` overrides all other permissions. All features are free — no paywall.

---

## Server Templates

VortexChat supports reusable **server templates** for quick setup:

- Built-in starters: **Gaming**, **Study**, **Startup**, and **Creator**
- Templates include roles, categories, channels, and permission overrides
- Import validates JSON, shows a diff preview, and applies transactionally
- Export serializes any server into a reusable template
- API: `POST /api/server-templates` — modes: `validate`, `preview`, `apply`, `create-server`, `export`

---

## Deployment

See [`deploy/README.md`](./deploy/README.md) for full instructions.

| Service | Platform |
|---|---|
| Web app | [Vercel](https://vercel.com) — root directory `apps/web` |
| Signal server | [Railway](https://railway.app) — from `apps/signal/Dockerfile` |
| Database / Auth / Storage | [Supabase Cloud](https://supabase.com) |

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for development guidelines and conventions.

---

## License

MIT
