import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { createDb, safetyNumberVerifications } from "@vortex/db"
import { requireAuth } from "@/lib/utils/api-helpers"
import { formatSafetyNumber } from "@/lib/safety-number"
import { computePairSafetyNumber, getPrimaryIdentity } from "@/lib/trust"

const db = createDb()

// GET /api/dm/trust/safety-number?otherUserId=... — Issue #40: computes the
// current safety number between the caller and otherUserId (see
// lib/safety-number.ts), and reports whether it matches what the caller
// last confirmed (if anything), so the UI can show a "verified" badge or a
// "safety number changed — re-verify" warning.
export async function GET(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const otherUserId = req.nextUrl.searchParams.get("otherUserId")
    if (!otherUserId) return NextResponse.json({ error: "otherUserId required" }, { status: 400 })
    if (otherUserId === user.id) return NextResponse.json({ error: "Cannot verify with yourself" }, { status: 400 })

    const [self, other] = await Promise.all([getPrimaryIdentity(user.id), getPrimaryIdentity(otherUserId)])
    if (!self || !other) {
      return NextResponse.json({ error: "No published identity keys for this pair yet" }, { status: 404 })
    }

    const safetyNumber = await computePairSafetyNumber(
      { userId: user.id, ed25519IdentityKey: self.ed25519IdentityKey },
      { userId: otherUserId, ed25519IdentityKey: other.ed25519IdentityKey }
    )

    const [verification] = await db
      .select({
        safetyNumberFingerprint: safetyNumberVerifications.safetyNumberFingerprint,
        verifiedAt: safetyNumberVerifications.verifiedAt,
      })
      .from(safetyNumberVerifications)
      .where(and(eq(safetyNumberVerifications.userId, user.id), eq(safetyNumberVerifications.otherUserId, otherUserId)))
      .limit(1)

    return NextResponse.json({
      safety_number: formatSafetyNumber(safetyNumber),
      other_device_id: other.deviceId,
      verified: !!verification,
      changed: !!verification && verification.safetyNumberFingerprint !== safetyNumber,
      verified_at: verification?.verifiedAt ?? null,
    })
  } catch (err) {
    console.error("[dm/trust/safety-number GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
