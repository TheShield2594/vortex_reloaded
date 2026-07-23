#!/usr/bin/env bash
set -euo pipefail

##############################################################################
#  VortexChat Self-Hosted Setup Script
#
#  Generates secrets, writes ./livekit.yaml, and prepares the .env file
#  for a self-hosted deployment (SQLite + self-hosted LiveKit + coturn).
#
#  Usage:
#    chmod +x scripts/setup.sh
#    ./scripts/setup.sh
#
#  Then:  docker compose up -d
##############################################################################

ENV_FILE=".env"
DATA_DIR="./data"
LIVEKIT_TEMPLATE="deploy/livekit.yaml.example"
LIVEKIT_CONFIG="./livekit.yaml"

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
err()   { echo -e "${RED}[error]${NC} $*"; }

# ─── Header ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}┌─────────────────────────────────────────────┐${NC}"
echo -e "${BOLD}│       VortexChat Self-Hosted Setup           │${NC}"
echo -e "${BOLD}└─────────────────────────────────────────────┘${NC}"
echo ""

# ─── Check prerequisites ────────────────────────────────────────────────────
check_command() {
  if ! command -v "$1" &>/dev/null; then
    err "$1 is required but not installed."
    exit 1
  fi
}

check_command docker
check_command openssl
info "Prerequisites OK (docker, openssl)"

if [ ! -f "$LIVEKIT_TEMPLATE" ]; then
  err "Missing $LIVEKIT_TEMPLATE — run this script from the repo root."
  exit 1
fi

# ─── Data directory (SQLite lives here as a plain file) ─────────────────────
mkdir -p "$DATA_DIR"
ok "Created ${DATA_DIR} — this is where the SQLite database file (vortex.db) will
       live on the host. Point your backup/snapshot tooling (e.g. a Backblaze
       B2 sync) at this directory."

# ─── Generate secrets ────────────────────────────────────────────────────────
gen_secret() { openssl rand -hex 32; }

AUTH_SECRET=$(gen_secret)
CRON_SECRET=$(gen_secret)
STEP_UP_SECRET=$(gen_secret)
SIGNAL_REVOKE_SECRET=$(gen_secret)
TURN_SECRET=$(gen_secret)
LIVEKIT_API_KEY="APIvortex$(openssl rand -hex 6)"
LIVEKIT_API_SECRET=$(openssl rand -hex 32)

info "Generated AUTH_SECRET, CRON_SECRET, STEP_UP_SECRET, SIGNAL_REVOKE_SECRET"
info "Generated TURN_SECRET (shared by coturn and LiveKit's turn_servers config)"
info "Generated LIVEKIT_API_KEY / LIVEKIT_API_SECRET"

# ─── Generate VAPID keys ────────────────────────────────────────────────────
generate_vapid() {
  if command -v npx &>/dev/null; then
    info "Generating VAPID keys for Web Push..."
    local output
    output=$(npx --yes web-push generate-vapid-keys --json 2>/dev/null || echo "")
    if [ -n "$output" ]; then
      VAPID_PUBLIC_KEY=$(echo "$output" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); console.log(j.publicKey)" 2>/dev/null || echo "")
      VAPID_PRIVATE_KEY=$(echo "$output" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); console.log(j.privateKey)" 2>/dev/null || echo "")
      if [ -n "$VAPID_PUBLIC_KEY" ] && [ -n "$VAPID_PRIVATE_KEY" ]; then
        ok "VAPID keys generated"
        return
      fi
    fi
  fi
  warn "Could not generate VAPID keys automatically."
  warn "Run 'npx web-push generate-vapid-keys' manually and add to .env"
  VAPID_PUBLIC_KEY=""
  VAPID_PRIVATE_KEY=""
}

generate_vapid

# ─── Interactive prompts ─────────────────────────────────────────────────────
echo ""
read_with_default() {
  local prompt="$1"
  local default="$2"
  local varname="$3"
  if [ -n "$default" ]; then
    echo -ne "  ${prompt} [${default}]: "
  else
    echo -ne "  ${prompt}: "
  fi
  read -r input
  printf -v "$varname" '%s' "${input:-$default}"
}

read_with_default "App URL (where users access VortexChat)" "http://localhost:3000" APP_URL
echo ""

# Default signal URL for single-machine deployments
SIGNAL_DEFAULT="ws://localhost:3001"
if [[ "$APP_URL" != *"localhost"* ]]; then
  SIGNAL_DEFAULT=""
