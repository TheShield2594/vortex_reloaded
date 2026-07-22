# 16 — Security & Data Protection

> Covers: XSS prevention, CSRF, body size limits, input validation, GDPR export, health endpoint, proxy.ts enforcement, request sanitization, session security.

**Files under test:**
- `proxy.ts` — request interception, CSRF, email verification, body size limits
- `apps/web/app/api/health/route.ts`, `apps/web/app/api/health/readiness/route.ts`
- `apps/web/app/api/users/export/route.ts`
- `markdown-renderer.tsx` — XSS sanitization with `rehype-sanitize`
- `apps/web/app/api/sentry-tunnel/route.ts`

---

## 16.1 XSS Prevention

### `xss-prevention.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should strip `<script>` tags from messages | Send `<script>alert(1)</script>` | Script stripped; text rendered |
| 2 | should strip `<iframe>` tags | Send `<iframe src="evil">` | iframe stripped |
| 3 | should strip `onclick` attributes | Send `<div onclick="alert(1)">click</div>` | Attribute stripped |
| 4 | should strip `javascript:` URLs | Send `[link](javascript:alert(1))` | Link stripped or neutralized |
| 5 | should strip `<img onerror>` | Send `<img src=x onerror=alert(1)>` | onerror stripped |
| 6 | should allow vortex-* custom elements | Send `<vortex-embed>` | Element passes through |
| 7 | should allow Twemoji img elements | Send emoji | Twemoji `<img>` rendered |
| 8 | should use rehype-sanitize allowlist | Inspect sanitizer config | Only whitelisted elements/attributes |
| 9 | should prevent DOM clobbering | Send `<form id="document">` | Stripped |
| 10 | should sanitize user-generated profile fields | Set bio with `<script>` | Script stripped |

---

## 16.2 CSRF Protection

### `csrf-comprehensive.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should reject cross-origin POST to /api/* | POST with `Origin: https://evil.com` | 403 |
| 2 | should reject cross-origin PUT | PUT with wrong Origin | 403 |
| 3 | should reject cross-origin DELETE | DELETE with wrong Origin | 403 |
| 4 | should reject cross-origin PATCH | PATCH with wrong Origin | 403 |
| 5 | should allow same-origin requests | POST from app origin | Allowed |
| 6 | should bypass CSRF for token-only auth routes | Send request with `Authorization: Bearer` header (no cookie/session) | CSRF bypassed; bearer token validated |
| 7 | should NOT bypass CSRF for cookie/session auth routes | Send mutation with cookie auth but wrong Origin | 403 (CSRF enforced for session-based auth) |
| 7 | should check Referer when Origin missing | POST without Origin but with bad Referer | 403 |
| 8 | should allow GET without CSRF check | GET from anywhere | Allowed |

---

## 16.3 Body Size Limits

### `body-size-limits.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should reject JSON body > 1 MB | POST 1.1 MB JSON to `/api/messages` | 413 Payload Too Large |
| 2 | should reject upload body > 10 MB | POST 11 MB to upload route | 413 |
| 3 | should accept JSON body ≤ 1 MB | POST 500 KB JSON | 200/201 |
| 4 | should accept upload ≤ 10 MB | POST 5 MB file | 200/201 |

---

## 16.4 Input Validation

### `input-validation.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should cap search query at 500 chars | Send 501-char query to `/api/search` | 400 |
| 2 | should cap command args at 4000 chars | Send 4001-char command args | 400 |
| 3 | should validate login email format | Send malformed email to `/api/auth/login` | 400 |
| 4 | should validate login password length | Send empty password | 400 |
| 5 | should validate passkey registration fields | Send invalid field types | 400 |
| 6 | should validate invite code format | Send SQL injection as invite code | 400/404 |
| 7 | should validate server name input | Send empty/too-long name | 400 |
| 8 | should validate channel name input | Send invalid name | 400 |
| 9 | should validate emoji file type | Upload non-image to emoji endpoint | 400 |
| 10 | should validate role permission bitmask | Send non-numeric bitmask | 400 |

---

## 16.5 Health Endpoints

### `health-endpoints.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should return 200 when healthy | GET `/api/health` | 200 with Supabase latency |
| 2 | should return 503 when degraded | Mock Supabase failure | 503 |
| 3 | should return readiness status | GET `/api/health/readiness` | Readiness info |
| 4 | should include latency in response | Check response body | `latency` field present |

---

## 16.6 Proxy.ts Enforcement

### `proxy-enforcement.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should redirect unverified users to /verify-email | Request protected route as unverified | 302 → `/verify-email` |
| 2 | should allow verified users to proceed | Request as verified | Pass through |
| 3 | should allow public routes for unverified | Request `/terms` as unverified | Pass through |
| 4 | should enforce CSRF on mutation requests | POST without Origin | 403 |
| 5 | should enforce body size limits | Large POST | 413 |
| 6 | should not use middleware.ts (does not exist) | Grep codebase for `middleware.ts` imports | Zero results |

---

## 16.7 Session-Derived User ID

### `session-user-id.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should derive user ID from session, not request body | POST with fake userId in body | Server ignores body userId; uses session |
| 2 | should reject requests without valid session | Call protected endpoint without auth | 401 |
| 3 | should not trust client-supplied user ID | Tamper with userId in various endpoints | Session ID used |

---

## 16.8 Sensitive Data Protection

### `sensitive-data.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should not expose raw errors to client | Trigger server error | Structured `{ error: string }` response |
| 2 | should not include stack traces in responses | Trigger various errors | No stack traces |
| 3 | should not log passwords | Check log output after login | No password in logs |
| 4 | should not log tokens | Check log output | No tokens |
| 5 | should not return PII in error responses | Trigger error with user context | No PII leaked |
| 6 | should return correct HTTP status codes | Various error scenarios | 401, 403, 404, 400 as appropriate |
