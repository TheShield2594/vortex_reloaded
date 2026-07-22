import { webcrypto } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { untypedFrom, untypedRpc } from "@/lib/supabase/untyped-table"

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
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data, error, count } = await untypedFrom(supabase, "user_device_keys")
      .select("device_id, public_key, updated_at", { count: "exact" })
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(DEVICE_LIMIT)

    if (error) return NextResponse.json({ error: "Failed to fetch device keys" }, { status: 500 })

    return NextResponse.json({
      devices: data ?? [],
      truncated: (count ?? 0) > DEVICE_LIMIT,
      total: count ?? (data?.length ?? 0),
    })

  } catch (err) {
    console.error("[dm/keys/device GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
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

    const { data, error } = await untypedRpc(supabase, "upsert_user_device_key", {
      p_device_id: deviceId,
      p_public_key: publicKey,
      p_device_limit: DEVICE_LIMIT,
    })

    if (error) {
      if (error.message?.includes("device_limit_reached")) {
        return NextResponse.json({ error: `Device limit reached (${DEVICE_LIMIT})` }, { status: 409 })
      }
      return NextResponse.json({ error: "Failed to register device key" }, { status: 500 })
    }

    if (data !== true) {
      return NextResponse.json({ error: "Device key upsert failed" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[dm/keys/device POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