fi
read_with_default "Signal server WebSocket URL" "$SIGNAL_DEFAULT" SIGNAL_URL

echo ""
echo -e "${BOLD}TURN/coturn needs to know this box's public IP${NC}"
echo "  (used for WebRTC relay candidates when a client can't reach LiveKit"
echo "  directly — e.g. corporate networks, symmetric NAT)."
DETECTED_IP=""
if command -v curl &>/dev/null; then
  DETECTED_IP=$(curl -s --max-time 3 https://api.ipify.org || echo "")
fi
read_with_default "Public IP of this server" "$DETECTED_IP" TURN_EXTERNAL_IP
if [ -z "$TURN_EXTERNAL_IP" ]; then
  warn "No public IP set — TURN relay candidates will be wrong until you set"
  warn "TURN_EXTERNAL_IP in .env and re-run this script (or edit ./livekit.yaml"
  warn "and coturn's command args in docker-compose.yml directly)."
fi

echo ""
LIVEKIT_DEFAULT="ws://${TURN_EXTERNAL_IP:-localhost}:7880"
read_with_default "Public LiveKit URL (browsers connect here)" "$LIVEKIT_DEFAULT" LIVEKIT_PUBLIC_URL

echo ""
echo -e "${BOLD}Self-hosted push notifications (ntfy) — issue #38${NC}"
echo "  Alternative to Web Push that never routes through Google FCM / Apple"
echo "  APNs. Ships in docker-compose.yml by default; users opt in per-account"
echo "  from Settings → Notifications."
NTFY_DEFAULT="http://${TURN_EXTERNAL_IP:-localhost}:8080"
read_with_default "Public ntfy URL (clients subscribe here)" "$NTFY_DEFAULT" NTFY_PUBLIC_URL

# ─── Generate livekit.yaml from the template ────────────────────────────────
sed \
  -e "s|__TURN_EXTERNAL_IP__|${TURN_EXTERNAL_IP}|g" \
  -e "s|__TURN_SECRET__|${TURN_SECRET}|g" \
  -e "s|__LIVEKIT_API_KEY__|${LIVEKIT_API_KEY}|g" \
  -e "s|__LIVEKIT_API_SECRET__|${LIVEKIT_API_SECRET}|g" \
  "$LIVEKIT_TEMPLATE" > "$LIVEKIT_CONFIG"
ok "Wrote ${LIVEKIT_CONFIG} (contains secrets — already gitignored)"

# ─── Write .env ─────────────────────────────────────────────────────────────
if [ -f "$ENV_FILE" ]; then
  warn ".env already exists — backing up to .env.backup"
  cp "$ENV_FILE" "${ENV_FILE}.backup"
fi

cat > "$ENV_FILE" <<ENVEOF
# ─── VortexChat Self-Hosted Configuration ─────────────────────────────────
# Generated by scripts/setup.sh on $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# ─── Database (SQLite) ───────────────────────────────────────────────────
# Plain file, bind-mounted from ./data on the host into both the web and
# signal containers (see docker-compose.yml). Back this file up directly —
# see deploy/SELF-HOSTING.md's Backblaze B2 section.
DATABASE_URL=file:/data/vortex.db

# ─── App URLs ────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=${APP_URL}
NEXT_PUBLIC_SIGNAL_URL=${SIGNAL_URL}

# ─── Auth ────────────────────────────────────────────────────────────────
AUTH_SECRET=${AUTH_SECRET}

# ─── Secrets (auto-generated) ────────────────────────────────────────────
CRON_SECRET=${CRON_SECRET}
STEP_UP_SECRET=${STEP_UP_SECRET}
SIGNAL_REVOKE_SECRET=${SIGNAL_REVOKE_SECRET}

# ─── Web Push (VAPID) ───────────────────────────────────────────────────
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}
VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}
VAPID_SUBJECT=mailto:admin@example.com

# ─── Redis ───────────────────────────────────────────────────────────────
# Managed by docker-compose — override only if using an external Redis.
# REDIS_URL=redis://redis:6379

# ─── LiveKit (self-hosted SFU, voice/video calls) ────────────────────────
NEXT_PUBLIC_LIVEKIT_URL=${LIVEKIT_PUBLIC_URL}
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
# Internal URL the web container uses server-side (RoomServiceClient calls,
# e.g. explicit room creation) — matches the livekit service name on the
# compose network, already set in docker-compose.yml's web.environment.
# Only override if you moved LiveKit outside this compose stack.
# LIVEKIT_API_URL=http://livekit:7880

