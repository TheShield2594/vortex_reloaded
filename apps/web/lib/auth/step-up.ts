import crypto from "node:crypto"
import { cookies } from "next/headers"

const STEP_UP_COOKIE = "vtx_step_up"

/**
 * How long a freshly-issued step-up token stays valid. Exported so the
 * `/api/auth/step-up` route can tell the client how long its re-auth is good
 * for without the number being duplicated (and drifting) on both sides.
 */
export const STEP_UP_TTL_MS = 10 * 60 * 1000

/**
 * Shared attributes for both writes below. `clearStepUpToken` has to repeat
 * `path`/`sameSite`/`secure` exactly or the browser treats the expiry write as
 * a *different* cookie and leaves the live one in place.
 */
function stepUpCookieAttributes() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  } as const
}

/**
 * Returns the ordered list of step-up signing secrets.
 * The first entry is the "current" key used for new signatures.
 * Previous keys (via STEP_UP_SECRET_PREV) are accepted for verification
 * to allow zero-downtime key rotation.
 *
 * Rotation procedure:
 *   1. Set STEP_UP_SECRET_PREV = <current STEP_UP_SECRET value>
 *   2. Set STEP_UP_SECRET = <new random value>
 *   3. Deploy — new tokens signed with new key, old tokens still verify
 *   4. After STEP_UP_TTL_MS (10 min), remove STEP_UP_SECRET_PREV
 */
function stepUpSecrets(): string[] {
  const current = process.env.STEP_UP_SECRET
  if (!current) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("STEP_UP_SECRET must be set in production — do not reuse NEXTAUTH_SECRET")
    }
    return ["local-step-up-secret"]
  }
  const prev = process.env.STEP_UP_SECRET_PREV
  return prev ? [current, prev] : [current]
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", stepUpSecrets()[0]).update(payload).digest("hex")
}

function verifySignature(payload: string, signature: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false
  for (const secret of stepUpSecrets()) {
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex")
    if (crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
      return true
    }
  }
  return false
}

/**
 * Mint the step-up cookie for `userId`. Called by `POST /api/auth/step-up`
 * once the caller has re-proven a credential (password or TOTP); nothing else
 * should issue one, since the gate in lib/auth/better-auth.ts treats its mere
 * presence as "this user re-authenticated in the last {@link STEP_UP_TTL_MS}".
 */
export async function issueStepUpToken(userId: string) {
  const issuedAt = Date.now()
  const payload = `${userId}:${issuedAt}`
  const signature = sign(payload)
  const cookieStore = await cookies()
  cookieStore.set(STEP_UP_COOKIE, `${payload}:${signature}`, {
    ...stepUpCookieAttributes(),
    expires: new Date(issuedAt + STEP_UP_TTL_MS),
  })
}

/**
 * Burn the step-up cookie. Wired to the `after` hook in lib/auth/better-auth.ts
 * so re-authenticating normally buys one gated mutation rather than a
 * 10-minute window in which every subsequent one rides for free.
 *
 * Single-use is **best-effort, against sequential reuse only.** The gate reads
 * the cookie in `before` and clears it here in `after`, which is not atomic: two
 * concurrent gated requests both carry the cookie in their own request headers,
 * so both pass the check before either response can clear it, and one re-auth
 * covers both. Cookies have no compare-and-swap, so closing that window would
 * mean holding step-up state server-side (a consumed-nonce store) — deliberately
 * out of scope here. The exposure is small: an attacker in a position to exploit
 * it already holds a valid token, meaning they already produced the password or
 * TOTP, and could simply re-authenticate again for the second mutation.
 *
 * Deliberately never throws — a failed clear degrades to the token simply
 * living out its TTL, which is strictly no worse than not having this at all,
 * and must not be allowed to fail the auth operation that just succeeded.
 */
export async function clearStepUpToken(): Promise<void> {
  try {
    const cookieStore = await cookies()
    cookieStore.set(STEP_UP_COOKIE, "", {
      ...stepUpCookieAttributes(),
      expires: new Date(0),
    })
  } catch {
    // Swallowed so the guarantee above holds for every caller, not just the
    // one that happens to wrap the call itself.
  }
}

export async function hasValidStepUpToken(userId: string): Promise<boolean> {
  try {
    const cookieStore = await cookies()
    const raw = cookieStore.get(STEP_UP_COOKIE)?.value
    if (!raw) return false

    const [cookieUserId, issuedAtRaw, signature] = raw.split(":")
    if (!cookieUserId || !issuedAtRaw || !signature) return false
    if (cookieUserId !== userId) return false

    const payload = `${cookieUserId}:${issuedAtRaw}`
    if (!verifySignature(payload, signature)) return false

    const issuedAt = Number(issuedAtRaw)
    if (!Number.isFinite(issuedAt)) return false
    return Date.now() - issuedAt <= STEP_UP_TTL_MS
  } catch (err) {
    // Crypto/parsing failure — treat as invalid token, never expose error details
    const { createLogger } = await import("@/lib/logger")
    createLogger("step-up").warn({ userId, err: err instanceof Error ? err.message : "unknown" }, "Step-up token validation failed")
    return false
  }
}
