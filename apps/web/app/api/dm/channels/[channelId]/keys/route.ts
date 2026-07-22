import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { untypedFrom } from "@/lib/supabase/untyped-table"

const PER_USER_DEVICE_LIMIT = 20
const MAX_KEY_VERSION = 1_000_000

async function assertMembership(channelId: string) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const { data: membership, error: membershipError } = await supabase
    .from("dm_channel_members")
    .select("user_id")
    .eq("dm_channel_id", channelId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (membershipError) return { supabase, user, error: NextResponse.json({ error: "Failed to verify membership" }, { status: 500 }) }
  if (!membership) return { supabase, user, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { supabase, user, error: null }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params
    const { supabase, user, error } = await assertMembership(channelId)
    if (error || !user) return error!

    const [channelResult, memberRowsResult, keyRowsResult] = await Promise.all([
      untypedFrom(supabase, "dm_channels")
        .select("id, is_encrypted, encryption_key_version, encryption_membership_epoch")
        .eq("id", channelId)
        .maybeSingle(),
      supabase.from("dm_channel_members").select("user_id").eq("dm_channel_id", channelId),
      untypedFrom(supabase, "dm_channel_keys")
        .select("key_version, target_user_id, target_device_id, wrapped_key, wrapped_by_user_id, wrapped_by_device_id, sender_public_key")
        .eq("dm_channel_id", channelId)
        .eq("target_user_id", user.id),
    ])

    if (channelResult.error) return NextResponse.json({ error: "Failed to fetch channel encryption data" }, { status: 500 })
    if (!channelResult.data) return NextResponse.json({ error: "DM channel not found" }, { status: 404 })
    if (memberRowsResult.error) return NextResponse.json({ error: "Failed to fetch channel members" }, { status: 500 })
    if (keyRowsResult.error) return NextResponse.json({ error: "Failed to fetch encryption keys" }, { status: 500 })

    const memberIds = (memberRowsResult.data ?? []).map((m) => m.user_id)
    const deviceRowsResult = memberIds.length
      ? await untypedFrom(supabase, "user_device_keys")
        .select("user_id, device_id, public_key, updated_at")
        .in("user_id", memberIds)
        .order("updated_at", { ascending: false })
      : { data: [], error: null }

    if (deviceRowsResult.error) return NextResponse.json({ error: "Failed to fetch device keys" }, { status: 500 })

    const grouped = new Map<string, Array<{ user_id: string; device_id: string; public_key: string }>>()
    for (const row of (deviceRowsResult.data ?? []) as Array<{ user_id: string; device_id: string; public_key: string }>) {
      const list = grouped.get(row.user_id) ?? []
      if (list.length < PER_USER_DEVICE_LIMIT) list.push(row)
      grouped.set(row.user_id, list)
    }
    const boundedDeviceRows = Array.from(grouped.values()).flat()

    return NextResponse.json({
      channel: channelResult.data,
      memberDeviceKeys: boundedDeviceRows,
      wrappedKeys: keyRowsResult.data ?? [],
    })

  } catch (err) {
    console.error("[dm/channels/[channelId]/keys GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function validateWrappedKeyEntry(entry: unknown, index: number) {
  if (!entry || typeof entry !== "object") return `wrappedKeys[${index}] must be an object`

  const fields: Array<keyof {
    targetUserId: unknown
    targetDeviceId: unknown
    wrappedKey: unknown
    wrappedByDeviceId: unknown
    senderPublicKey: unknown
  }> = ["targetUserId", "targetDeviceId", "wrappedKey", "wrappedByDeviceId", "senderPublicKey"]

  const missing: string[] = []
  for (const field of fields) {
    const value = (entry as Record<string, unknown>)[field]
    if (typeof value !== "string" || value.trim().length === 0) missing.push(field)
  }

  if (missing.length) return `wrappedKeys[${index}] invalid fields: ${missing.join(", ")}`
  return null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params
    const { supabase, user, error } = await assertMembership(channelId)
    if (error || !user) return error!

    const body = await req.json().catch(() => null)
    const keyVersion = Number.isInteger(body?.keyVersion) ? body.keyVersion : null
    const wrappedKeys = Array.isArray(body?.wrappedKeys) ? body.wrappedKeys : null

    if (keyVersion == null || !wrappedKeys?.length) {
      return NextResponse.json({ error: "keyVersion and wrappedKeys[] required" }, { status: 400 })
    }

    const { data: channelInfo, error: channelError } = await untypedFrom(supabase, "dm_channels")
      .select("encryption_key_version")
      .eq("id", channelId)
      .maybeSingle()

    if (channelError || !channelInfo) {
      return NextResponse.json({ error: "Unable to verify channel key version" }, { status: 500 })
    }

    if (keyVersion < 0 || keyVersion > MAX_KEY_VERSION || keyVersion > channelInfo.encryption_key_version) {
      return NextResponse.json({ error: "Invalid keyVersion" }, { status: 400 })
    }

    const { count: memberCount, error: memberCountError } = await supabase
      .from("dm_channel_members")
      .select("user_id", { count: "exact", head: true })
      .eq("dm_channel_id", channelId)

    if (memberCountError) {
      return NextResponse.json({ error: "Failed to verify channel membership" }, { status: 500 })
    }

    const maxAllowed = Math.max((memberCount ?? 0) * PER_USER_DEVICE_LIMIT, PER_USER_DEVICE_LIMIT)
    if (wrappedKeys.length > maxAllowed) {
      return NextResponse.json({ error: "Too many wrappedKeys" }, { status: 400 })
    }

    for (let index = 0; index < wrappedKeys.length; index += 1) {
      const entryError = validateWrappedKeyEntry(wrappedKeys[index], index)
      if (entryError) return NextResponse.json({ error: entryError }, { status: 400 })
    }

    const rows = wrappedKeys.map((entry: { targetUserId: string; targetDeviceId: string; wrappedKey: string; wrappedByDeviceId: string; senderPublicKey: string }) => ({
      dm_channel_id: channelId,
      key_version: keyVersion,
      target_user_id: entry.targetUserId,
      target_device_id: entry.targetDeviceId,
      wrapped_key: entry.wrappedKey,
      wrapped_by_user_id: user.id,
      wrapped_by_device_id: entry.wrappedByDeviceId,
      sender_public_key: entry.senderPublicKey,
    }))

    const { error: upsertError } = await untypedFrom(supabase, "dm_channel_keys")
      .upsert(rows)

    if (upsertError) return NextResponse.json({ error: "Failed to store encryption keys" }, { status: 500 })

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[dm/channels/[channelId]/keys POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
