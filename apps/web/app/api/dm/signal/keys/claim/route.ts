import { NextRequest, NextResponse } from "next/server"
import { and, asc, eq } from "drizzle-orm"
import { createDb, signalDeviceIdentities, signalOneTimeKeys } from "@vortex/db"
import { requireAuth, parseJsonBody, checkRateLimit } from "@/lib/utils/api-helpers"
import { createLogger } from "@/lib/logger"
import { isValidDeviceId } from "@/lib/signal-key-validation"

const log = createLogger("api/dm/signal/keys/claim")
const db = createDb()

type ClaimBody = { targetUserId?: unknown; targetDeviceId?: unknown }

// POST /api/dm/signal/keys/claim — atomically consume one of a device's
// published one-time keys to start an Olm session with it (X3DH-style).
// Falls back to the device's (reusable) fallback key once one-time keys run
// out, so sessions can still be established rather than failing outright —
// at the cost of some forward secrecy for that one DH term, same tradeoff
// Signal/Matrix's own "last resort"/fallback keys make.
export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const limited = await checkRateLimit(user.id, "signal:claim-key", { limit: 60, windowMs: 60_000 })
    if (limited) return limited

    const { data: body, error: parseError } = await parseJsonBody<ClaimBody>(req)
    if (parseError) return parseError

    if (typeof body.targetUserId !== "string" || !body.targetUserId) {
      return NextResponse.json({ error: "targetUserId required" }, { status: 400 })
    }
    if (!isValidDeviceId(body.targetDeviceId)) {
      return NextResponse.json({ error: "Invalid targetDeviceId" }, { status: 400 })
    }
    const targetUserId = body.targetUserId
    const targetDeviceId = body.targetDeviceId

    let identity: { curve25519IdentityKey: string; ed25519IdentityKey: string; fallbackKeyId: string; fallbackPublicKey: string; fallbackSignature: string } | undefined
    try {
      const rows = await db
        .select({
          curve25519IdentityKey: signalDeviceIdentities.curve25519IdentityKey,
          ed25519IdentityKey: signalDeviceIdentities.ed25519IdentityKey,
          fallbackKeyId: signalDeviceIdentities.fallbackKeyId,
          fallbackPublicKey: signalDeviceIdentities.fallbackPublicKey,
          fallbackSignature: signalDeviceIdentities.fallbackSignature,
        })
        .from(signalDeviceIdentities)
        .where(and(eq(signalDeviceIdentities.userId, targetUserId), eq(signalDeviceIdentities.deviceId, targetDeviceId)))
        .limit(1)
      identity = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to fetch device identity" }, { status: 500 })
    }

    if (!identity) return NextResponse.json({ error: "Device not found" }, { status: 404 })

    let claimed: { keyId: string; publicKey: string; signature: string; isFallback: boolean }
    try {
      // better-sqlite3's transaction() is synchronous-only (see issue #4's
      // spike) — select-then-delete inside one transaction so two
      // simultaneous claimers can never walk away with the same one-time
      // key (reusing an Olm one-time key breaks the forward secrecy it
      // exists to provide).
      claimed = db.transaction((tx) => {
        const otk = tx
          .select({ keyId: signalOneTimeKeys.keyId, publicKey: signalOneTimeKeys.publicKey, signature: signalOneTimeKeys.signature })
          .from(signalOneTimeKeys)
          .where(and(eq(signalOneTimeKeys.userId, targetUserId), eq(signalOneTimeKeys.deviceId, targetDeviceId)))
          .orderBy(asc(signalOneTimeKeys.createdAt))
          .limit(1)
          .get()

        if (otk) {
          tx.delete(signalOneTimeKeys)
            .where(
              and(
                eq(signalOneTimeKeys.userId, targetUserId),
                eq(signalOneTimeKeys.deviceId, targetDeviceId),
                eq(signalOneTimeKeys.keyId, otk.keyId)
              )
            )
            .run()
          return { keyId: otk.keyId, publicKey: otk.publicKey, signature: otk.signature, isFallback: false }
        }

        return {
          keyId: identity!.fallbackKeyId,
          publicKey: identity!.fallbackPublicKey,
          signature: identity!.fallbackSignature,
          isFallback: true,
        }
      })
    } catch (err) {
      log.error({ route: "/api/dm/signal/keys/claim", action: "POST", userId: user.id, targetUserId, targetDeviceId, error: err instanceof Error ? err.message : String(err) }, "claim failed")
      return NextResponse.json({ error: "Failed to claim key" }, { status: 500 })
    }

    return NextResponse.json({
      curve25519_identity_key: identity.curve25519IdentityKey,
      ed25519_identity_key: identity.ed25519IdentityKey,
      key_id: claimed.keyId,
      public_key: claimed.publicKey,
      signature: claimed.signature,
      is_fallback: claimed.isFallback,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    log.error({ route: "/api/dm/signal/keys/claim", action: "POST", error: message }, "POST error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
