# Spike: verifying Better Auth's claims before the cutover

Findings for [#5](https://github.com/TheShield2594/vortex_reloaded/issues/5), which
gates the Better Auth cutover implementation issue. The Auth.js → Better Auth
decision was made on Auth.js's confirmed gaps (maintenance mode, no MFA/passkey
roadmap), not on direct verification of Better Auth itself — every Better
Auth-specific claim in the migration plan was flagged unverified. This spike
checks each of those claims against Better Auth's own docs and source
(`better-auth@1.6.x`, current as of this writing), no code written yet.

## Summary

All four claims hold up, with one real architectural nuance on the Socket.IO
question:

1. **Drizzle adapter** — official, first-party, supports `sqlite`/`pg`/`mysql`
   as a single `provider` switch. Schema is CLI-generated
   (`npx @better-auth/cli generate`), not hand-authored.
2. **2FA (TOTP) and passkeys** — both genuinely built-in: TOTP secret
   generation/verification and backup codes ship in the core `twoFactor`
   plugin; passkeys are a separate `@better-auth/passkey` package (kept out of
   core to avoid bundling WebAuthn deps) built on `@simplewebauthn`. The app
   still has to build UI and (for 2FA) an OTP-delivery function — the crypto
   and schema are Better Auth's job, not hand-rolled.
