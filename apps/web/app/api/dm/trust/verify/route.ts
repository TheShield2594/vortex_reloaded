import { NextRequest, NextResponse } from "next/server"
import { safetyNumberVerifications, createDb } from "@vortex/db"
import { parseJsonBody, requireAuth } from "@/lib/utils/api-helpers"
import { computePairSafetyNumber, getPrimaryIdentity } from "@/lib/trust"

const db = createDb()

interface VerifyBody {
  otherUserId?: string
  safetyNumber?: string
}

// POST /api/dm/trust/verify — Issue #40: records that the caller compared
// and confirmed a safety number with otherUserId. The number the client
// displayed is re-derived server-side from current key material and must
// match what was submitted — this isn't a security boundary (the client
// already independently verified it, and this endpoint isn't the thing
// protecting message confidentiality) so much as a guard against a stale
// UI confirming a safety number that's no longer current.
export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const { data, error } = await parseJsonBody<VerifyBody>(req)
    if (error) return error

    const otherUserId = data.otherUserId
    const submitted = data.safetyNumber?.replace(/\D/g, "") ?? ""
    if (!otherUserId || !submitted) {
      return NextResponse.json({ error: "otherUserId and safetyNumber required" }, { status: 400 })
    }
    if (otherUserId === user.id) return NextResponse.json({ error: "Cannot verify with yourself" }, { status: 400 })

    const [self, other] = await Promise.all([getPrimaryIdentity(user.id), getPrimaryIdentity(otherUserId)])
    if (!self || !other) {
      return NextResponse.json({ error: "No published identity keys for this pair yet" }, { status: 404 })
    }

    const current = await computePairSafetyNumber(
      { userId: user.id, ed25519IdentityKey: self.ed25519IdentityKey },
      { userId: otherUserId, ed25519IdentityKey: other.ed25519IdentityKey }
    )

    if (submitted !== current) {
      return NextResponse.json(
        { error: "Safety number doesn't match current keys — refresh and try again" },
        { status: 409 }
      )
    }

    const [row] = await db
      .insert(safetyNumberVerifications)
      .values({ userId: user.id, otherUserId, safetyNumberFingerprint: current })
      .onConflictDoUpdate({
        target: [safetyNumberVerifications.userId, safetyNumberVerifications.otherUserId],
        set: { safetyNumberFingerprint: current, verifiedAt: new Date().toISOString() },
      })
      .returning({ verifiedAt: safetyNumberVerifications.verifiedAt })

    return NextResponse.json({ ok: true, verified_at: row?.verifiedAt ?? null })
  } catch (err) {
    console.error("[dm/trust/verify POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
