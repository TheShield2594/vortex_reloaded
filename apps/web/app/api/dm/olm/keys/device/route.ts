import { NextRequest, NextResponse } from "next/server"
import { and, eq, isNull, sql } from "drizzle-orm"
import { createDb, olmDeviceIdentities, olmOneTimeKeys } from "@vortex/db"
import { requireAuth, parseJsonBody, checkRateLimit } from "@/lib/utils/api-helpers"
import { createLogger } from "@/lib/logger"
import {
  isValidDeviceId,
  isValidOlmPublicKey,
  isValidOlmSignature,
  isValidOlmKeyId,
  validateOneTimeKeyEntry,
  verifyOneTimeKeySignature,
} from "@/lib/olm-key-validation"

const log = createLogger("api/dm/olm/keys/device")
const db = createDb()

// Cap on the number of Olm device identities a single user may register.
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

// A request that omits the identity/fallback material is a one-time-key
// top-up for an already-registered device (see topUpOneTimeKeys on the
// client) — its identity was fixed at first registration and never rotates,
// so re-sending it every top-up is both unnecessary and a chance to trip the
// identity-mismatch guard after a partial local reset. Detect top-up mode by
// the absence of the identity key and validate only what it carries.
function isTopUpBody(body: RegisterBody) {
  return body.curve25519IdentityKey === undefined && body.ed25519IdentityKey === undefined
}

function validateOneTimeKeys(body: RegisterBody) {
  if (!Array.isArray(body.oneTimeKeys) || body.oneTimeKeys.length === 0) return "oneTimeKeys[] required"
  if (body.oneTimeKeys.length > MAX_ONE_TIME_KEYS_PER_REQUEST) return "Too many oneTimeKeys"
  for (const entry of body.oneTimeKeys) {
    if (!validateOneTimeKeyEntry(entry)) return "Invalid oneTimeKeys entry"
  }
  return null
}

function validateBody(body: RegisterBody) {
  if (!isValidDeviceId(body.deviceId)) return "Invalid deviceId"
  if (isTopUpBody(body)) return validateOneTimeKeys(body)
  if (!isValidOlmPublicKey(body.curve25519IdentityKey)) return "Invalid curve25519IdentityKey"
  if (!isValidOlmPublicKey(body.ed25519IdentityKey)) return "Invalid ed25519IdentityKey"
  if (!isValidOlmKeyId(body.fallbackKeyId)) return "Invalid fallbackKeyId"
  if (!isValidOlmPublicKey(body.fallbackPublicKey)) return "Invalid fallbackPublicKey"
  if (!isValidOlmSignature(body.fallbackSignature)) return "Invalid fallbackSignature"
  return validateOneTimeKeys(body)
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
    const topUp = isTopUpBody(body)
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

        if (topUp) {
          // Top-up requests only add one-time keys; there's nothing to
          // register a fresh identity from, so an unknown device is a
          // client bug (topped up before ever publishing) rather than
          // something to silently create half-formed.
          if (!existing) throw new Error("device_not_registered")
          // Each key must be signed by this device's already-registered
          // ed25519 identity — otherwise anyone authenticated could inject
          // forged one-time keys under another of their own (enumerable)
          // device ids that later fail the claimer's client-side signature
          // check, breaking new session setup (CWE-347).
          for (const key of oneTimeKeys) {
            if (!verifyOneTimeKeySignature(existing.ed25519IdentityKey, user.id, deviceId, key)) {
              throw new Error("invalid_one_time_key_signature")
            }
          }
        } else {
          const curve25519IdentityKey = body.curve25519IdentityKey as string
          const ed25519IdentityKey = body.ed25519IdentityKey as string
          const fallbackKeyId = body.fallbackKeyId as string
          const fallbackPublicKey = body.fallbackPublicKey as string
          const fallbackSignature = body.fallbackSignature as string

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
        }

        for (const key of oneTimeKeys) {
          tx.insert(olmOneTimeKeys)
            .values({ userId: user.id, deviceId, keyId: key.keyId, publicKey: key.publicKey, signature: key.signature })
            .onConflictDoNothing()
            .run()
        }

        // Prune down to MAX_STORED_ONE_TIME_KEYS *unclaimed* keys per
        // device, oldest first — caps storage if a client re-uploads
        // without the server ever claiming keys (e.g. a low-traffic
        // device). Only ever targets unconsumed rows: a claimed key's row
        // is a permanent tombstone (see olmOneTimeKeys's schema comment) —
        // deleting it would free its (userId, deviceId, keyId) slot back up
        // for a replayed publish request to resurrect as claimable again.
        const excess = tx
          .select({ count: sql<number>`count(*)` })
          .from(olmOneTimeKeys)
          .where(and(eq(olmOneTimeKeys.userId, user.id), eq(olmOneTimeKeys.deviceId, deviceId), isNull(olmOneTimeKeys.consumedAt)))
          .get()
        const overflow = (excess?.count ?? 0) - MAX_STORED_ONE_TIME_KEYS
        if (overflow > 0) {
          const staleIds = tx
            .select({ keyId: olmOneTimeKeys.keyId })
            .from(olmOneTimeKeys)
            .where(and(eq(olmOneTimeKeys.userId, user.id), eq(olmOneTimeKeys.deviceId, deviceId), isNull(olmOneTimeKeys.consumedAt)))
            .orderBy(olmOneTimeKeys.createdAt)
            .limit(overflow)
            .all()
          for (const row of staleIds) {
            tx.delete(olmOneTimeKeys)
              .where(
                and(
                  eq(olmOneTimeKeys.userId, user.id),
                  eq(olmOneTimeKeys.deviceId, deviceId),
                  eq(olmOneTimeKeys.keyId, row.keyId),
                  isNull(olmOneTimeKeys.consumedAt)
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
      if (message.includes("device_not_registered")) {
        return NextResponse.json({ error: "Device not registered — publish an identity before topping up keys" }, { status: 409 })
      }
      if (message.includes("invalid_one_time_key_signature")) {
        return NextResponse.json({ error: "One-time key signature does not match the device identity" }, { status: 400 })
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

// GET /api/dm/olm/keys/device?deviceId=... — how many unclaimed one-time
// keys the server still holds for the caller's own device. The client polls
// this to decide when to replenish its published supply (see the top-up
// check in dm-channel-area.tsx): once the pool drains, every new inbound
// session falls back to the reusable fallback key, losing the per-session
// forward secrecy the one-time keys exist to provide.
export async function GET(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const deviceId = req.nextUrl.searchParams.get("deviceId")
    if (!isValidDeviceId(deviceId)) {
      return NextResponse.json({ error: "Invalid deviceId" }, { status: 400 })
    }

    const row = await db
      .select({ count: sql<number>`count(*)` })
      .from(olmOneTimeKeys)
      .where(and(eq(olmOneTimeKeys.userId, user.id), eq(olmOneTimeKeys.deviceId, deviceId), isNull(olmOneTimeKeys.consumedAt)))
      .get()

    return NextResponse.json({ deviceId, oneTimeKeyCount: row?.count ?? 0 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    log.error({ route: "/api/dm/olm/keys/device", action: "GET", error: message }, "GET error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
