# Better Auth cutover (issue #8)

Implementation notes for the Supabase Auth → Better Auth cutover, following
up on the verification spike (`docs/better-auth-verification-spike.md`,
issue #5). Written in the same spirit as that doc: explicit about what was
verified, what was decided, and what's explicitly left out of scope.

## What changed

- **Credentials (email+password)** — Better Auth's `emailAndPassword`
  provider, configured with a custom `password.hash`/`verify` pair that uses
  bcrypt (via `bcryptjs`) for both migrated and newly-created accounts —
  see `apps/web/lib/auth/better-auth.ts`. Migrated bcrypt hashes
  (`packages/db/src/migration/auth-secrets-export.ts`) verify unmodified.
- **OAuth (GitHub/Twitch/Reddit)** — Better Auth's built-in `socialProviders`,
  wired as authenticated account-linking (`authClient.linkSocial()`, see
  `components/settings/security/connections-section.tsx`), matching how
  Supabase's `linkIdentity()` was used pre-cutover. A provider is only
  registered when both its client id and secret env vars are set.
- **MFA/passkeys** — the core `twoFactor` plugin (TOTP + backup codes) and
  the `@better-auth/passkey` plugin (real WebAuthn via `@simplewebauthn`,
  replacing the old hand-rolled, dev-only-verified `verifyWithAdapter()`
  stub in the now-deleted `lib/auth/passkeys.ts`).
- **`apps/signal`'s handshake validation** — re-pointed at the `jwt`
  plugin's JWKS endpoint (local verification via `jose`, no per-connection
  network round-trip once the key set is cached) instead of
  `supabase.auth.getUser()`. See `docs/better-auth-verification-spike.md`
  §3 for why this is the mechanism the spike recommended, and
  `apps/signal/src/index.ts`'s `validateSession`/`verifyAuthToken`.

## Schema decisions

