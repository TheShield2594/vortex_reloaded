import { cache } from "react"
import bcrypt from "bcryptjs"
import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm"
import { betterAuth, APIError } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { createAuthMiddleware } from "better-auth/api"
import { jwt, magicLink, twoFactor } from "better-auth/plugins"
import { nextCookies } from "better-auth/next-js"
import { passkey } from "@better-auth/passkey"
import * as vortexDb from "@vortex/db"
import { loginAttempts, loginRiskEvents, notifications, userConnections, users } from "@vortex/db"
import { computeLoginRisk } from "@/lib/auth/risk"
import { revokeGatewaySessions } from "@/lib/gateway-publish"
import { sendAuthEmail } from "@/lib/auth/email"
import { clearStepUpToken, hasValidStepUpToken } from "@/lib/auth/step-up"
import { consumeInviteCode } from "@/lib/auth/invites"
import { rateLimiter } from "@/lib/rate-limit"
import { createLogger } from "@/lib/logger"

const log = createLogger("better-auth")

const db = vortexDb.createDb()

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

function betterAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("BETTER_AUTH_SECRET must be set in production")
    }
    return "local-dev-better-auth-secret-do-not-use-in-prod"
  }
  return secret
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return "localhost"
  }
}

/** Only register a social provider once both its client id and secret are configured. */
function configuredSocialProviders() {
  const providers: Parameters<typeof betterAuth>[0]["socialProviders"] = {}

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }
  }
  if (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) {
    providers.twitch = {
      clientId: process.env.TWITCH_CLIENT_ID,
      clientSecret: process.env.TWITCH_CLIENT_SECRET,
    }
  }
  if (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET) {
    providers.reddit = {
      clientId: process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env.REDDIT_CLIENT_SECRET,
      duration: "permanent",
    }
  }
  return providers
}

const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000
const LOGIN_LOCKOUT_MAX_ATTEMPTS = 5

/**
 * Bootstrap escape hatch for the invite gate below: a brand-new deployment
 * has zero users, so nobody could possibly have generated an invite yet —
 * without this, invite-gated registration would permanently lock a fresh
 * server out of ever creating its first account. Only ever true for that
 * one moment; every account after the first requires a real invite.
 *
 * Two truly simultaneous first-ever sign-ups could both observe count === 0
 * and both bypass the gate (an unguarded read, not an atomic claim like
 * consumeInviteCode's UPDATE) — worst case a fresh, still-empty server ends
 * up with two founding accounts instead of one. Not worth a stronger guard
 * for a window that only exists before any real user has ever registered.
 */
async function isFirstEverAccount(): Promise<boolean> {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(users)
  return (row?.count ?? 0) === 0
}

/**
 * A best-effort pre-check ahead of consumeInviteCode below: without it, a
 * signup doomed by Better Auth's own email/username unique constraint still
 * burns a single-use invite code before that constraint ever gets a chance
 * to reject it. Not atomic with the insert that follows — two truly
 * simultaneous signups for the same email could both pass this check — but
 * that race is no worse than the pre-existing isFirstEverAccount bootstrap
 * escape hatch above, and the DB unique constraint still has final say over
 * whether the account actually gets created either way.
 */
async function isEmailOrUsernameTaken(email: string, username: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, email), eq(users.username, username)))
    .limit(1)
  return !!existing
}

/** Port of the old `is_login_locked_out` Postgres RPC — 5 failed attempts / 15 min, per email. */
async function isLoginLockedOut(email: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - LOGIN_LOCKOUT_WINDOW_MS).toISOString()
  const rows = await db
    .select({ id: loginAttempts.id })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gt(loginAttempts.attemptedAt, cutoff)))
    .limit(LOGIN_LOCKOUT_MAX_ATTEMPTS)
  return rows.length >= LOGIN_LOCKOUT_MAX_ATTEMPTS
}

async function recordFailedLoginAttempt(email: string, ipAddress: string | null): Promise<void> {
  try {
    await db.insert(loginAttempts).values({ email, ipAddress })
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "Failed to record login attempt")
  }
}

async function clearLoginAttempts(email: string): Promise<void> {
  try {
    await db.delete(loginAttempts).where(eq(loginAttempts.email, email))
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "Failed to clear login attempts")
  }
}

