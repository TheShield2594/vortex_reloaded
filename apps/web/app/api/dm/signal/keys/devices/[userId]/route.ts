import { NextRequest, NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"
import { createDb, signalDeviceIdentities } from "@vortex/db"
import { requireAuth } from "@/lib/utils/api-helpers"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()

// Bundle claims are per-device anyway (see .../claim), so this list only
// needs to be bounded, not tied to the legacy-ecdh device cap specifically.
const DEVICE_LIST_LIMIT = 20

// GET /api/dm/signal/keys/devices/[userId] — public device identity list for
// starting a Signal Protocol session. No membership/relationship check: like
// Signal/Matrix key directories, any authenticated user can look up another
// user's public identity keys — that's what makes first-contact (X3DH)
// possible before any channel exists between them. Only public key material
// is returned; one-time keys are consumed one at a time via .../claim.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { error: authError } = await requireAuth()
    if (authError) return authError

    const { userId } = await params

    let rows: Array<{
      deviceId: string
      curve25519IdentityKey: string
      ed25519IdentityKey: string
      updatedAt: string
    }>
    try {
      rows = await db
        .select({
          deviceId: signalDeviceIdentities.deviceId,
          curve25519IdentityKey: signalDeviceIdentities.curve25519IdentityKey,
          ed25519IdentityKey: signalDeviceIdentities.ed25519IdentityKey,
          updatedAt: signalDeviceIdentities.updatedAt,
        })
        .from(signalDeviceIdentities)
        .where(eq(signalDeviceIdentities.userId, userId))
        .orderBy(desc(signalDeviceIdentities.updatedAt))
        .limit(DEVICE_LIST_LIMIT)
    } catch {
      return NextResponse.json({ error: "Failed to fetch device identities" }, { status: 500 })
    }

    return NextResponse.json({ devices: toSnakeCase(rows) })
  } catch (err) {
    console.error("[dm/signal/keys/devices/[userId] GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
