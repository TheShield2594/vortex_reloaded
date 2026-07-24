# VortexChat — Deployment

VortexChat is **self-hosted** as a single Docker Compose stack. There is one
canonical guide:

### 👉 [`SELF-HOSTING.md`](./SELF-HOSTING.md)

It covers the full stack — `web`, `signal`, `cron`, `redis`, `livekit` +
`coturn` (voice/video), and optional `ntfy` push — plus `scripts/setup.sh`
(secret generation, `.env` and `livekit.yaml`), TLS/reverse-proxy setup, and
Portainer/Backblaze notes.

Quick start:

```bash
git clone https://github.com/theshield2594/vortexchat.git
cd vortexchat
./scripts/setup.sh          # generates secrets, .env, livekit.yaml, ./data
docker compose up -d
```

## Architecture at a glance

| Layer | Tech |
|---|---|
| Database | **SQLite** (`./data/vortex.db`), Drizzle ORM — no separate DB service |
| Auth | **Better Auth** (email/password, passkeys, MFA) |
| Realtime | **Socket.IO** gateway (`signal` service) |
| Voice/video | **LiveKit** SFU + **coturn** TURN/STUN |
| File storage | Local disk (`./data/uploads`) |
| Cache / rate limiting | Redis |
| Push | Web Push (VAPID) or self-hosted **ntfy** |

Files in this directory:

- [`SELF-HOSTING.md`](./SELF-HOSTING.md) — the deployment guide.
- [`livekit.yaml.example`](./livekit.yaml.example) — LiveKit config template
  (rendered by `scripts/setup.sh`).

## Local development

For running the app locally without the full container stack, see the
[Quick Start in the root README](../README.md#quick-start) — `npm run
db:migrate` to create the SQLite file, then `npm run dev`.
