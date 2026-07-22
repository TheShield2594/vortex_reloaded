# VortexChat Security Audit Report

**Date:** 2026-03-31
**Scope:** Full application security assessment — authentication, authorization, API routes, Socket.IO/WebRTC signaling, database RLS, client-side security, supply chain, and infrastructure configuration.

---

## Executive Summary

VortexChat demonstrates **strong security fundamentals** across its stack. The application implements defense-in-depth with Supabase RLS at the database layer, bitmask-based permissions in the shared package, CSRF protection in the proxy layer, comprehensive rate limiting, and proper cryptographic practices throughout.

**No critical vulnerabilities** were identified. Several medium and low severity findings are documented below, ordered by urgency.

---

## Findings by Urgency

### 1. MEDIUM — TURN Credential Exposed to Client-Side Bundle

**Severity:** Medium | **CVSS:** 5.3 | **Category:** Credential Exposure
**Location:** `apps/web/.env.local.example:15`, used in:
- `apps/web/lib/webrtc/use-voice.ts:454`
- `apps/web/components/dm/dm-channel-area.tsx:2419`
- `apps/web/components/dm/dm-call.tsx:74`

**Issue:** `NEXT_PUBLIC_TURN_CREDENTIAL` is a static, long-lived credential embedded in the client-side JavaScript bundle via the `NEXT_PUBLIC_` prefix. Any user (or non-user) who inspects the page source can extract the TURN server credentials and abuse the TURN relay for traffic proxying, bandwidth theft, or anonymization.

**Exploit path:** View page source or network tab -> extract TURN username/credential -> use any WebRTC client to relay arbitrary traffic through the TURN server.

**Remediation:** Issue short-lived TURN credentials from a server-side API endpoint using time-limited HMAC-based credentials (RFC 8location). Most TURN servers (coturn, Twilio, Cloudflare) support ephemeral credentials:

```typescript
// apps/web/app/api/turn-credentials/route.ts
export async function GET() {
  const { user } = await requireAuth()
  const ttl = 86400 // 24 hours
  const timestamp = Math.floor(Date.now() / 1000) + ttl
  const username = `${timestamp}:${user.id}`
  const credential = crypto
    .createHmac("sha1", process.env.TURN_SHARED_SECRET!)
    .update(username)
    .digest("base64")
  return NextResponse.json({ username, credential, ttl })
}
```

Remove the `NEXT_PUBLIC_TURN_*` env vars and fetch credentials on-demand from the authenticated endpoint.

---

### 2. ~~MEDIUM — CSP Allows `unsafe-eval` and `unsafe-inline` for Scripts~~ ✅ REMEDIATED

**Severity:** Medium | **CVSS:** 4.7 | **Category:** XSS Mitigation Weakness
**Location:** ~~`apps/web/next.config.js:86`~~ → `apps/web/proxy.ts` (dynamic CSP)

**Status:** Remediated. CSP is now generated per-request in `proxy.ts` with a cryptographic nonce. `script-src` uses `'nonce-{nonce}' 'strict-dynamic'` — both `unsafe-eval` and `unsafe-inline` have been removed from the script directive. `style-src` retains `unsafe-inline` as required by Next.js CSS-in-JS. The nonce is forwarded to server components via the `x-nonce` request header and applied to the root `<html>` element in `layout.tsx`.

---

### 3. MEDIUM — Socket.IO Auth Cache Allows 30–120s Token Reuse After Revocation

**Severity:** Medium | **CVSS:** 4.3 | **Category:** Broken Authentication
**Location:** `apps/signal/src/index.ts` (auth validation cache, ~line 170–177)

**Issue:** The signal server caches validated session tokens for **30 seconds** and falls back to a **120-second grace period** if the auth service is unreachable. During this window, a revoked or expired token continues to be accepted for all signaling events (offer, answer, ICE candidate, voice state changes).

**Exploit path:** User's session is revoked (e.g., after password change or admin action) -> attacker with captured token has 30–120 seconds to continue sending signaling events and participating in voice channels.

**Remediation:**
1. Reduce the cache TTL to **10 seconds** — this is a reasonable trade-off between latency and revocation speed
2. Remove the 120-second fallback or reduce it to 15 seconds with a hard disconnect after
3. Implement a lightweight **token revocation list** (Redis SET with TTL) that the signal server checks before cache:

```typescript
// On password change / session revocation, publish to Redis:
await redis.sadd("revoked-tokens", tokenHash)
await redis.expire("revoked-tokens", 300) // 5 min TTL

// In validateSession():
if (await redis.sismember("revoked-tokens", tokenHash)) {
  socket.disconnect(true)
  return false
}
```

---

### 4. MEDIUM — Step-Up Secret Falls Back to NEXTAUTH_SECRET

**Severity:** Medium | **CVSS:** 4.0 | **Category:** Weak Cryptographic Key Management
**Location:** `apps/web/lib/auth/step-up.ts:20`

