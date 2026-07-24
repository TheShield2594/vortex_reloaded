/**
 * Shared E2E test utilities.
 */

/**
 * True when a seeded test account is available for authenticated flows.
 *
 * The app runs on SQLite + Better Auth, so the database itself is always
 * present in CI (a fresh file is migrated before the suite). What the
 * authenticated tests actually need is a known account to sign in with,
 * supplied via E2E_TEST_EMAIL / E2E_TEST_PASSWORD.
 */
export const hasSeededAccount = Boolean(
  process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD
)