Better Auth's `user` model is mapped onto the existing `users` table
(`user.fields` in `lib/auth/better-auth.ts`) rather than creating a second,
competing identity table — `users.id` stays the one identity root the rest
of the schema already FKs to. Three columns were added to support this:
`email`, `emailVerified`, `twoFactorEnabled` (see `schema/users.ts`'s module
comment for why they're nullable rather than `NOT NULL`).

Of the 8 hand-rolled MFA/passkey/session tables issue #6 authored
(`schema/auth.ts`), 5 are retired in favor of Better Auth's own:

| Old table | Replaced by |
|---|---|
| `auth_challenges` | `@better-auth/passkey`'s internal challenge storage |
| `auth_sessions` | `sessions` (Better Auth's own session model) |
| `auth_trusted_devices` | `twoFactor` plugin's own trusted-device cookie (stateless) |
| `passkey_credentials` | `passkeys` (real WebAuthn verification, not the old stub) |
| `recovery_codes` | `two_factors.backupCodes` |

`auth_security_policies`, `login_risk_events`, and `login_attempts` have no
Better Auth equivalent (passkey-first policy, login risk scoring) and
remain, wired into the Better Auth config via `hooks`/`databaseHooks`.

**Date columns**: Better Auth always constructs real `Date` objects for
`createdAt`/`updatedAt`/`expiresAt`-shaped fields; better-sqlite3 can't bind
those directly. New Better Auth-owned tables use plain
`integer({mode: "timestamp"})`. `users.createdAt`/`updatedAt` can't — that
column already carries migrated data as ISO-8601 TEXT — so it uses a new
`isoDate` custom Drizzle type (`schema/columns.ts`) instead: same on-disk
TEXT/ISO-8601 format, but accepts a `Date` object as input.

## Known gaps / deliberate simplifications

- **apps/web's non-auth routes are still on Supabase Postgres.** This PR
  only cuts over auth; the rest of the app (DMs, friends, notifications,
  etc.) still queries Supabase via `@supabase/supabase-js`, per the
  precedent already set by issues #6/#7 (schema + migration scripts landed
  without flipping the live query layer either). Concretely: a user who
  signs up via Better Auth today gets a `users` row in the *new* SQLite
  database, with no matching row in the *live* Postgres database the rest
  of the app still reads from — profile/DM/friend features won't work for
  them until the full data-migration runbook
  (`docs/data-migration-runbook.md`) actually runs against production. This
  is expected to happen as part of a larger, not-yet-scoped cutover event
  once every prerequisite ([#4](https://github.com/TheShield2594/vortex_reloaded/issues/4),
  [#6](https://github.com/TheShield2594/vortex_reloaded/issues/6),
  [#7](https://github.com/TheShield2594/vortex_reloaded/issues/7), this
  issue, and possibly [#9](https://github.com/TheShield2594/vortex_reloaded/issues/9)/[#10](https://github.com/TheShield2594/vortex_reloaded/issues/10))
  has landed — not something #8 alone can or should do.
- **Recovery codes can't be migrated.** Better Auth's backup-code encoding
  is internal/opaque; `packages/db/src/migration/import-auth-secrets.ts`
  carries over TOTP secrets but not the old plaintext-hashed recovery
  codes. Migrated 2FA users start with zero backup codes and should
  regenerate a set (Settings → Security → Recovery Codes) after their first
  post-migration sign-in.
- **Passkeys migrate; sessions and WebAuthn challenges don't.**
  `auth-secrets-export.ts` now also exports legacy `passkey_credentials`
  rows for `import-auth-secrets.ts` to load into the new `passkeys` table.
  `auth_sessions`/`auth_challenges` are intentionally not migrated — every
  user re-authenticates once after the cutover regardless, and challenges
  are single-use/short-TTL by design.
- **`user_connections` profile-display sync is best-effort.** The
  `databaseHooks.account.create.after` hook that keeps `user_connections`
  in sync after an OAuth link only has the provider + account id available
  (Better Auth's account-create hook doesn't expose the provider's profile
  payload) — unlike the old Supabase `linkIdentity()` flow, it can't fill
  in username/avatar/profile-url.
- **Security-policy-aware login UI is gone.** The old passkey login-options
  endpoint resolved `auth_security_policies` (passkey-first/enforce-passkey)
  *before* authentication, by email, to decide whether to show the
  password/magic-link fallback fields at all. Better Auth's passkey plugin
  doesn't have an equivalent unauthenticated-lookup endpoint; the login page
  now always shows both passkey and password/magic-link options, though
  the security policy itself is still readable/editable in Settings
  (`/api/auth/security/policy`, now backed by SQLite instead of Postgres).
- **No test coverage was ported.** `__tests__/auth-security-parity.test.ts`
  and `__tests__/passkeys-auth.test.ts` tested the now-deleted Supabase-
  based login/step-up route and the dev-only WebAuthn stub respectively;
  both were deleted rather than rewritten. New auth-flow test coverage is a
  follow-up.

## Deployment

- `BETTER_AUTH_SECRET` is required in production (throws on boot if unset,
  mirroring `STEP_UP_SECRET`'s existing pattern).
- SMTP config (`SMTP_HOST`/`PORT`/`USER`/`PASSWORD`, `EMAIL_FROM`) is new —
  Supabase Auth previously sent verification/reset/magic-link emails via
  its own managed SMTP; self-hosting Better Auth means the app now owns
  delivery (`lib/auth/email.ts`). Without it configured, auth still works
  end-to-end but emails are logged and skipped — fine for local dev, not
  for production.
- `apps/signal` needs three new env vars (`AUTH_JWKS_URL`, `AUTH_JWT_ISSUER`,
  `AUTH_JWT_AUDIENCE`) — see `apps/signal/.env.example`; wired into
  `docker-compose.yml`'s `signal` service already.
- Run `npm run migrate:run -- --auth-secrets` (from `packages/db`) for the
  real cutover; `migrate:dry-run` first, per the existing runbook. The
  pipeline now has 5 steps instead of 4: export → import → verify →
  auth-secrets export → auth-secrets import (new).
