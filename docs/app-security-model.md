# App Security Model

This document defines the Vortex app platform security posture for app identity, install permissions, command/event runtime, analytics, and webhook compatibility.

## 1) App identity and trust

- Each app is represented by `app_catalog` with immutable `id` and stable `slug`.
- App trust metadata includes:
  - `trust_badge` (`verified`, `partner`, `internal`)
  - publisher identity under `identity` JSON.
- Marketplace only lists `is_published = true` apps.

## 2) Install scopes, permissions, and credentials

- Install entries are in `server_app_installs` and scoped to a server.
- `install_scopes` and `granted_permissions` are stored with the install snapshot.
- Credentials are stored in dedicated credential tables (`app_catalog_credentials`, `server_app_install_credentials`) with restrictive RLS and are not exposed in public catalog/install reads.
- Permissions are deny-by-default: requested permissions must exist in granted permissions.

## 3) Command + event interaction runtime

- Slash-like commands are registered with app ownership (`app_commands`).
- Runtime execution rejects command/app mismatch.
- Event subscriptions are explicit (`app_event_subscriptions`) and toggled by server owners.
- Rate limits are per-app (`app_rate_limits`) and enforced before command execution.

## 4) Analytics and abuse controls

- `app_usage_metrics` stores per-app usage events (install, uninstall, command usage, etc.).
- Rate limiting protects server resources from misbehaving apps.
- Review and rating signals help server admins evaluate trust and quality.

## 5) Webhook compatibility

- Existing webhook routes remain unchanged (`/api/servers/[serverId]/webhooks`, `/api/webhooks/[token]`).
- App installs do not mutate webhook token format or webhook delivery contract.
- Any app-stored webhook-like credentials are isolated in credential tables and only redacted values should be rendered in application logs/UI.

## 6) Test coverage

- Runtime tests verify command execution, event subscriptions, rate limiting, permission validation, and credential redaction.
- Webhook compatibility is maintained by preserving existing webhook API code paths.