/**
 * Delete login-attempt rows older than the lockout window. Rows are only
 * cleared per-email on a *successful* login (`clearLoginAttempts`), so attempts
 * against emails that never succeed (credential-stuffing probes, abandoned
 * sign-ins) would otherwise accumulate forever. Anything older than the lockout
 * window is irrelevant to `isLoginLockedOut`, so it is safe to purge.
 *
 * Wired to the cron runner via `/api/cron/login-attempts-cleanup`. Returns the
 * number of rows removed.
 */
export async function pruneExpiredLoginAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - LOGIN_LOCKOUT_WINDOW_MS).toISOString()
  const rows = await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.attemptedAt, cutoff))
    .returning({ id: loginAttempts.id })
  return rows.length
}

/**
 * Extracts the client IP the same way the rest of the app's API routes do.
 * `hooks.before`/`databaseHooks` run inside the Better Auth request pipeline,
 * not a Next.js route handler, but `ctx.request` is still a standard
 * `Request` with the same forwarded-for headers.
 */
export function clientIpFromRequest(request: Request | undefined): string | null {
  if (!request) return null
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  )
}

/**
 * Risk-based login enforcement, ported from the old `/api/auth/login` route
 * (see lib/auth/risk.ts's `computeLoginRisk`). Runs in `session.create.before`
 * — by the time Better Auth is about to create a session, the `twoFactor`
 * plugin has already gated any 2FA-enrolled user through a TOTP/backup-code
 * challenge, so "user has 2FA enrolled" no longer needs handling here; this
 * only has to cover the case the old code called `challenge_mfa` for a user
 * *without* 2FA enrolled (soft-block, ask them to verify) and the
 * `lock_and_verify` hard-block for clearly-anomalous logins.
 */
async function enforceLoginRisk(userId: string, request: Request | undefined): Promise<void> {
  const ipAddress = clientIpFromRequest(request)
  const userAgent = request?.headers.get("user-agent") ?? null
  const locationHint =
    request?.headers.get("x-vercel-ip-country") || request?.headers.get("cf-ipcountry") || null

  const [prev] = await db
    .select({
      ipAddress: loginRiskEvents.ipAddress,
      userAgent: loginRiskEvents.userAgent,
      locationHint: loginRiskEvents.locationHint,
    })
    .from(loginRiskEvents)
    .where(and(eq(loginRiskEvents.userId, userId), eq(loginRiskEvents.succeeded, true)))
    .orderBy(desc(loginRiskEvents.createdAt))
    .limit(1)

  const risk = computeLoginRisk(
    { userId, ipAddress, userAgent, locationHint },
    prev ?? null
  )

  const [user] = await db.select({ email: users.email, twoFactorEnabled: users.twoFactorEnabled }).from(users).where(eq(users.id, userId)).limit(1)
  const email = user?.email ?? ""

  // A user already enrolled in 2FA has already proven possession of the
  // second factor by the time this hook runs — don't re-block them.
  const blocked =
    risk.action === "lock_and_verify" || (risk.action === "challenge_mfa" && !user?.twoFactorEnabled)

  try {
    await db.insert(loginRiskEvents).values({
      userId,
      email,
      ipAddress,
      userAgent,
      locationHint,
      riskScore: risk.riskScore,
      reasons: risk.reasons,
      suspicious: risk.suspicious,
      succeeded: !blocked,
    })

    if (risk.suspicious && !blocked) {
      await db.insert(notifications).values({
        userId,
        type: "system",
        title: "Suspicious login detected",
        body: `We noticed a login from a new device or location (${ipAddress || "unknown IP"}). If this wasn't you, reset your password immediately.`,
      })
    }
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err), userId }, "Failed to record login risk telemetry")
  }

  if (blocked) {
    throw new APIError("FORBIDDEN", {
      code: "risk_blocked",
      message: "Unusual login activity detected. Please reset your password to continue.",
    })
  }
}

/**
 * Authenticated Better Auth endpoints that invalidate one or more of the
 * *caller's* sessions. Each is wired to notify the signal server so the user's
 * live gateway socket(s) are torn down and their pre-existing handshake JWTs
 * rejected immediately, instead of lingering until the short-lived token
 * expires (issue #52). Revocation is per-user (the gateway JWT carries only the
 * user id) with an issued-at cutoff, so a device whose session survives — e.g.
 * the caller's own after a `revokeOtherSessions` password change — simply
 * reconnects with a fresh token.
 *
 * Password reset is deliberately NOT here: it's unauthenticated and resolving
 * the target user in this pre-handler hook would fire on tokens the reset
 * itself later rejects (e.g. expired-but-not-yet-purged rows), letting anyone
 * holding such a token disrupt the victim's gateway (CWE-367). It's handled
 * instead by `emailAndPassword.onPasswordReset`, which runs only after the
 * reset actually succeeds.
 */
