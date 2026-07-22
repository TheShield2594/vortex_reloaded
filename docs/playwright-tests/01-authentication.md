# 01 — Authentication & Account Security

> Covers: login, register, email verification, MFA/2FA, passkeys, password reset, session management, recovery codes, step-up auth, CSRF protection.

**Routes under test:**
- `(auth)/login/page.tsx`, `(auth)/register/page.tsx`, `verify-email/page.tsx`, `update-password/page.tsx`
- API: `/api/auth/login`, `/api/auth/password`, `/api/auth/mfa-challenge`, `/api/auth/mfa/disable`
- API: `/api/auth/passkeys/*`, `/api/auth/recovery-codes/*`, `/api/auth/step-up`
- API: `/api/auth/sessions`, `/api/auth/sessions/[sessionId]`
- API: `/api/auth/security/policy`, `/api/auth/account`
- `proxy.ts` — email verification enforcement, CSRF checks

---

## 1.1 Registration

### `register-happy-path.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should register with valid email, username, password | Fill form → submit | Redirect to `/verify-email`; user row created in DB |
| 2 | should show validation errors for empty fields | Submit empty form | Inline errors on all required fields |
| 3 | should reject duplicate email | Register with existing email | Error: "Email already registered" |
| 4 | should reject duplicate username | Register with taken username | Error: "Username already taken" |
| 5 | should enforce password strength | Enter "123" | Error about minimum length/complexity |
| 6 | should enforce email format | Enter "notanemail" | Inline validation error |
| 7 | should link to Terms of Service | Click ToS link | Navigates to `/terms` |
| 8 | should link to Privacy Policy | Click privacy link | Navigates to `/privacy` |
| 9 | should trim whitespace from email | Enter " user@test.com " | Registers successfully with trimmed email |
| 10 | should sanitize username input | Enter username with special chars | Appropriate rejection or sanitization |

### `register-edge-cases.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should handle network failure gracefully | Intercept `/api/auth/register` → 500 | Error toast; form remains filled |
| 2 | should prevent double submission | Click submit rapidly twice | Only one request sent |
| 3 | should handle very long email (255 chars) | Enter max-length email | Either accepts or shows length error |
| 4 | should handle unicode username | Enter emoji/CJK username | Appropriate handling per validation rules |
| 5 | should not leak existing user info via timing | Compare response times for existing vs new email | Similar response times |

---

## 1.2 Login

### `login-email-password.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should login with valid credentials | Enter email + password → submit | Redirect to `/channels`; session cookie set |
| 2 | should show error for wrong password | Enter valid email + wrong password | "Invalid credentials" error |
| 3 | should show error for non-existent email | Enter unknown email | "Invalid credentials" (no user enumeration) |
| 4 | should redirect unverified user to /verify-email | Login with unverified account | Redirect to `/verify-email`; response includes `emailUnverified` |
| 5 | should persist session across page reload | Login → reload page | Still authenticated |
| 6 | should redirect to intended page after login | Visit protected route → login | Redirect back to original route |
| 7 | should handle login form keyboard submission | Fill fields → press Enter | Form submits |
| 8 | should show/hide password toggle | Click eye icon | Password visibility toggles |

### `login-mfa.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should prompt for MFA after correct password | Login with MFA-enabled account | MFA challenge screen shown |
| 2 | should accept valid TOTP code | Enter correct 6-digit code | Login completes |
| 3 | should reject invalid TOTP code | Enter wrong code | Error message; remains on MFA screen |
| 4 | should reject expired TOTP code | Wait > 30s, enter old code | Error message |
| 5 | should allow recovery code as MFA fallback | Click "Use recovery code" → enter valid code | Login completes; recovery code consumed |
| 6 | should reject already-used recovery code | Enter previously used recovery code | Error |

### `login-passkeys.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show passkey login option | Navigate to login | "Sign in with passkey" button visible |
| 2 | should initiate WebAuthn ceremony | Click passkey login | Browser credential prompt triggered |
| 3 | should complete login with valid passkey | Mock WebAuthn → success | Redirect to `/channels` |
| 4 | should handle passkey cancellation | Cancel WebAuthn prompt | Returns to login form; no error |
| 5 | should handle passkey not found | Mock WebAuthn → not found | Appropriate error message |

---

## 1.3 Email Verification

