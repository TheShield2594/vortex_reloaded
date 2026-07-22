# 23 — Webhooks & Integrations

> Covers: webhook CRUD, webhook execution, OAuth connections, sentry tunnel, workspace references, docs, tasks.

**Components under test:**
- `webhooks-modal.tsx`
- API: `/api/servers/[serverId]/webhooks`, `/api/webhooks/[token]`
- API: `/api/users/connections/oauth/*`, `/api/users/connections/steam/*`, `/api/users/connections/youtube/*`
- API: `/api/sentry-tunnel`
- API: `/api/workspace/reference`, `/api/docs`, `/api/docs/[docId]`
- API: `/api/channels/[channelId]/docs`, `/api/channels/[channelId]/tasks`
- API: `/api/tasks/[taskId]`
- `workspace-panel.tsx`, `workspace-reference-embed.tsx`

---

## 23.1 Webhooks

### `webhook-management.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should create a webhook | Server settings → Webhooks → Create | Webhook created with URL and token |
| 2 | should list webhooks | View webhooks tab | All webhooks listed |
| 3 | should edit webhook name/avatar | Edit → change → save | Updated |
| 4 | should delete webhook | Delete → confirm | Webhook removed |
| 5 | should require MANAGE_WEBHOOKS permission | Login without permission | Webhooks tab hidden |
| 6 | should copy webhook URL | Click copy | URL copied to clipboard |

### `webhook-execution.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should accept POST with valid token | POST to `/api/webhooks/[token]` with message body | Message posted in channel |
| 2 | should reject invalid token | POST with wrong token | 401 |
| 3 | should reject invalid payload | POST with malformed body | 400 |
| 4 | should support rich embeds | POST with embed object | Embed displayed |
| 5 | should rate limit excessive requests | 100 requests in 1 minute | Rate limited |
| 6 | should reject invalid signature/secret | POST with wrong signature | 401/403 |
| 7 | should retry delivery on target failure | Mock delivery endpoint down | Retries with backoff; failure recorded |
| 8 | should log delivery attempts | Trigger webhook delivery | Delivery audit record created |

---

## 23.2 OAuth Connections

### `oauth-connections.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should start GitHub OAuth flow | Click Connect GitHub | Redirect to GitHub OAuth |
| 2 | should handle OAuth callback | Return from OAuth | Connection saved |
| 3 | should start YouTube OAuth | Click Connect YouTube | Redirect to YouTube |
| 4 | should handle YouTube callback | Return | Connection saved |
| 5 | should start Steam auth | Click Connect Steam | Redirect to Steam |
| 6 | should handle Steam callback | Return | Connection saved |
| 7 | should show connected accounts publicly | View public profile | Connections shown |
| 8 | should disconnect account | Click disconnect | Connection removed |
| 9 | should handle OAuth denial | User denies permissions on provider | No connection saved; graceful error shown |
| 10 | should handle invalid OAuth state | Tamper with state parameter in callback | 400/403 error |
| 11 | should refresh expired OAuth tokens | Expire access token → trigger refresh | Connection continues working with new token |
| 12 | should handle refresh token failure | Simulate refresh failure | User prompted to reconnect |

---

## 23.3 Workspace & Docs

### `workspace-docs.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should create a document | Channel → Docs → Create | Doc created |
| 2 | should edit a document | Open doc → edit → save | Doc updated |
| 3 | should delete a document | Delete → confirm | Doc removed |
| 4 | should list channel documents | View docs panel | Docs listed |
| 5 | should embed workspace reference in message | Reference doc in message | Embed renders |
| 6 | should open workspace panel | Click docs icon | Panel opens |

### `workspace-tasks.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should create a task | Channel → Tasks → Create | Task created |
| 2 | should update task status | Toggle complete | Task updated |
| 3 | should assign task to user | Assign → select user | Task assigned |
| 4 | should link task to message | Create task from message | Message-task link |
| 5 | should list channel tasks | View tasks panel | Tasks listed |
| 6 | should delete a task | Delete → confirm | Task removed |

---

## 23.4 Admin & Analytics

### `server-admin.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show admin activity timeline | Server settings → Admin → Activity | Timeline shown |
| 2 | should show community health dashboard | Admin → Health | Dashboard with metrics |
| 3 | should run admin simulation | Admin → Simulate | Simulation results |
| 4 | should require ADMINISTRATOR permission | Login without permission | Admin tab hidden |
| 5 | should show AI settings | Server settings → AI Settings | AI config options |

---

## 23.5 Sentry Tunnel

### `sentry-tunnel.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should forward valid Sentry envelope | POST to `/api/sentry-tunnel` | Forwarded to Sentry |
| 2 | should reject invalid envelope | POST malformed data | 400 |
| 3 | should reject unauthorized DSN | POST with wrong DSN | 403 |