**Issue:** If `STEP_UP_SECRET` is not configured, the code falls back to `NEXTAUTH_SECRET`. Using the same secret for multiple cryptographic purposes (session signing and step-up token HMAC) violates the principle of key separation. A compromise of one secret compromises all dependent systems.

**Remediation:**
1. Make `STEP_UP_SECRET` required in production (the code already throws if both are missing, but the fallback still allows shared keys)
2. Remove the fallback:

```typescript
function stepUpSecrets(): string[] {
  const current = process.env.STEP_UP_SECRET
  if (!current) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("STEP_UP_SECRET must be set in production")
    }
    return ["local-step-up-secret"]
  }
  const prev = process.env.STEP_UP_SECRET_PREV
  return prev ? [current, prev] : [current]
}
```

3. Generate a dedicated 256-bit random secret for `STEP_UP_SECRET` in all environments

---

### 5. MEDIUM — Signal Server Events Lack Per-Event Auth Validation

**Severity:** Medium | **CVSS:** 4.0 | **Category:** Broken Access Control
**Location:** `apps/signal/src/index.ts` — `speaking`, `toggle-mute`, `toggle-deafen`, `screen-share` events

**Issue:** Only the `join-room` event performs full authentication with channel membership verification. Subsequent signaling events (`speaking`, `toggle-mute`, `toggle-deafen`, `screen-share`, `offer`, `answer`, `ice-candidate`) rely on the cached session from join-time. If a user is kicked from a channel or has their permissions revoked, they can continue participating in the voice session until the cache expires.

**Remediation:**
1. On permission/membership changes, emit a server-side `force-disconnect` event via Redis pub/sub to the signal server
2. On receiving `force-disconnect`, the signal server should immediately disconnect the socket from the room
3. Add periodic re-validation (every 60s) for long-lived voice sessions

---

### 6. MEDIUM — Username Enumeration via Friend Request Endpoint

**Severity:** Medium | **CVSS:** 3.7 | **Category:** Information Disclosure
**Location:** `/api/friends` POST route

**Issue:** The friend request endpoint uses the service role client to look up users by username, bypassing normal RLS discoverability rules. While rate-limited to 20 requests/hour per user, a determined attacker could enumerate valid usernames over time (480 checks/day per account, scalable with multiple accounts).

**Remediation:**
1. Return the same response regardless of whether the username exists: `"Friend request sent (if user exists)"`
2. Process the actual lookup and notification asynchronously so timing doesn't leak existence
3. Consider adding CAPTCHA or proof-of-work after N failed friend requests

---

### 7. LOW — `img-src` and `connect-src` CSP Directives Are Overly Broad

**Severity:** Low | **CVSS:** 3.1 | **Category:** Defense-in-Depth
**Location:** `apps/web/next.config.js:88,91`

**Issue:**
- `img-src 'self' blob: data: https:` — allows loading images from **any** HTTPS origin, which could be used for tracking pixels or data exfiltration via image URLs
- `connect-src 'self' wss: https:` — allows connecting to **any** WebSocket or HTTPS endpoint, weakening XSS blast radius containment

**Remediation:** Restrict to known domains:
```
img-src 'self' blob: data: https://*.supabase.co https://*.supabase.in https://cdn.klipy.co https://media.giphy.com
connect-src 'self' wss://*.supabase.co wss://<livekit-domain> https://*.supabase.co https://api.klipy.co https://api.giphy.com https://<sentry-dsn-host>
```

---

### 8. LOW — Suspicious Login Detection Is Informational Only

**Severity:** Low | **CVSS:** 2.4 | **Category:** Weak Authentication Controls
**Location:** `apps/web/lib/auth/risk.ts`

**Issue:** The login risk assessment system computes a risk score based on IP subnet changes (+45), location changes (+25), and user-agent changes (+30). Scores >= 60 trigger a notification but **do not block or challenge** the login. An attacker with stolen credentials from a different network sails through.

**Remediation:**
1. For scores >= 60: require MFA verification or email confirmation before completing login
2. For scores >= 80: temporarily lock the account and require email verification
3. Log high-risk successful logins to the audit trail for security team review

---

### 9. LOW — 46 Files Use TypeScript `any` Type

**Severity:** Low | **CVSS:** N/A | **Category:** Code Quality / Type Safety
**Location:** Various files across `apps/web/lib/` and `apps/web/app/api/`

**Issue:** 46 files contain `any` type usage. While most are justified (Supabase client response typing limitations), `any` bypasses TypeScript's type checker and can mask type-related bugs that could have security implications (e.g., accessing properties on undefined, passing wrong types to security-critical functions).

**Remediation:**
1. Replace `any` with `unknown` and add type guards where possible
2. Use Supabase's generated types (`Database["public"]["Tables"]`) for query responses
3. Add an ESLint rule: `@typescript-eslint/no-explicit-any: "error"` to prevent new occurrences

---

### 10. LOW — No Webhook Request Signing (HMAC)

**Severity:** Low | **CVSS:** 3.5 | **Category:** Broken Authentication
**Location:** `/api/webhooks/[token]`

