# VortexChat — Self-Hosted Deployment Guide

Run VortexChat on your own infrastructure with plain Docker Compose — no
platform-specific magic, so this also imports cleanly as a stack in
Portainer (see [Deploying via Portainer](#deploying-via-portainer) below).

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

     ┌──────────────────┐   ┌───────────────────┐   ┌──────────────┐
     │   SQLite (file)   │   │  LiveKit + coturn │   │     ntfy     │
     │  ./data/vortex.db │   │  (voice/video)    │   │ (push, :8080)│
     │  mounted into web  │   │  :7880/:7881/UDP   │   └──────────────┘
     │  only              │   │  :3478/:5349/UDP   │
     └──────────────────┘   └───────────────────┘
```

**Database: SQLite.** The database is a single file, bind-mounted from
`./data` on the host into the `web` container only — `web` is the sole
service that reads or writes it, with SQLite running in-process. `signal`
needs no database access: it authenticates socket handshakes with JWTs
verified against `web`'s JWKS endpoint (`AUTH_JWKS_URL`), not by querying the
database. There's no separate database *service* in this stack.

Because SQLite is a single on-disk file with no network protocol, **this
stack must run on a single Docker host** — don't split it across a
Swarm/Kubernetes cluster without re-architecting the database layer.

**Schema migrations run automatically.** The `web` container's entrypoint
applies pending migrations against `./data/vortex.db` on every start
(idempotent), so a fresh install boots against a fully-created schema — no
manual `db:migrate` step. See [Database (SQLite)](#database-sqlite) below.

**Voice/video: self-hosted LiveKit + coturn.** LiveKit is the SFU that
carries call media; coturn is the TURN/STUN server clients fall back to
when they can't reach LiveKit directly (symmetric NAT, restrictive
corporate networks). Both run as containers in this same stack.

**Push notifications: Web Push, or self-hosted ntfy (issue #38).** Web
Push always delivers through the browser vendor's push service — Google
FCM for Chrome/Android, Apple APNs for Safari/iOS — even though everything
else here is self-hosted, which leaks "this user just got a message"
metadata to that third party. The `ntfy` service is a self-hosted
alternative: each user gets a private topic and subscribes to it directly
from the ntfy app/web UI pointed at *your* server, so no third party is
ever involved. It's an additional channel, not a hard swap — enable it per
user in Settings → Notifications, and leave Web Push unsubscribed if you
want ntfy exclusively.

---

## Prerequisites

- Docker and Docker Compose v2
- `openssl` and `curl` on the host (used by `scripts/setup.sh` to generate
  secrets and detect this box's public IP)
- Inbound firewall access on the ports listed under
  [Services](#services) below — LiveKit and coturn specifically need their
  UDP ranges reachable from the public internet, not just the TCP ports

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/theshield2594/vortexchat.git
cd vortexchat

# 2. Run the setup script — generates secrets, writes .env and livekit.yaml,
#    creates ./data for the SQLite file
chmod +x scripts/setup.sh
./scripts/setup.sh

# 3. Start everything
docker compose up -d

# 4. Check status
docker compose ps
docker compose logs -f
```

VortexChat will be available at `http://localhost:3000` (or your configured URL).

---

## Services

| Service | Port(s) | Description |
|---------|---------|-------------|
| `web` | 3000/tcp | Next.js frontend + API routes |
| `signal` | 3001/tcp | Socket.IO signaling (presence, typing, message gateway) |
| `redis` | 6379/tcp (internal only) | Shared cache, rate limiting, event bus |
| `cron` | — | Periodic task runner (internal only, calls `web` via Docker network) |
| `livekit` | 7880/tcp (signaling+API), 7881/tcp (TCP fallback), 50000-50019/udp (RTC media) | Self-hosted SFU for voice/video calls |
| `coturn` | 3478/tcp+udp, 5349/tcp+udp, 49160-49200/udp | TURN/STUN relay for restrictive networks |
| `ntfy` | 8080/tcp | Self-hosted push notifications (issue #38) — alternative to Web Push's FCM/APNs relay |

The database isn't a service — it's `./data/vortex.db` on the host,
bind-mounted into `web` (the only service that uses it).

---

## Configuration

All configuration is via environment variables in `.env` and
`./livekit.yaml`. Run `scripts/setup.sh` to generate both.

### Required Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | SQLite file path — `file:/data/vortex.db` inside the containers, set automatically |
| `NEXT_PUBLIC_APP_URL` | Public URL where users access VortexChat |
| `NEXT_PUBLIC_SIGNAL_URL` | WebSocket URL of the signal server (browsers connect here) |
| `SIGNAL_REVOKE_SECRET` | Shared secret between web and signal for realtime fan-out and session/channel revocation — **if unset, realtime is silently degraded**. Generated by `setup.sh` |
| `AUTH_SECRET` | Auth session encryption/signing secret |
| `CRON_SECRET` | Secret for authenticating cron job requests |
| `STEP_UP_SECRET` | HMAC secret for step-up auth tokens |
| `NEXT_PUBLIC_LIVEKIT_URL` | Public LiveKit WebSocket URL browsers connect to |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Shared with `livekit.yaml`'s `keys:` block — mints call join tokens |
| `TURN_SECRET` | Shared by coturn (`--static-auth-secret`) and `livekit.yaml`'s `turn_servers` block |
| `TURN_EXTERNAL_IP` | This box's public IP — used for TURN relay candidates and baked into `livekit.yaml` |
| `TURN_URL` / `TURNS_URL` | Client-facing TURN URLs, derived from `TURN_EXTERNAL_IP` |

### Auto-Configured by Docker Compose

| Variable | Value | Description |
|----------|-------|--------------|
| `REDIS_URL` | `redis://redis:6379` | Internal Redis |
| `WEB_URL` | `http://web:3000` | Cron → Web connection |
| `SIGNAL_SERVER_URL` | `http://signal:3001` | Web → Signal server-side event publish (HTTP, distinct from the browser's `NEXT_PUBLIC_SIGNAL_URL` WebSocket) |
| `ALLOWED_ORIGINS` | From `NEXT_PUBLIC_APP_URL` | Signal server CORS |
| `LIVEKIT_API_URL` | `http://livekit:7880` | Web → LiveKit server-side API calls (token minting itself needs no network call; this is for explicit room management) |
| `NTFY_SERVER_URL` | `http://ntfy:80` | Web → ntfy server-side publish calls. This is only the *default* — an `NTFY_SERVER_URL` already set in `.env` takes precedence (e.g. to point at an external ntfy instance instead of the bundled `ntfy` service) |

### Optional

| Variable(s) | Purpose | Notes |
|-------------|---------|-------|
| `KLIPY_API_KEY`, `GIPHY_API_KEY` | GIF providers | Picker hidden when not configured |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push | Push notifications disabled without these |
| `NEXT_PUBLIC_NTFY_URL` | Self-hosted push (ntfy) | Public URL clients subscribe to. `NTFY_SERVER_URL` (server-side publish address) is auto-set by docker-compose; Settings → Notifications hides the ntfy section until it's set, and needs `NEXT_PUBLIC_NTFY_URL` too before it can show a subscribe link. |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry | Error monitoring |
| `STEAM_WEB_API_KEY` | Steam API | Profile enrichment |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth | YouTube connections |
| `GITHUB_CLIENT_ID/SECRET`, `TWITCH_CLIENT_ID/SECRET` | OAuth sign-in | Additional auth providers |

---

## Database (SQLite)

- Lives at `./data/vortex.db` on the host (plus `-wal`/`-shm` companion
  files while the app is running — that's normal WAL-mode behavior, not
  corruption).
- Bind-mounted (not a Docker-managed named volume) specifically so it's a
  plain, directly-accessible file — any backup tool you already run on the
  host (rclone, restic, a cron job, Backblaze's own agent) can reach it
  without going through `docker cp` or volume inspection first.
- Only `web` mounts it — keep this stack on one host (SQLite has no network
  protocol to share the file across machines).
- **Schema creation is automatic.** `web`'s container entrypoint
  (`apps/web/docker-entrypoint.sh`) runs the migrations before starting the
  server, so the first `docker compose up` turns an empty `./data/vortex.db`
  into a fully-migrated database with no manual step. It's idempotent —
  drizzle skips table migrations it has already applied, and the FTS5/trigger
  SQL is all `IF NOT EXISTS` — so it's a no-op on every subsequent start. If
  you run the stack outside Docker, apply the schema yourself with
  `npm run db:migrate --workspace=packages/db`.

## File Storage (avatars/attachments)

- Uploaded avatars and DM attachments live under `./data/uploads/` on the
  host — the same bind-mounted volume as the SQLite file, just a different
  subdirectory (`avatars/` and `attachments/`), so backing up `./data`
  backs up both.
- `web` is the only service that touches it — attachments are served
  through an auth-checked download route, not directly off disk.
- The `attachment-decay` cron job deletes expired files from here on its
  own; no manual cleanup needed.

## Backups (Backblaze B2)

Don't copy `vortex.db` directly while the app is running — in WAL mode, a
raw file copy can catch a transaction mid-flight, split across the main
file and the `-wal` file, and land you with an inconsistent snapshot.
SQLite's own online backup API doesn't have this problem:

```bash
# scripts/backup-sqlite.sh — run on the host, e.g. via a nightly cron entry
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
sqlite3 ./data/vortex.db ".backup './data/backups/vortex-${STAMP}.db'"

# Sync to Backblaze B2 (rclone has a native b2 backend: `rclone config`)
rclone copy ./data/backups/vortex-${STAMP}.db b2:your-bucket/vortex-backups/

# Uploaded avatars/attachments aren't in vortex.db — back them up separately.
# `copy`, not `sync` — sync would delete remote files the decay cron has
# since purged locally (or everything, if this ever runs against an empty
# or mis-mounted ./data/uploads).
rclone copy ./data/uploads b2:your-bucket/vortex-uploads/

# Optional: prune anything older than 30 days, local and remote
find ./data/backups -name '*.db' -mtime +30 -delete
```

Restoring is the reverse: pull the backup file from B2, stop the stack,
replace `./data/vortex.db` with the restored file (removing any stale
`-wal`/`-shm` files alongside it), then start the stack again.

---

## Redis

Shared by `web` (cache, rate limiting) and `signal` (room state, event bus,
Socket.IO adapter). Single-node deployments work fine without it too —
`signal` falls back to in-memory state — but it's included by default and
costs little to keep running.

---

## Cron Jobs

The `cron` service calls the web app's HTTP endpoints on a schedule:

| Job | Description |
|-----|-------------|
| `attachment-decay` | Purges expired DM attachments past their retention window |
| `presence-cleanup` | Marks stale users as offline |

No configuration needed — the cron service uses `CRON_SECRET` from `.env`.

---

## Voice/Video: LiveKit + coturn

Both are first-class services in this stack, not optional add-ons.

- **LiveKit** (`livekit` service) is the SFU that carries call media.
  `./livekit.yaml` (generated by `scripts/setup.sh`) configures it —
  don't edit the checked-in `deploy/livekit.yaml.example` template, edit
  the generated `./livekit.yaml` instead (it's gitignored, since it
  contains your real API secret).
- **coturn** (`coturn` service) is the TURN/STUN fallback for clients that
  can't reach LiveKit directly. It shares `TURN_SECRET` with LiveKit's
  `turn_servers` config, so LiveKit hands clients working credentials for
  this same coturn instance.
- `TURN_EXTERNAL_IP` **must** be this box's real public IP — `setup.sh`
  tries to auto-detect it, but double check it before relying on TURN for
  real users. Wrong external IP is the most common cause of "calls connect
  on the same LAN but fail for remote users."

**Reverse proxy note:** if you put Caddy/nginx in front of `web`/`signal`,
you can also proxy LiveKit's `7880` WebSocket port the same way — but the
UDP media ports (`50000-50019`) and coturn's ports **cannot** be proxied;
they need to be reachable directly on this host's public IP.

---

## Reverse Proxy (Production)

**Caddy (auto-TLS):**
```
chat.example.com {
    reverse_proxy web:3000
}

signal.example.com {
    reverse_proxy signal:3001
}

livekit.example.com {
    reverse_proxy livekit:7880
}

ntfy.example.com {
    reverse_proxy ntfy:80
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

server {
    listen 443 ssl;
    server_name livekit.example.com;

    location / {
        proxy_pass http://livekit:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}

server {
    listen 443 ssl;
    server_name ntfy.example.com;

    location / {
        proxy_pass http://ntfy:80;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**ntfy over plaintext HTTP is not safe for an internet-facing deployment.**
With `NTFY_ENABLE_LOGIN: "false"` (this stack's default), a subscription
topic is effectively a bearer credential — anyone who can read the wire
can read notification content and, potentially, the topic itself. `scripts/setup.sh`
still defaults `NEXT_PUBLIC_NTFY_URL` to a plain `http://` URL (matching
this same script's existing `ws://`-by-default pattern for LiveKit's
public URL, TLS'd the same way via this reverse-proxy section rather than
enforced in the script) — put ntfy behind the Caddy/nginx block above and
switch `NEXT_PUBLIC_NTFY_URL` to `https://ntfy.example.com` before relying
on it outside a trusted LAN/tailnet.

If you front LiveKit with a domain like this, update `NEXT_PUBLIC_LIVEKIT_URL`
to `wss://livekit.example.com` and re-run `docker compose up -d` — the UDP
media/TURN ports still need to be open directly on the host regardless.

---

## Deploying via Portainer

This compose file is plain Docker Compose — no Coolify-specific labels or
conventions — so it imports as a Portainer **Stack** as-is.

1. **Generate config on the host first.** Portainer's stack editor doesn't
   run shell scripts for you, and `./livekit.yaml` (with real secrets) has
   to exist as a file before the `livekit` container can start. SSH into
   the box Portainer manages, clone this repo into whatever directory
   you'll use as the stack's project directory, and run:
   ```bash
   chmod +x scripts/setup.sh
   ./scripts/setup.sh
   ```
   This leaves `.env`, `./livekit.yaml`, and `./data/` sitting on disk,
   ready for the stack to mount.
2. In Portainer: **Stacks → Add stack**. Either point it at this repo/path
   (if Portainer has filesystem access to it) or paste the contents of
   `docker-compose.yml` directly.
3. Under the stack's **Environment variables** section, add every key from
   the `.env` file `setup.sh` generated (Portainer's stack env vars satisfy
   the same `${VAR}` interpolation the compose file uses — you don't need
   `env_file:` to work for this, though it also works if Portainer has
   filesystem access to the `.env` path).
4. Deploy the stack. Confirm `./data` and `./livekit.yaml` are on the same
   host path Portainer's containers see — if Portainer manages a remote
   Docker endpoint, the bind-mount paths in `docker-compose.yml` resolve on
   *that* host, not wherever you ran `setup.sh` from, so run `setup.sh` on
   the actual target host.
5. Re-running `setup.sh` after editing `.env` values by hand isn't
   necessary — Portainer's stack env vars take precedence for
   `${VAR}`-style interpolation in the compose file itself; just update
   them in the Portainer UI and redeploy the stack.

---

## Updating

```bash
git pull origin main
docker compose build
docker compose up -d
```

---

## Troubleshooting

**Web app won't start:**
- Check `docker compose logs web` for errors
- Confirm `./data` exists and is writable by the container (the Dockerfile
  creates `/data` owned by the app's non-root user, but a bind-mounted host
  directory keeps the host's ownership/permissions — `chmod 777 ./data` is
  the quick fix if you hit a permissions error, or `chown` it to UID 1001)

**Signal server can't connect:**
- Check CORS: `ALLOWED_ORIGINS` must match your app URL
- For WebSocket: ensure your reverse proxy supports `Upgrade` headers

**Push notifications not working:**
- Generate VAPID keys: `npx web-push generate-vapid-keys`
- Set `VAPID_SUBJECT` to a `mailto:` or `https:` URL

**ntfy push not showing up in Settings → Notifications:**
- `NTFY_SERVER_URL` must be set on the `web` container — `scripts/setup.sh`
  writes it via docker-compose's `web.environment` block automatically; if
  you're not using the bundled `ntfy` service, set it to your own server
  yourself in `.env`
- `NEXT_PUBLIC_NTFY_URL` must also be set for the subscribe link to appear
- Check `docker compose logs ntfy` — a missing `NTFY_BASE_URL` or port
  conflict on 8080 is the usual cause

**Calls fail for remote users but work on the same LAN:**
- `TURN_EXTERNAL_IP` is almost certainly wrong or unset — check both `.env`
  and `./livekit.yaml`'s `turn_servers[0].host`
- Confirm the UDP port ranges (`50000-50019` for LiveKit, `49160-49200` for
  coturn) are actually open on the host firewall, not just the TCP ports

**LiveKit container won't start:**
- Check `docker compose logs livekit` — a malformed `./livekit.yaml` is the
  usual cause; re-run `scripts/setup.sh` to regenerate it from the template

**Cron jobs not running:**
- Check `docker compose logs cron`
- Verify `CRON_SECRET` matches between `.env` and the web app
