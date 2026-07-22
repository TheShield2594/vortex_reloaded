import crypto from "node:crypto"
import { cookies } from "next/headers"

const STEP_UP_COOKIE = "vtx_step_up"
const STEP_UP_TTL_MS = 10 * 60 * 1000

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

export async function issueStepUpToken(userId: string) {
  const issuedAt = Date.now()
  const payload = `${userId}:${issuedAt}`
  const signature = sign(payload)
  const cookieStore = await cookies()
  cookieStore.set(STEP_UP_COOKIE, `${payload}:${signature}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(issuedAt + STEP_UP_TTL_MS),
    path: "/",
  })
}

export async function clearStepUpToken() {
  const cookieStore = await cookies()
  cookieStore.delete(STEP_UP_COOKIE)
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

export const STEP_UP_WINDOW_SECONDS = STEP_UP_TTL_MS / 1000
