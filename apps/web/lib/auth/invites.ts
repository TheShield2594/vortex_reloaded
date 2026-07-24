/**
 * Invite-gated registration (issue #3): "server-issued keys + a short
 * invite code or QR, like a mini Matrix" instead of open or
 * phone-number-verified signup. Any authenticated user can mint a code
 * (see app/api/invites/route.ts); redemption is enforced in
 * lib/auth/better-auth.ts's databaseHooks.user.create.before.
 */
import { and, eq, gt, isNull, or, sql } from "drizzle-orm"
import { registrationInvites, type VortexDb } from "@vortex/db"

// Avoid visually ambiguous characters (0/O, 1/I/L) — codes are meant to be
// typed by hand or read off a screen/QR scan fallback.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const CODE_LENGTH = 8

export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  let code = ""
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length]
  }
  return code
}

export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

export type InviteValidation =
  | { valid: true }
  | { valid: false; reason: "not_found" | "revoked" | "expired" | "exhausted" }

/** Read-only check — for pre-submit UX feedback. Never mutates use_count. */
export async function checkInviteCode(db: VortexDb, rawCode: string): Promise<InviteValidation> {
  const code = normalizeInviteCode(rawCode)
  if (!code) return { valid: false, reason: "not_found" }

  const rows = await db
    .select({
      revokedAt: registrationInvites.revokedAt,
      expiresAt: registrationInvites.expiresAt,
      maxUses: registrationInvites.maxUses,
      useCount: registrationInvites.useCount,
    })
    .from(registrationInvites)
    .where(eq(registrationInvites.code, code))
    .limit(1)
  const invite = rows[0]

  if (!invite) return { valid: false, reason: "not_found" }
  if (invite.revokedAt) return { valid: false, reason: "revoked" }
  if (invite.expiresAt && invite.expiresAt <= new Date().toISOString()) return { valid: false, reason: "expired" }
  if (invite.useCount >= invite.maxUses) return { valid: false, reason: "exhausted" }
  return { valid: true }
}

/**
 * Atomically reserves one use of an invite code via a single conditional
 * `use_count + 1` UPDATE — two simultaneous signups racing for the last use
 * of a code can never both succeed, since only one UPDATE's WHERE clause
 * still matches after the first commits.
 */
export async function consumeInviteCode(db: VortexDb, rawCode: string): Promise<boolean> {
  const code = normalizeInviteCode(rawCode)
  if (!code) return false

  const nowIso = new Date().toISOString()
  const updated = await db
    .update(registrationInvites)
    .set({ useCount: sql`${registrationInvites.useCount} + 1` })
    .where(
      and(
        eq(registrationInvites.code, code),
        isNull(registrationInvites.revokedAt),
        sql`${registrationInvites.useCount} < ${registrationInvites.maxUses}`,
        or(isNull(registrationInvites.expiresAt), gt(registrationInvites.expiresAt, nowIso))
      )
    )
    .returning({ id: registrationInvites.id })

  return updated.length > 0
}
