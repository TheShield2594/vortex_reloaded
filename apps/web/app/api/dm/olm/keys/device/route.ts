import { NextRequest, NextResponse } from "next/server"
import { and, eq, sql } from "drizzle-orm"
import { createDb, olmDeviceIdentities, olmOneTimeKeys } from "@vortex/db"
import { requireAuth, parseJsonBody, checkRateLimit } from "@/lib/utils/api-helpers"
import { createLogger } from "@/lib/logger"
import {
  isValidDeviceId,
  isValidOlmPublicKey,
  isValidOlmSignature,
  isValidOlmKeyId,
  validateOneTimeKeyEntry,
} from "@/lib/olm-key-validation"

const log = createLogger("api/dm/olm/keys/device")
const db = createDb()

// Matches PER_USER_DEVICE_LIMIT elsewhere (legacy-ecdh's user_device_keys cap)
const DEVICE_LIMIT = 20
// Each POST may publish at most this many one-time keys in one call
const MAX_ONE_TIME_KEYS_PER_REQUEST = 100
// Server keeps at most this many unclaimed one-time keys per device; oldest are pruned
const MAX_STORED_ONE_TIME_KEYS = 200

type RegisterBody = {
  deviceId?: unknown
  curve25519IdentityKey?: unknown
  ed25519IdentityKey?: unknown
  fallbackKeyId?: unknown
  fallbackPublicKey?: unknown
  fallbackSignature?: unknown
  oneTimeKeys?: unknown
}

function validateBody(body: RegisterBody) {
  if (!isValidDeviceId(body.deviceId)) return "Invalid deviceId"
  if (!isValidOlmPublicKey(body.curve25519IdentityKey)) return "Invalid curve25519IdentityKey"
  if (!isValidOlmPublicKey(body.ed25519IdentityKey)) return "Invalid ed25519IdentityKey"
  if (!isValidOlmKeyId(body.fallbackKeyId)) return "Invalid fallbackKeyId"
  if (!isValidOlmPublicKey(body.fallbackPublicKey)) return "Invalid fallbackPublicKey"
  if (!isValidOlmSignature(body.fallbackSignature)) return "Invalid fallbackSignature"
  if (!Array.isArray(body.oneTimeKeys) || body.oneTimeKeys.length === 0) return "oneTimeKeys[] required"
  if (body.oneTimeKeys.length > MAX_ONE_TIME_KEYS_PER_REQUEST) return "Too many oneTimeKeys"
  for (const entry of body.oneTimeKeys) {
    if (!validateOneTimeKeyEntry(entry)) return "Invalid oneTimeKeys entry"
  }
  return null
}

// POST /api/dm/olm/keys/device — publish (or top up) this device's Olm identity
export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const limited = await checkRateLimit(user.id, "olm:register-device", { limit: 10, windowMs: 60_000 })
    if (limited) return limited

    const { data: body, error: parseError } = await parseJsonBody<RegisterBody>(req)
    if (parseError) return parseError

    const validationError = validateBody(body)
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

    const deviceId = body.deviceId as string
    const curve25519IdentityKey = body.curve25519IdentityKey as string
    const ed25519IdentityKey = body.ed25519IdentityKey as string
    const fallbackKeyId = body.fallbackKeyId as string
    const fallbackPublicKey = body.fallbackPublicKey as string
    const fallbackSignature = body.fallbackSignature as string
    const oneTimeKeys = (body.oneTimeKeys as unknown[])
      .map(validateOneTimeKeyEntry)
      .filter((k): k is NonNullable<typeof k> => k !== null)

    try {
      db.transaction((tx) => {
        const existing = tx
          .select({
            curve25519IdentityKey: olmDeviceIdentities.curve25519IdentityKey,
            ed25519IdentityKey: olmDeviceIdentities.ed25519IdentityKey,
          })
          .from(olmDeviceIdentities)
          .where(and(eq(olmDeviceIdentities.userId, user.id), eq(olmDeviceIdentities.deviceId, deviceId)))
          .get()

        // An Olm account's identity keypair is generated once and never
        // changes for the lifetime of that device — a mismatch here means
        // the caller's local state doesn't match what's already published
        // (e.g. IndexedDB was cleared but the deviceId in localStorage
        // survived). Refuse to silently overwrite a previously-trusted
        // identity key under the same deviceId.
        if (
          existing
          && (existing.curve25519IdentityKey !== curve25519IdentityKey || existing.ed25519IdentityKey !== ed25519IdentityKey)
        ) {
          throw new Error("identity_key_mismatch")
        }

        if (!existing) {
          const deviceCount = tx
            .select({ count: sql<number>`count(*)` })
            .from(olmDeviceIdentities)
            .where(eq(olmDeviceIdentities.userId, user.id))
            .get()
          if ((deviceCount?.count ?? 0) >= DEVICE_LIMIT) {
            throw new Error("device_limit_reached")
          }
        }

        const nowIso = new Date().toISOString()
        tx.insert(olmDeviceIdentities)
          .values({
            userId: user.id,
            deviceId,
            curve25519IdentityKey,
            ed25519IdentityKey,
            fallbackKeyId,
            fallbackPublicKey,
            fallbackSignature,
            updatedAt: nowIso,
          })
          .onConflictDoUpdate({
            target: [olmDeviceIdentities.userId, olmDeviceIdentities.deviceId],
            set: { fallbackKeyId, fallbackPublicKey, fallbackSignature, updatedAt: nowIso },
          })
          .run()

        for (const key of oneTimeKeys) {
          tx.insert(olmOneTimeKeys)
            .values({ userId: user.id, deviceId, keyId: key.keyId, publicKey: key.publicKey, signature: key.signature })
            .onConflictDoNothing()
            .run()
        }

        // Prune down to MAX_STORED_ONE_TIME_KEYS per device, oldest first —
        // caps storage if a client re-uploads without the server ever
        // claiming keys (e.g. a low-traffic device).
        const excess = tx
          .select({ count: sql<number>`count(*)` })
          .from(olmOneTimeKeys)
          .where(and(eq(olmOneTimeKeys.userId, user.id), eq(olmOneTimeKeys.deviceId, deviceId)))
          .get()
        const overflow = (excess?.count ?? 0) - MAX_STORED_ONE_TIME_KEYS
        if (overflow > 0) {
          const staleIds = tx
            .select({ keyId: olmOneTimeKeys.keyId })
            .from(olmOneTimeKeys)
            .where(and(eq(olmOneTimeKeys.userId, user.id), eq(olmOneTimeKeys.deviceId, deviceId)))
            .orderBy(olmOneTimeKeys.createdAt)
            .limit(overflow)
            .all()
          for (const row of staleIds) {
            tx.delete(olmOneTimeKeys)
              .where(
                and(
                  eq(olmOneTimeKeys.userId, user.id),
                  eq(olmOneTimeKeys.deviceId, deviceId),
                  eq(olmOneTimeKeys.keyId, row.keyId)
                )
              )
              .run()
          }
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("identity_key_mismatch")) {
        return NextResponse.json(
          { error: "Device already registered with a different identity key" },
          { status: 409 }
        )
      }
      if (message.includes("device_limit_reached")) {
        return NextResponse.json({ error: `Device limit reached (${DEVICE_LIMIT})` }, { status: 409 })
      }
      log.error({ route: "/api/dm/olm/keys/device", action: "POST", userId: user.id, error: message }, "failed to register device")
      return NextResponse.json({ error: "Failed to register device key" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    log.error({ route: "/api/dm/olm/keys/device", action: "POST", error: message }, "POST error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
