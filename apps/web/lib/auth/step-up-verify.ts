/**
 * Credential re-verification behind `POST /api/auth/step-up`.
 *
 * The step-up gate in lib/auth/better-auth.ts blocks `/two-factor/disable` and
 * `/link-social` until the caller re-proves a credential. This module answers
 * the two questions that route needs: *which* factors can this account even be
 * challenged on, and does the submitted one check out.
 *
 * TOTP is not handled here — Better Auth's own `auth.api.verifyTOTP` already
 * verifies a code against the current session's user (its `verifyTwoFactor`
 * helper takes the session branch when one exists), and reimplementing the
 * decrypt-and-compare against `two_factors.secret` would fork the plugin's
 * encryption details for no gain.
 */
import bcrypt from "bcryptjs"
import { and, eq, isNotNull } from "drizzle-orm"
import { accounts, users, type VortexDb } from "@vortex/db"

/** Better Auth's `providerId` for the email+password credential row. */
const CREDENTIAL_PROVIDER = "credential"

export interface StepUpMethods {
  /** The account has a password set, so it can be challenged for one. */
  password: boolean
  /** The account has a verified TOTP enrollment. */
  totp: boolean
}

/**
 * Which factors this account can actually be re-challenged on.
 *
 * Both can legitimately be false: an account created through OAuth alone has
 * no `credential` row (so no password), and 2FA is opt-in. See the route for
 * how that case is resolved — it is a real state, not an error.
 */
export async function getStepUpMethods(db: VortexDb, userId: string): Promise<StepUpMethods> {
  const [credential] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, CREDENTIAL_PROVIDER),
        isNotNull(accounts.password),
      ),
    )
    .limit(1)

  const [user] = await db
    .select({ twoFactorEnabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  return {
    password: !!credential,
    // Only offer TOTP once enrollment is *confirmed*. `auth.api.verifyTOTP`
    // will happily finish a half-completed enrollment (it flips
    // `two_factors.verified` on first success), and a step-up prompt is the
    // wrong place to complete one.
    totp: !!user?.twoFactorEnabled,
  }
}

/**
 * Compare `password` against the account's stored hash.
 *
 * bcrypt rather than Better Auth's default scrypt, matching
 * `emailAndPassword.password.verify` in lib/auth/better-auth.ts — the same
 * hashes written at sign-up and imported by the Supabase migration.
 */
export async function verifyStepUpPassword(
  db: VortexDb,
  userId: string,
  password: string,
): Promise<boolean> {
  const [credential] = await db
    .select({ password: accounts.password })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, CREDENTIAL_PROVIDER),
        isNotNull(accounts.password),
      ),
    )
    .limit(1)

  if (!credential?.password) return false
  return bcrypt.compare(password, credential.password)
}
