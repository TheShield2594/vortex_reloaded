import { webcrypto } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"
import { createDb, userDeviceKeys } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()

const DEVICE_LIMIT = 20

function decodeBase64(value: string): Uint8Array | null {
  try {
    const bytes = Buffer.from(value, "base64")
    return bytes.length ? new Uint8Array(bytes) : null
  } catch {
    return null
  }
}

async function isValidP256SpkiPublicKey(publicKey: string): Promise<boolean> {
  const bytes = decodeBase64(publicKey)
  if (!bytes) return false
  if (bytes.length < 80 || bytes.length > 130) return false

  try {
    await webcrypto.subtle.importKey(
      "spki",
      bytes,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      []
    )
    return true
  } catch {
    return false
  }
}

export async function GET() {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let allRows: Array<{ deviceId: string; publicKey: string; updatedAt: string }>
    try {
      allRows = await db
        .select({ deviceId: userDeviceKeys.deviceId, publicKey: userDeviceKeys.publicKey, updatedAt: userDeviceKeys.updatedAt })
        .from(userDeviceKeys)
        .where(eq(userDeviceKeys.userId, user.id))
        .orderBy(desc(userDeviceKeys.updatedAt))
    } catch {
      return NextResponse.json({ error: "Failed to fetch device keys" }, { status: 500 })
    }

    const total = allRows.length
    const data = allRows.slice(0, DEVICE_LIMIT)

    return NextResponse.json({
      devices: toSnakeCase(data),
      truncated: total > DEVICE_LIMIT,
      total,
    })

  } catch (err) {
    console.error("[dm/keys/device GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => null)
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : null
    const publicKey = typeof body?.publicKey === "string" ? body.publicKey.trim() : null
    if (!deviceId || !publicKey) {
      return NextResponse.json({ error: "deviceId and publicKey required" }, { status: 400 })
    }

    const validPublicKey = await isValidP256SpkiPublicKey(publicKey)
    if (!validPublicKey) {
      return NextResponse.json({ error: "Invalid device public key" }, { status: 400 })
    }

    // The per-user device cap (default 20, matching DEVICE_LIMIT here) that
    // Postgres enforced with a count-then-insert check inside the
    // `upsert_user_device_key` SECURITY DEFINER RPC is now enforced by a
    // `user_device_keys_cap_before_insert` BEFORE INSERT trigger (see
    // packages/db/src/sql/fts5-and-triggers.sql) — it fires even when this
    // statement resolves as an ON CONFLICT DO UPDATE, so upserting an
    // *existing* device's key never counts against the cap, only genuinely
    // new devices do. The trigger raises with the same
    // "device_limit_reached" message the old RPC did, which better-sqlite3
    // surfaces as a thrown Error we can match on below.
    const nowIso = new Date().toISOString()
    try {
      await db
        .insert(userDeviceKeys)
        .values({ userId: user.id, deviceId, publicKey, updatedAt: nowIso })
        .onConflictDoUpdate({
          target: [userDeviceKeys.userId, userDeviceKeys.deviceId],
          set: { publicKey, updatedAt: nowIso },
        })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("device_limit_reached")) {
        return NextResponse.json({ error: `Device limit reached (${DEVICE_LIMIT})` }, { status: 409 })
      }
      return NextResponse.json({ error: "Failed to register device key" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[dm/keys/device POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
