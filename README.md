# VortexChat

<p align="center">
  <img src="apps/web/public/icon-192.png" alt="VortexChat" width="80" />
</p>

<h1 align="center">VortexChat</h1>

<p align="center">
  An open-source, focused chat app — encrypted DMs, small group chats, and voice calls with a real audio EQ. Built with Next.js, Supabase, and WebRTC.
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

- **1:1 and group DMs** — real-time messaging via Supabase Realtime (Postgres CDC), zero polling
- **End-to-end encryption** — optional E2EE for direct messages
- **Reactions** — emoji reactions, live-synced across clients
- **Replies** — reply to messages, edit, soft-delete
- **File uploads** — images and files via Supabase Storage
- **Search** — full-text search within a conversation + local search index
- **Slash commands, GIFs & stickers** — built-in composer shortcuts, GIF/sticker/meme pickers

### Voice & Video

- **Voice & video calls** — P2P WebRTC over a self-hosted Socket.IO signaling server, for both 1:1 DMs and small group chats (full-mesh)
- **Audio EQ** — per-user audio settings (bass/treble/noise suppression), not a fixed default
- **Screen share** — `getDisplayMedia`, streamed over WebRTC

### Personalization

- **Per-conversation themes** — set a theme preset per DM/group chat, shared with everyone in it
- **Appearance settings** — theme presets, accent colors, fonts, message density, and more, applied account-wide
- **Profiles** — display name, bio, status, custom tag, banner color
- **Badges & connections** — Steam/YouTube account connections

### Social

- **Friends** — friend requests, suggestions, status — the way you find people to chat with
- **Presence** — online/offline/idle presence via Supabase Realtime
- **Blocking** — user blocking with configurable policy enforcement

### Platform

- **Auth** — email/password + passkeys + MFA via Supabase Auth, with login-risk lockout and recovery codes
- **Push notifications** — Web Push via VAPID
- **PWA** — installable progressive web app with offline support
- **Rate limiting** — Upstash Redis-backed rate limiting on API routes
- **Error monitoring** — Sentry integration
- **Offline / outbox** — message consistency with reconnect replay ([docs](./docs/message-consistency-model.md))
- **Quiet hours** — configurable notification suppression

---

## Tech Stack

| Layer | Tech |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS, Radix UI |
| **Database** | Supabase (PostgreSQL + Realtime + Storage) |
| **Auth** | Supabase Auth |
| **Voice signaling** | Node.js + Socket.IO (+ Redis adapter for clustering) |
| **Voice transport** | WebRTC (P2P, full-mesh for group calls) |
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
│   │       ├── supabase/       # Client, server, proxy helpers
│   │       ├── webrtc/         # Voice call hooks
│   │       ├── voice/          # Audio settings / EQ
│   │       ├── stores/         # Zustand state management
│   │       └── ...             # Utils, DM theme presets, etc.
│   └── signal/                 # Node.js WebRTC signaling server
│       └── src/
│           ├── index.ts        # Socket.IO server entry
│           ├── rooms.ts        # In-memory room state
│           └── redis-rooms.ts  # Redis-backed room state (clustering)
├── packages/
│   └── shared/                 # Shared types, event-bus/gateway/presence contracts
│       └── src/index.ts
├── supabase/
│   └── migrations/             # SQL migrations + RLS policies
├── scripts/                    # Dev tooling (dep cycles, migration smoke test)
├── docs/                       # Architecture docs, feature tracking
├── deploy/                     # Deployment guide (Vercel + Railway + Supabase)
├── .github/workflows/          # CI
├── turbo.json                  # Turborepo pipeline config
├── docker-compose.yml          # Local dev services
└── CONTRIBUTING.md             # Contribution guidelines
```

---

## Per-Conversation Theming

Any member of a DM or group chat can set a shared theme preset for that conversation (`PATCH /api/dm/channels/{channelId}/theme`), stored on `dm_channels.theme_preset`. It reuses the same preset catalog as user-level appearance settings, applied by setting `data-theme-preset` on the conversation's root element so the existing theme CSS cascades to everyone viewing it. See `apps/web/lib/dm-theme.ts` and `apps/web/components/dm/conversation-theme-picker.tsx`.

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