**Issue:** Webhook endpoints authenticate solely via a bearer token in the URL path. There is no HMAC signature verification on the request body, meaning an attacker who discovers a webhook token (e.g., via logs, shared configs, or URL leakage) can send arbitrary payloads.

**Remediation:** Implement HMAC-SHA256 request signing:
```typescript
const signature = request.headers.get("X-Webhook-Signature")
const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex")
if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
  return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
}
```

---

### 11. INFORMATIONAL — `dangerouslySetInnerHTML` Usage (Safe)

**Location:** `apps/web/components/modals/dm-local-search-modal.tsx:220`

**Status:** The usage is safe — input is processed through `escapeHtml()` before insertion, and the pattern is used only for search term highlighting. No action required, but document the safety justification in a code comment if not already present.

---

### 12. INFORMATIONAL — No Explicit Secret Rotation Documentation

**Status:** The step-up token system supports key rotation via `STEP_UP_SECRET_PREV`, which is well-documented in code comments. However, there is no centralized documentation for rotating all secrets (Supabase keys, VAPID keys, LiveKit secrets, TURN credentials, cron secrets).

**Recommendation:** Create an operations runbook (`docs/secret-rotation.md`) documenting the rotation procedure for each secret, including the zero-downtime approach.

---

## Security Strengths

The following areas are well-implemented and represent strong security posture:

| Area | Assessment |
|---|---|
| **Authentication** | Supabase Auth with MFA (TOTP), passkeys/WebAuthn, recovery codes (scrypt-hashed), step-up auth for sensitive ops |
| **Authorization** | Centralized bitmask permissions in `@vortex/shared`, enforced at API + DB layers |
| **Database Security** | Comprehensive RLS policies across all tables, `SECURITY DEFINER` functions with pinned `search_path` |
| **Rate Limiting** | Multi-layer: Upstash Redis (sliding window) for HTTP, per-socket limits for WebSocket, fail-closed for auth endpoints |
| **CSRF Protection** | Origin/Referer validation in `proxy.ts` for all mutation methods |
| **Request Size Limits** | 1MB standard, 10MB uploads — enforced in proxy layer |
| **Input Validation** | Email format, password length, MIME type + magic byte verification, URL protocol whitelisting |
| **SQL Injection** | No raw SQL — all queries via Supabase parameterized client |
| **SSRF Protection** | OEmbed endpoint validates against private/reserved IP ranges with DNS pinning |
| **Cookie Security** | HttpOnly, SameSite=lax, Secure (production), appropriate expiry |
| **Cryptography** | `crypto.randomBytes(32)` for tokens, SHA-256 hashing, HMAC-SHA256 signatures, `timingSafeEqual` comparisons |
| **Error Handling** | Generic error responses, no stack traces or schema leakage to clients |
| **File Uploads** | Magic byte detection (16 signatures), extension blacklist, MIME whitelist, size limits, `crypto.randomUUID()` storage paths |
| **Security Headers** | HSTS with preload, X-Frame-Options DENY, X-Content-Type-Options nosniff, Permissions-Policy |
| **Environment Validation** | Startup checks for required secrets, fail-fast in production |
| **Audit Logging** | Moderation actions logged with actor, target, action, reason, timestamp |

---

## Summary Table

| # | Severity | Finding | Effort to Fix |
|---|---|---|---|
| 1 | **Medium** | TURN credential in client bundle | Medium |
| 2 | ~~**Medium**~~ ✅ | ~~CSP `unsafe-eval` + `unsafe-inline`~~ Remediated | — |
| 3 | **Medium** | 30–120s auth cache on signal server | Low |
| 4 | **Medium** | Step-up secret falls back to shared key | Low |
| 5 | **Medium** | No per-event auth on signal events | Medium |
| 6 | **Medium** | Username enumeration via friend request | Low |
| 7 | **Low** | Overly broad `img-src`/`connect-src` CSP | Low |
| 8 | **Low** | Suspicious logins not challenged | Medium |
| 9 | **Low** | 46 files with TypeScript `any` | High |
| 10 | **Low** | No webhook HMAC signing | Medium |
| 11 | **Info** | `dangerouslySetInnerHTML` (safe usage) | None |
| 12 | **Info** | No secret rotation runbook | Low |

---

## Recommended Priority

**Sprint 1 (immediate):**
- Fix #1 (TURN credentials) — active credential exposure
- Fix #4 (step-up secret) — one-line fix, high impact
- Fix #3 (reduce auth cache) — config change

**Sprint 2 (next cycle):**
- ~~Fix #2 (CSP hardening)~~ — remediated (nonce-based CSP in proxy.ts)
- Fix #5 (per-event auth) — architecture change
- Fix #6 (username enumeration) — response normalization

**Sprint 3 (backlog):**
- Fix #7–10 — defense-in-depth improvements
- Fix #12 — documentation

---

*Report generated by Security Engineer Agent — VortexChat full audit*