3. **Socket.IO handshake validation** — Better Auth's *default* session is an
   opaque, database-backed token, same shape as Auth.js's database-session
   mode. The Auth.js trap was specifically that using a Credentials provider
   forces JWE (encrypted, shared-secret) sessions, which a plain Node process
   can't cheaply decrypt without importing Auth.js's own crypto and secret.
   Better Auth doesn't have that forced coupling: its opt-in **JWT plugin**
   issues standard asymmetric (RS256-family) JWTs verifiable via a public
   **JWKS** endpoint — no shared secret, no importing the auth library server
   in `apps/signal`. This is a strictly better position than the Auth.js trap,
   and arguably better than today's Supabase story too (see
   [below](#3-socketio-handshake-validation-in-appssignal)).
4. **OAuth providers** — GitHub, Twitch, and Reddit are all built-in
   first-party providers with their own docs pages, matching what's used
   today.

## 1. Drizzle adapter maturity and schema shape

Source: [`docs/adapters/drizzle.mdx`](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/adapters/drizzle.mdx), [`docs/concepts/database.mdx`](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/database.mdx).

- First-party adapter, configured with `drizzleAdapter(db, { provider: "sqlite" | "pg" | "mysql", schema })` —
  SQLite is a peer of Postgres/MySQL, not a second-class or unsupported path.
- Schema isn't hand-authored against a spec: the Better Auth CLI
  (`npx @better-auth/cli generate`) reads your `betterAuth()` config —
  including whichever plugins you've registered (2FA, passkey, etc.) — and
  emits the matching Drizzle schema file. Plugins each contribute their own
  tables/columns to this generated output, so enabling 2FA or passkeys later
  just means re-running `generate` and creating a new Drizzle migration, not
  hand-editing a schema by hand.
- Core tables (present regardless of plugins), per `concepts/database.mdx`:
  - `user`: `id`, `name`, `email` (unique), `emailVerified`, `image?`, `createdAt`, `updatedAt`
  - `session`: `id`, `userId` (FK), `token` (unique), `expiresAt`, `ipAddress?`, `userAgent?`, `createdAt`, `updatedAt`
  - `account`: `id`, `userId` (FK), `accountId`, `providerId`, `accessToken`, `refreshToken`, token expiry fields, `scope`, `idToken`, `password?`, `createdAt`, `updatedAt` — this is also where email/password credentials live (as a `providerId: "credential"` row), not a separate table
  - `verification`: `id`, `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt`
- Plugin-added tables confirmed for the two plugins this issue cares about:
  `twoFactor` (2FA: secret, backup codes, verification/lockout state) and
  `passkey` (credential ID, public key, counter, transports, `aaguid`) — see
  §2 below for full field lists.
- Maturity signal: `better-auth` is at v1.6.23 as of this writing, ~4M weekly
  npm downloads, ~28k GitHub stars, actively releasing. Not a niche or
  early-stage package.

**Relevant to #6** (schema authoring): the `generate` CLI output is the
starting point for the Drizzle schema, not something to write from scratch —
worth running it early in #6 against a config with `twoFactor` and the
passkey plugin already registered, then diffing its output against the
hand-rolled `direct_messages`/`channels`/etc. schema from the FTS5 spike (#4)
to catch any naming collisions before authoring migrations by hand.

## 2. 2FA (TOTP) and passkey: built-in vs. hand-rolled

Sources: [`docs/plugins/2fa.mdx`](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/2fa.mdx), [`docs/plugins/passkey.mdx`](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/passkey.mdx).

### TOTP (`twoFactor` plugin, in core `better-auth`)

Built-in, not hand-rolled:
- Secret generation, QR-code URI generation, and TOTP verification (accepting
  the current 30s window plus one window before/after for clock drift) are
  all handled by the plugin.
- Backup-code generation/validation is built in.
- Schema: adds `twoFactorEnabled` to `user`, plus a `twoFactor` table
  (`id`, `userId`, `secret`, `backupCodes`, verification/lockout state,
  `failedVerificationCount`).

What the app still has to build:
- All UI (QR display, code-entry forms, backup-code display).
- The `sendOTP` function if using email/SMS OTP instead of/alongside TOTP —
  Better Auth calls a hook you implement, it doesn't send anything itself.
- Note: `twoFactorEnabled` only flips to `true` after the user verifies a
  TOTP code post-enrollment — worth remembering when building the enrollment
  flow so an unverified enrollment doesn't look "on" to other parts of the app.
- Defaults to requiring a password-based (`credential`) account;
  `allowPasswordless: true` is needed if the app wants passwordless users to
  also be able to enroll in 2FA.

### Passkeys (separate `@better-auth/passkey` package)

Built-in, not hand-rolled, but shipped as a separate package specifically so
core `better-auth` doesn't bundle WebAuthn dependencies for apps that don't
use passkeys:
- Built on `@simplewebauthn/server` + `@simplewebauthn/browser` — the same
  library most of the Node ecosystem uses for WebAuthn, not a bespoke
  implementation.
- Handles registration/authentication ceremonies, credential storage, and
  counter-based clone detection.
- Schema: a `passkey` table (`id`, `name?`, `publicKey`, `userId`,
  `credentialID`, `counter`, `deviceType`, `backedUp`, `transports?`,
  `aaguid?`).
- Caveats worth carrying into #6/implementation: the bundled
  authenticator-name lookup table (keyed by `aaguid`) is "intentionally
  small and not authoritative" — plenty of real authenticators won't
  resolve to a friendly name — and privacy-preserving authenticators report
  an all-zero `aaguid` by design, so don't treat a missing/zero `aaguid` as
  an error state in the UI.

## 3. Socket.IO handshake validation in `apps/signal`

Sources: [`docs/concepts/session-management.mdx`](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/session-management.mdx), [`docs/plugins/jwt.mdx`](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/jwt.mdx), current `apps/signal/src/index.ts:581-624` (`validateSession`).

### Today's story (baseline)

`apps/signal` is a plain Node process — it validates a socket's handshake
token with `supabase.auth.getUser(authToken)`, an HTTP round-trip to
Supabase's auth server on cache miss, with a short-TTL in-memory cache
(`SESSION_REVALIDATION_TTL_MS`) plus an explicit revocation-list check that's
always consulted regardless of cache state. This works because Supabase
issues an opaque-to-the-app bearer token that Supabase's own service can
verify — `apps/signal` never needs Supabase's signing secret.

### Where the Auth.js trap came from

Auth.js's database-session mode is a plain opaque token — same shape as
Supabase's today. The regression risk was specifically that **Credentials
provider forces JWT/JWE-encrypted sessions** (Auth.js can't run
database-persisted sessions when a Credentials provider is registered), and
that encrypted-cookie format needs Auth.js's own decryption logic and secret
to open — not something a lightweight external Node service can do with a
plain JWT library.

### Better Auth's default: not the trap, but not free either

Better Auth's default session is the same opaque, database-backed token
(`session.token` in the table from §1) — there's no forced-JWE mode tied to
using email/password sign-in. A cookie-cache optimization exists
(`compact`/`jwt`/`jwe` cookie encodings) but that's for the *browser cookie*
skipping a DB hit on the main app server — it isn't documented as an external
verification mechanism, and `apps/signal` never sees that cookie anyway (it
gets a bearer token over the socket handshake, same as today). So by default,
`apps/signal` would need to either hit the main app's API (a
`getSession`-equivalent call) or share DB access — structurally identical to
today's Supabase REST round-trip.

### The actual improvement: the JWT plugin

Better Auth ships an opt-in **`jwt` plugin** built for exactly this case —
external services that need to verify a session without a database or a
shared secret:
- The main app registers the plugin and exposes `/api/auth/jwks` (public
  keys only).
- `getSession()` calls return a JWT in the `set-auth-jwt` response header (or
  the client can fetch one from `/api/auth/token`), asymmetrically signed.
- `apps/signal` fetches and caches the JWKS once (keys "rarely change") and
  verifies incoming JWTs **locally**, with a standard JWKS library (e.g.
  `jose`) — no shared secret, no importing Better Auth's server, no per-socket
  network call to the main app at all once JWKS is cached. That's actually a
  step better than today's Supabase call, which does a network round-trip to
  Supabase on every cache miss.
- Caveat to carry into the implementation issue: JWTs from this plugin
  default to a 15-minute expiry and **can't be revoked before they expire** —
  the plugin's own docs call it out as "not a replacement for the session."
  `apps/signal`'s existing design already assumes this shape (short-TTL
  revalidation cache + an always-checked revocation list independent of cache
  state), so the pattern carries over directly: keep the JWT TTL short,
  keep checking a revocation list (by session/user id, not by trusting the
  JWT alone) on every validation regardless of JWT validity, same as
  `isTokenRevoked` does today.