### `email-verification.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show verification required page | Navigate to `/verify-email` as unverified | Instructions displayed |
| 2 | should have resend verification button | View page | "Resend" button visible and enabled |
| 3 | should rate-limit resend clicks | Click resend 5 times rapidly | Button disabled after first click; cooldown shown |
| 4 | should block access to app routes when unverified | Try to navigate to `/channels` | `proxy.ts` redirects to `/verify-email` |
| 5 | should allow access after verification | Verify email → navigate to `/channels` | Access granted |
| 6 | should allow access to public routes when unverified | Navigate to `/terms`, `/privacy` | Pages load normally |

---

## 1.4 Password Management

### `password-change.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should change password with valid current password | Settings → Security → Change password | Success message; old password no longer works |
| 2 | should reject wrong current password | Enter incorrect current password | Error |
| 3 | should enforce new password strength | Enter weak new password | Validation error |
| 4 | should reject new password same as current | Enter same password | Error |
| 5 | should update password via `/update-password` page | Use password reset link → enter new password | Password updated; redirect to login |

---

## 1.5 Session Management

### `session-management.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should list active sessions | Settings → Security → Sessions | Current session + others listed |
| 2 | should show current session indicator | View sessions | Current session marked as "Current" |
| 3 | should revoke a specific session | Click revoke on another session | Session removed from list |
| 4 | should not allow revoking current session | Try to revoke current | Button disabled or confirmation required |
| 5 | should show session metadata | View session list | Device, browser, last active, IP info shown |

---

## 1.6 Two-Factor Authentication Setup

### `two-factor-setup.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show QR code for TOTP setup | Settings → Security → Enable 2FA | QR code + manual key displayed |
| 2 | should verify TOTP code to complete setup | Scan QR → enter code → confirm | 2FA enabled; recovery codes shown |
| 3 | should display recovery codes after setup | Complete 2FA setup | Recovery codes displayed; download option |
| 4 | should require step-up auth to enable 2FA | Click enable 2FA | Password re-confirmation required |
| 5 | should disable 2FA with valid password | Settings → Disable 2FA → enter password | 2FA disabled |
| 6 | should regenerate recovery codes | Click regenerate | New codes shown; old codes invalidated |

---

## 1.7 Passkey Management

### `passkey-management.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should register a new passkey | Settings → Security → Add passkey | WebAuthn ceremony → passkey saved |
| 2 | should list registered passkeys | View passkey section | Passkeys listed with names and dates |
| 3 | should rename a passkey | Click rename → enter new name | Name updated |
| 4 | should delete a passkey | Click delete → confirm | Passkey removed |
| 5 | should require step-up auth for passkey operations | Try to add/delete passkey | Password re-confirmation required |
| 6 | should validate registration fields | Submit with invalid data | Type + length validation errors |

---

## 1.8 CSRF Protection

### `csrf-protection.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should reject POST without valid Origin header | Send POST to `/api/auth/login` with wrong Origin | 403 Forbidden |
| 2 | should reject PUT without valid Referer | Send PUT to `/api/users/profile` with wrong Referer | 403 Forbidden |
| 3 | should allow GET requests without CSRF check | Send GET to `/api/health` | 200 OK |
| 4 | should allow requests with valid Origin | Normal login from app | 200 OK |
| 5 | should passthrough bearer token routes | Send request with Authorization header | CSRF check bypassed |

---

## 1.9 Security Policy

### `security-policy.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should display current security policy | Settings → Security → Policy | Policy settings shown |
| 2 | should update security policy | Change settings → save | Policy updated |
| 3 | should enforce body size limits | POST oversized JSON to `/api/*` | 413 Payload Too Large |
| 4 | should enforce upload size limits (10 MB) | Upload > 10 MB file | 413 Payload Too Large |
| 5 | should cap search query length at 500 chars | Send 501-char search query | 400 Bad Request |

---

## 1.10 Account Deletion / Export

### `account-management.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should export user data (GDPR) | Settings → Security → Export Data | JSON file downloads with profile, messages, DMs, friends, servers, reactions |
| 2 | should include all required data categories | Download export → inspect JSON | All categories present |
| 3 | should not include other users' data | Inspect export | Only requesting user's data |
| 4 | should require authentication for export | Call `/api/users/export` without auth | 401 |