# ─── coturn (TURN/STUN — WebRTC NAT traversal) ───────────────────────────
TURN_SECRET=${TURN_SECRET}
TURN_EXTERNAL_IP=${TURN_EXTERNAL_IP}
TURN_REALM=vortexchat.local
# Client-facing TURN URL(s) — point these at this box's public IP/hostname.
TURN_URL=turn:${TURN_EXTERNAL_IP}:3478
TURNS_URL=turns:${TURN_EXTERNAL_IP}:5349

# ─── ntfy (self-hosted push, issue #38) ──────────────────────────────────
# NTFY_SERVER_URL (the internal address the web container publishes to) is
# already set in docker-compose.yml's web.environment — no need to repeat
# it here. This is only the public URL clients use to subscribe.
NEXT_PUBLIC_NTFY_URL=${NTFY_PUBLIC_URL}
# NTFY_PORT=8080

# ─── GIF providers (optional — picker hidden when not configured) ────────
# KLIPY_API_KEY=your-klipy-api-key
# GIPHY_API_KEY=your-giphy-api-key

# ─── Error monitoring (optional) ─────────────────────────────────────────
# NEXT_PUBLIC_SENTRY_DSN=https://your-key@oXXXXXX.ingest.sentry.io/XXXXXXX

# ─── Social connections (optional) ───────────────────────────────────────
# STEAM_WEB_API_KEY=your-steam-web-api-key
# GOOGLE_CLIENT_ID=your-google-client-id
# GOOGLE_CLIENT_SECRET=your-google-client-secret

# ─── OAuth providers for Better Auth (optional) ──────────────────────────
# GITHUB_CLIENT_ID=your-github-oauth-client-id
# GITHUB_CLIENT_SECRET=your-github-oauth-client-secret
# TWITCH_CLIENT_ID=your-twitch-oauth-client-id
# TWITCH_CLIENT_SECRET=your-twitch-oauth-client-secret
ENVEOF

ok ".env written"

# ─── Validation ──────────────────────────────────────────────────────────────
echo ""
info "Validating configuration..."

errors=0

validate_set() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    err "  $name is not set"
    errors=$((errors + 1))
  else
    ok "  $name"
  fi
}

validate_set "DATABASE_URL" "file:/data/vortex.db"
validate_set "NEXT_PUBLIC_APP_URL" "$APP_URL"
validate_set "AUTH_SECRET" "$AUTH_SECRET"
validate_set "CRON_SECRET" "$CRON_SECRET"
validate_set "STEP_UP_SECRET" "$STEP_UP_SECRET"
validate_set "LIVEKIT_API_KEY" "$LIVEKIT_API_KEY"
validate_set "TURN_SECRET" "$TURN_SECRET"

if [ -z "$TURN_EXTERNAL_IP" ]; then
  warn "  TURN_EXTERNAL_IP is not set — edit .env and ${LIVEKIT_CONFIG} before"
  warn "  relying on TURN/relay for calls from restrictive networks"
fi

if [ -z "$VAPID_PUBLIC_KEY" ] || [ -z "$VAPID_PRIVATE_KEY" ]; then
  warn "  VAPID keys not set — push notifications will be disabled"
fi

if [ "$errors" -gt 0 ]; then
  echo ""
  err "$errors required variable(s) missing — edit .env before starting"
  exit 1
fi

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Setup complete!${NC}"
echo ""
echo "  Next steps:"
echo "    1. Review .env and ${LIVEKIT_CONFIG} — especially TURN_EXTERNAL_IP"
echo "       if it wasn't auto-detected correctly."
echo "    2. Open these ports on this box's firewall:"
echo "       3000/tcp (web), 3001/tcp (signal), 7880-7881/tcp (livekit),"
echo "       50000-50019/udp (livekit RTC), 3478/tcp+udp, 5349/tcp+udp,"
echo "       49160-49200/udp (coturn), 8080/tcp (ntfy)"
echo "    3. Start VortexChat:"
echo "       docker compose up -d"
echo "    4. Check status:"
echo "       docker compose ps && docker compose logs -f"
echo ""
echo "    Web:     ${APP_URL}"
echo "    Signal:  ${SIGNAL_URL}"
echo "    LiveKit: ${LIVEKIT_PUBLIC_URL}"
echo "    ntfy:    ${NTFY_PUBLIC_URL}"
echo "    Data:    ${DATA_DIR}/vortex.db (back this up — see deploy/SELF-HOSTING.md)"
echo ""