**Conclusion:** Better Auth avoids the specific Auth.js trap (no
Credentials-provider-forced encrypted sessions), and its JWT plugin gives
`apps/signal` a path that's stateless and secret-free, unlike either the
Auth.js trap or today's Supabase REST-call model. It requires deliberately
enabling and wiring the JWT plugin — it is not the library's default — and
the implementation issue should keep the revocation-list check independent
of JWT validity, exactly as `apps/signal` already does.

## 4. OAuth provider support

Sources: [`docs/authentication/github.mdx`](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/github.mdx), [`docs/authentication/twitch.mdx`](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/twitch.mdx), [`docs/authentication/reddit.mdx`](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/reddit.mdx).

All three used by the app today are built-in, first-party `socialProviders`
entries, each with its own docs page (not community plugins, not the generic
OAuth plugin):

- **GitHub** — requires the `user:email` scope; if a user's primary email is
  private, GitHub's API returns `email: null` and sign-in fails with
  `email_not_found` unless a fallback is configured. GitHub also never issues
  refresh tokens (access tokens are effectively long-lived instead).
- **Twitch** — documented limitation: users without an email on their Twitch
  account cannot sign in through this provider at all (Twitch email is a hard
  requirement, not just a scope to request).
- **Reddit** — standard OAuth setup registered as a "web app" in Reddit's
  developer console; supports the usual scopes (`identity`, `read`, etc.)
  plus an optional `duration: "permanent"` for longer-lived tokens.

Better Auth documents 40+ built-in providers total, so provider count/breadth
isn't a gap — the per-provider quirks above (GitHub private-email handling,
Twitch's hard email requirement) are the things worth handling explicitly in
the cutover implementation, since they're easy to miss until a real user hits
them.

## What this unblocks

All four checklist items in #5 are confirmed against Better Auth's own docs
and source, not just inferred from Auth.js's gaps. The Better Auth cutover
implementation issue can proceed with:
- Drizzle schema authored via the CLI `generate` output as a starting point
  (tie-in with #6's schema work).
- `twoFactor` (core) and `@better-auth/passkey` plugins for MFA — UI and OTP
  delivery are the app's responsibility, the crypto and schema are not.
- The `jwt` plugin, not the default session cookie, as the mechanism
  `apps/signal` uses to validate Socket.IO handshakes — with a short JWT TTL
  and a revocation-list check kept independent of JWT validity, mirroring
  `apps/signal`'s current design.
- GitHub/Twitch/Reddit as built-in providers, with explicit handling for
  GitHub's private-email case and Twitch's mandatory-email requirement.
