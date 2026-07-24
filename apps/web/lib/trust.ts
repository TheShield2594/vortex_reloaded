/**
 * Issue #40 ("Group trust model") — server-side helpers shared by the
 * safety-number GET/verify routes. Kept separate from
 * apps/web/lib/safety-number.ts (which stays dependency-free/isomorphic) and
 * from olm-protocol.ts (which never runs server-side — see its top
 * comment): this module only ever reads public key material out of the DB,
 * it doesn't touch Olm itself.
 */
import { desc, eq } from "drizzle-orm"
import { createDb, olmDeviceIdentities } from "@vortex/db"
import { computeSafetyNumber, type SafetyNumberIdentity } from "@/lib/safety-number"

const db = createDb()

export type PrimaryIdentity = { deviceId: string; ed25519IdentityKey: string }

/**
 * A user may have several Olm devices; for the safety-number UI we treat
 * the most recently active one (highest `updated_at`, same ordering the
 * device-directory route already uses) as that user's "primary" identity
 * for comparison purposes. This is a simplification — a fully per-device
 * verification flow is out of scope here — documented rather than hidden.
 */
export async function getPrimaryIdentity(userId: string): Promise<PrimaryIdentity | null> {
  const [row] = await db
    .select({ deviceId: olmDeviceIdentities.deviceId, ed25519IdentityKey: olmDeviceIdentities.ed25519IdentityKey })
    .from(olmDeviceIdentities)
    .where(eq(olmDeviceIdentities.userId, userId))
    .orderBy(desc(olmDeviceIdentities.updatedAt))
    .limit(1)
  return row ?? null
}

export async function computePairSafetyNumber(
  a: { userId: string; ed25519IdentityKey: string },
  b: { userId: string; ed25519IdentityKey: string }
): Promise<string> {
  const idA: SafetyNumberIdentity = { userId: a.userId, ed25519Key: a.ed25519IdentityKey }
  const idB: SafetyNumberIdentity = { userId: b.userId, ed25519Key: b.ed25519IdentityKey }
  return computeSafetyNumber(idA, idB)
}