const GATEWAY_REVOKE_PATHS = new Set([
  "/change-password",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/sign-out",
  "/delete-user",
])

/**
 * Endpoints gated behind a fresh re-authentication (`lib/auth/step-up.ts`),
 * the same way OAuth-identity linking and MFA disable were gated under
 * Supabase Auth — neither re-verifies the user's password or 2FA at call time
 * on its own. `POST /api/auth/step-up` is what mints the token; the `after`
 * hook below burns it, so one re-auth buys one gated mutation (issue #56).
 */
const STEP_UP_PATHS = new Set(["/two-factor/disable", "/link-social"])

export const auth = betterAuth({
  baseURL: APP_ORIGIN,
  secret: betterAuthSecret(),
  // usePlural isn't set — every model below has an explicit modelName instead,
  // since the `user` model maps onto the pre-existing `users` table (not a
  // fresh CLI-generated one) and needs a real field mapping, not just a
  // pluralization guess.
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: vortexDb,
    // better-sqlite3's own `.transaction()` rejects async callbacks outright
    // (see docs/data-migration-runbook.md's spike, issue #4) — Better Auth's
    // own multi-statement operations are sequenced without a wrapping
    // transaction as a result, same conclusion the migration scripts reached.
    transaction: false,
  }),
  user: {
    modelName: "users",
    fields: {
      name: "username",
      email: "email",
      emailVerified: "emailVerified",
      image: "avatarUrl",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
    additionalFields: {
      displayName: { type: "string", required: false, input: true },
    },
    changeEmail: { enabled: true },
  },
  session: {
    modelName: "sessions",
    expiresIn: 60 * 60 * 24 * 7, // 7 days — matches the old auth_sessions default
  },
  account: {
    modelName: "accounts",
    accountLinking: {
      enabled: true,
      // OAuth linking here is an authenticated, user-initiated "connect my
      // GitHub/Twitch/Reddit" action (see api/users/connections/oauth/*
      // previously, now authClient.linkSocial()) — the linked provider's
      // email routinely differs from the account's primary email, same as
      // Supabase's linkIdentity() had no such restriction.
      allowDifferentEmails: true,
    },
  },
  verification: { modelName: "verifications" },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
    password: {
      // Keep bcrypt for both migrated (see packages/db/src/migration/auth-secrets-export.ts)
      // and newly-created accounts, instead of Better Auth's default scrypt —
      // one algorithm for every account is simpler than branching per-user,
      // and bcrypt.compare() works unmodified against the migrated hashes.
      hash: (password) => bcrypt.hash(password, 12),
      verify: ({ hash, password }) => bcrypt.compare(password, hash),
    },
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Reset your Vortex password",
        text: `Reset your password: ${url}\n\nIf you didn't request this, you can safely ignore this email.`,
      })
    },
    // Fires only after a reset actually succeeds (valid, non-expired token +
    // password updated), so — unlike the pre-handler hook used for the
    // authenticated paths — an expired-but-unpurged token can't trigger a
    // spurious gateway teardown for the victim (issue #52, CWE-367). Paired
    // with `revokeSessionsOnPasswordReset` above so the DB sessions and the
    // live gateway sockets are both invalidated.
    onPasswordReset: async ({ user }) => {
      await revokeGatewaySessions(user.id)
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24, // 24h — matches the verify-email page's copy
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Verify your Vortex account",
        text: `Welcome to Vortex! Verify your email to activate your account: ${url}`,
      })
    },
  },
  socialProviders: configuredSocialProviders(),
  plugins: [
    twoFactor({
      issuer: "Vortex",
      twoFactorTable: "two_factors",
    }),
    magicLink({
      disableSignUp: true,
      sendMagicLink: async ({ email, url }) => {
        await sendAuthEmail({
          to: email,
          subject: "Your Vortex sign-in link",
          text: `Sign in to Vortex: ${url}\n\nIf you didn't request this, you can safely ignore this email.`,
        })
      },
    }),
    passkey({
      rpID: process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID || safeHostname(APP_ORIGIN),
      rpName: "Vortex",
      origin: APP_ORIGIN,
      schema: { passkey: { modelName: "passkeys" } },
    }),
    jwt({
      // apps/signal verifies handshake JWTs locally against this plugin's
      // public /api/auth/jwks endpoint (jose + JWKS caching) instead of the
      // old per-connection supabase.auth.getUser() round-trip — see
      // docs/better-auth-verification-spike.md §3 and apps/signal/src/index.ts.
      jwt: {
        issuer: APP_ORIGIN,
        audience: "vortex-signal",
        expirationTime: "15m",
        // `name` here is Better Auth's canonical field — mapped to the
        // `username` column via `user.fields.name` above, not a literal
        // display name.
        definePayload: ({ user }) => ({ username: user.name }),
      },
    }),
    // Must be last — lets server actions (not just route handlers) set
    // auth cookies via next/headers. Cheap to include even though today's
    // auth flows all go through the [...all] route handler.
    nextCookies(),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Tear down live gateway sessions whenever an endpoint invalidates the
      // caller's session(s) — password change, forced logout / session
      // revocation, account deletion (issue #52). Runs in `before` so the
      // acting user's session is still resolvable even for endpoints (sign-out,
      // revoke-sessions, delete-user) that are about to delete it. Best-effort
      // and never throws, so it can't block the auth operation; if the
      // operation ultimately fails, the caller's still-valid device just
      // reconnects with a fresh token. Falls through to the checks below.
      if (GATEWAY_REVOKE_PATHS.has(ctx.path)) {
        try {
          const headers = ctx.headers ?? ctx.request?.headers ?? new Headers()
          const session = await auth.api.getSession({ headers })
          if (session?.user?.id) await revokeGatewaySessions(session.user.id)
        } catch (err) {
          log.error(
            { err: err instanceof Error ? err.message : String(err), path: ctx.path },
            "Failed to revoke gateway sessions",
          )
        }
      }

      // Defense-in-depth: the app's own HMAC step-up cookie (lib/auth/step-up.ts)
      // gates sensitive account-mutation endpoints — see STEP_UP_PATHS above.
      if (STEP_UP_PATHS.has(ctx.path)) {
        const requestHeaders = ctx.headers ?? ctx.request?.headers ?? new Headers()
        const session = await auth.api.getSession({ headers: requestHeaders })
        if (session?.user && !(await hasValidStepUpToken(session.user.id))) {
          throw new APIError("FORBIDDEN", { message: "Step-up authentication required" })
        }
        return
      }

      if (ctx.path !== "/sign-in/email") return
      const email = typeof ctx.body?.email === "string" ? ctx.body.email.toLowerCase() : null
      if (!email) return

      const ipAddress = clientIpFromRequest(ctx.request)
      const rl = await rateLimiter.check(`login:${ipAddress ?? "unknown"}`, {
        limit: 20,
        windowMs: LOGIN_LOCKOUT_WINDOW_MS,
        failClosed: true,
      })
      if (!rl.allowed) {
        throw new APIError("TOO_MANY_REQUESTS", { message: "Too many login attempts. Please try again later." })
      }

      if (await isLoginLockedOut(email)) {
        throw new APIError("UNAUTHORIZED", { message: "Invalid credentials" })
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      // Make the step-up token single-use. Only on success: a rejected
      // `/link-social` (unconfigured provider, say) shouldn't cost the user
      // the re-auth they just performed. Best-effort — if the clear fails the
      // token simply expires on its own TTL, so it must not throw here and
      // undo the mutation that just succeeded.
      if (STEP_UP_PATHS.has(ctx.path) && !(ctx.context.returned instanceof Error)) {
        try {
          await clearStepUpToken()
        } catch (err) {
          log.error(
            { err: err instanceof Error ? err.message : String(err), path: ctx.path },
            "Failed to clear step-up token",
          )
        }
      }

      if (ctx.path !== "/sign-in/email") return
      const email = typeof ctx.body?.email === "string" ? ctx.body.email.toLowerCase() : null
      if (!email) return

      const failed = ctx.context.returned instanceof Error
      if (failed) {
        await recordFailedLoginAttempt(email, clientIpFromRequest(ctx.request))
      } else {
        await clearLoginAttempts(email)
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, context) => {
          await enforceLoginRisk(session.userId, context?.request)
        },
        after: async (session) => {
          try {
            await db.update(users).set({ status: "online" }).where(eq(users.id, session.userId))
          } catch (err) {
            log.error({ err: err instanceof Error ? err.message : String(err) }, "Failed to set user online after login")
          }
        },
      },
    },
    user: {
      create: {
        before: async (user, context) => {
          // Issue #3: registration is invite-gated, not open or
          // phone-number-verified — "server-issued keys + a short invite
          // code or QR, like a mini Matrix." This runs for every new
          // `users` row regardless of how it's created (email/password
          // sign-up, or a brand-new account via OAuth) — it does NOT run
          // for `linkSocial()` on an already-authenticated user, which
          // creates an `accounts` row, not a `users` row (see
          // databaseHooks.account.create.after below).
          if (!(await isFirstEverAccount())) {
            const email = typeof user.email === "string" ? user.email.toLowerCase() : ""
            const username = typeof user.name === "string" ? user.name : ""
            // Skip straight to Better Auth's own unique-constraint handling
            // (further down the pipeline, past this hook) for a signup that
            // was never going to succeed anyway — otherwise consumeInviteCode
            // below burns a single-use invite on a doomed duplicate signup.
            const alreadyExists = email && username && (await isEmailOrUsernameTaken(email, username))

            if (!alreadyExists) {
              const body = (context?.body ?? {}) as Record<string, unknown>
              const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : ""
              const consumed = await consumeInviteCode(db, inviteCode)
              if (!consumed) {
                throw new APIError("BAD_REQUEST", {
                  code: "invalid_invite_code",
                  message: "A valid invite code is required to create an account.",
                })
              }
            }
          }

          // Better Auth doesn't lowercase emails itself; normalize the way
          // the old login route (`email.toLowerCase()`) always did, so
          // lookups stay consistent. `createdAt`/`updatedAt` need no
          // handling here — `users.createdAt`/`updatedAt` use the `isoDate`
          // custom column type (schema/columns.ts) specifically so the
          // Date objects Better Auth constructs for these fields bind
          // correctly without this hook's help.
          if (typeof user.email === "string") {
            return { data: { ...user, email: user.email.toLowerCase() } }
          }
        },
      },
    },
    account: {
      create: {
        after: async (account) => {
          const SUPPORTED = ["github", "twitch", "reddit"] as const
          const provider = SUPPORTED.find((p) => p === account.providerId)
          if (!provider) return
          // Best-effort only: Better Auth's account-create hook doesn't
          // expose the OAuth provider's profile fields (username/avatar/
          // profile URL), only token/account-id data, so this can't
          // populate the same display fields the old Supabase-linkIdentity
          // flow did.
          try {
            await db
              .insert(userConnections)
              .values({
                userId: account.userId,
                provider,
                providerUserId: account.accountId,
                metadata: { linked_via: "better-auth" },
              })
              .onConflictDoUpdate({
                target: [userConnections.userId, userConnections.provider],
                set: { providerUserId: account.accountId, metadata: { linked_via: "better-auth" } },
              })
          } catch (err) {
            log.error({ err: err instanceof Error ? err.message : String(err), userId: account.userId, provider: account.providerId }, "Failed to sync user_connections after OAuth link")
          }
        },
      },
    },
  },
})

/**
 * Drop-in replacement for `supabase.auth.getUser()`'s return shape
 * (`{data: {user}, error}`), backed by Better Auth instead. Exists so the
 * ~30 API routes that called `supabase.auth.getUser()` directly (rather
 * than through `lib/utils/api-helpers.ts`'s `requireAuth()`) needed only
 * their auth *call* swapped, not their destructuring/error-handling — every
 * one of those routes only ever reads `user.id`, so this only bothers
 * shaping that field correctly.
 */
export async function getBetterAuthUser(): Promise<{
  data: { user: { id: string } | null }
  error: { message: string } | null
}> {
  try {
    const { headers } = await import("next/headers")
    const session = await auth.api.getSession({ headers: await headers() })
    return { data: { user: session?.user ? { id: session.user.id } : null }, error: null }
  } catch (err) {
    return { data: { user: null }, error: { message: err instanceof Error ? err.message : "Auth check failed" } }
  }
}

/** Per-request cached auth check — deduplicates the session lookup across nested layouts/pages within a single render. */
export const getAuthUser = cache(getBetterAuthUser)
