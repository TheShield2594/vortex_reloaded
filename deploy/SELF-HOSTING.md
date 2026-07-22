# VortexChat — Self-Hosted Deployment Guide

Run VortexChat on your own infrastructure with Docker Compose.

---

## Architecture

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│   Web    │    │  Signal  │    │   Cron   │
│ (Next.js)│    │(Socket.IO│    │ (node-   │
│  :3000   │    │  :3001)  │    │  cron)   │
└────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │
     └───────┬───────┘               │
             │                       │
        ┌────▼─────┐          ┌──────▼──────┐
        │  Redis   │          │  Web :3000  │
        │  :6379   │          │  (HTTP)     │
        └──────────┘          └─────────────┘
             │
     ┌───────▼───────┐
     │   Database    │
     │  (your choice)│
     └───────────────┘
```

**You provide the database.** VortexChat uses the Supabase client library,
which works with:

- [Supabase Cloud](https://supabase.com) (free tier available)
- [Self-hosted Supabase](https://supabase.com/docs/guides/self-hosting)
- Any Postgres instance with Supabase's GoTrue auth + Storage API

---

## Prerequisites

- Docker and Docker Compose v2
- Node.js 20+ (for the setup script)
- A Supabase project (cloud or self-hosted) with migrations applied

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/theshield2594/vortexchat.git
cd vortexchat

# 2. Run the setup script — generates secrets, creates .env
chmod +x scripts/setup.sh
./scripts/setup.sh

# 3. Apply database migrations (if not done already)
npx supabase link --project-ref <your-project-ref>
npx supabase db push

# 4. Start everything
docker compose up -d

# 5. Check status
docker compose ps
docker compose logs -f
```

VortexChat will be available at `http://localhost:3000` (or your configured URL).

---

## Services

| Service | Port | Description |
|---------|------|-------------|
| `web` | 3000 | Next.js frontend + API routes |
| `signal` | 3001 | Socket.IO signaling (WebRTC, presence, gateway events) |
| `redis` | 6379 | Shared cache, rate limiting, event bus |
| `cron` | — | Periodic task runner (internal only, calls web via Docker network) |

---

## Configuration

All configuration is via environment variables in `.env`.
Run `scripts/setup.sh` to generate this file interactively.

### Required Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `NEXT_PUBLIC_APP_URL` | Public URL where users access VortexChat |
| `NEXT_PUBLIC_SIGNAL_URL` | WebSocket URL of the signal server |
| `CRON_SECRET` | Secret for authenticating cron job requests |
| `STEP_UP_SECRET` | HMAC secret for step-up auth tokens |

### Auto-Configured by Docker Compose

| Variable | Value | Description |
|----------|-------|-------------|
| `REDIS_URL` | `redis://redis:6379` | Internal Redis (set automatically) |
| `WEB_URL` | `http://web:3000` | Cron → Web connection (set automatically) |
| `ALLOWED_ORIGINS` | From `NEXT_PUBLIC_APP_URL` | Signal server CORS (set automatically) |

### Optional Services

| Variable(s) | Service | Notes |
|-------------|---------|-------|
| `TURN_URL`, `TURN_SECRET` | TURN server (coturn) | Required for ~20% of users behind strict NAT |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NEXT_PUBLIC_LIVEKIT_URL` | LiveKit SFU | Optional voice upgrade; P2P WebRTC works without it |
| `KLIPY_API_KEY`, `GIPHY_API_KEY` | GIF providers | GIF picker hidden when not configured |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push | Push notifications disabled without these |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry | Error monitoring (optional) |
| `STEAM_WEB_API_KEY` | Steam API | Profile enrichment (optional) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth | YouTube connections (optional) |

---

## Redis

Docker Compose includes a Redis 7 instance shared by all services:

- **Web app**: Application cache (L2) + rate limiting
- **Signal server**: Room state, event bus (Redis Streams), Socket.IO adapter

The web app supports two Redis backends:
- `REDIS_URL` — standard Redis (used by Docker Compose)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — Upstash (serverless)

If `REDIS_URL` is set, it takes priority. If neither is set, the app falls
back to in-memory stores (single-instance only).

---

## Cron Jobs

The `cron` service replaces Vercel Cron. It calls the web app's HTTP
endpoints on a schedule:

| Job | Schedule | Description |
|-----|----------|-------------|
| `scheduled-tasks` | Daily at midnight UTC | Event reminders, thread auto-archive, attachment decay |
| `presence-cleanup` | Every 2 minutes | Mark stale users as offline |
| `thread-auto-archive` | Every 5 minutes | Archive inactive threads |

No configuration needed — the cron service uses `CRON_SECRET` from `.env`.

---

## TURN Server (Recommended)

About 20% of users are behind strict NAT/firewalls where WebRTC peer
connections fail silently. A TURN server fixes this.

**Using coturn (self-hosted):**

```bash
# Install coturn
sudo apt install coturn

# /etc/turnserver.conf
listening-port=3478
tls-listening-port=5349
realm=your-domain.com
use-auth-secret
static-auth-secret=your-secret-here
```

Then set in `.env`:
```
TURN_URL=turn:your-server:3478
TURN_SECRET=your-secret-here
TURNS_URL=turns:your-server:5349
```

---

## Reverse Proxy (Production)

For production, put a reverse proxy in front:

**Caddy (auto-TLS):**
```
chat.example.com {
    reverse_proxy web:3000
}

signal.example.com {
    reverse_proxy signal:3001
}
```

**nginx:**
```nginx
server {
    listen 443 ssl;
    server_name chat.example.com;

    location / {
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl;
    server_name signal.example.com;

    location / {
        proxy_pass http://signal:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## Updating

```bash
git pull origin main
docker compose build
docker compose up -d

# Apply new migrations if any
npx supabase db push
```

---

## Troubleshooting

**Web app won't start:**
- Check `docker compose logs web` for errors
- Verify Supabase URL and keys in `.env`
- Ensure database migrations are applied

**Signal server can't connect:**
- Check CORS: `ALLOWED_ORIGINS` must match your app URL
- For WebSocket: ensure your reverse proxy supports `Upgrade` headers

**Push notifications not working:**
- Generate VAPID keys: `npx web-push generate-vapid-keys`
- Set `VAPID_SUBJECT` to a `mailto:` or `https:` URL

**Users can't connect voice:**
- Without a TURN server, ~20% of users behind strict NAT will fail
- Deploy coturn and configure `TURN_URL`/`TURN_SECRET`

**Cron jobs not running:**
- Check `docker compose logs cron`
- Verify `CRON_SECRET` matches between `.env` and the web app
