import { NextRequest, NextResponse } from "next/server"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { createDb, dmChannelKeys, dmChannelMembers, dmChannels, pruneDmChannelKeys, userDeviceKeys } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()

const PER_USER_DEVICE_LIMIT = 20
const MAX_KEY_VERSION = 1_000_000

async function assertMembership(channelId: string) {
  const { data: { user } } = await getBetterAuthUser()
  if (!user) return { user: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  let membership: { userId: string } | undefined
  try {
    const rows = await db
      .select({ userId: dmChannelMembers.userId })
      .from(dmChannelMembers)
      .where(and(eq(dmChannelMembers.dmChannelId, channelId), eq(dmChannelMembers.userId, user.id)))
      .limit(1)
    membership = rows[0]
  } catch {
    return { user, error: NextResponse.json({ error: "Failed to verify membership" }, { status: 500 }) }
  }
  if (!membership) return { user, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { user, error: null }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params
    const { user, error } = await assertMembership(channelId)
    if (error || !user) return error!

    let channel: { id: string; isEncrypted: boolean; encryptionKeyVersion: number; encryptionMembershipEpoch: number } | undefined
    let memberRows: Array<{ userId: string }>
    let keyRows: Array<{
      keyVersion: number
      targetUserId: string
      targetDeviceId: string
      wrappedKey: string
      wrappedByUserId: string
      wrappedByDeviceId: string
      senderPublicKey: string
    }>
    try {
      const [channelResult, memberRowsResult, keyRowsResult] = await Promise.all([
        db
          .select({
            id: dmChannels.id,
            isEncrypted: dmChannels.isEncrypted,
            encryptionKeyVersion: dmChannels.encryptionKeyVersion,
            encryptionMembershipEpoch: dmChannels.encryptionMembershipEpoch,
          })
          .from(dmChannels)
          .where(eq(dmChannels.id, channelId))
          .limit(1),
        db.select({ userId: dmChannelMembers.userId }).from(dmChannelMembers).where(eq(dmChannelMembers.dmChannelId, channelId)),
        db
          .select({
            keyVersion: dmChannelKeys.keyVersion,
            targetUserId: dmChannelKeys.targetUserId,
            targetDeviceId: dmChannelKeys.targetDeviceId,
            wrappedKey: dmChannelKeys.wrappedKey,
            wrappedByUserId: dmChannelKeys.wrappedByUserId,
            wrappedByDeviceId: dmChannelKeys.wrappedByDeviceId,
            senderPublicKey: dmChannelKeys.senderPublicKey,
          })
          .from(dmChannelKeys)
          .where(and(eq(dmChannelKeys.dmChannelId, channelId), eq(dmChannelKeys.targetUserId, user.id))),
      ])
      channel = channelResult[0]
      memberRows = memberRowsResult
      keyRows = keyRowsResult
    } catch {
      return NextResponse.json({ error: "Failed to fetch channel encryption data" }, { status: 500 })
    }

    if (!channel) return NextResponse.json({ error: "DM channel not found" }, { status: 404 })

    const memberIds = memberRows.map((m) => m.userId)
    let deviceRows: Array<{ userId: string; deviceId: string; publicKey: string; updatedAt: string }>
    try {
      deviceRows = memberIds.length
        ? await db
            .select({ userId: userDeviceKeys.userId, deviceId: userDeviceKeys.deviceId, publicKey: userDeviceKeys.publicKey, updatedAt: userDeviceKeys.updatedAt })
            .from(userDeviceKeys)
            .where(inArray(userDeviceKeys.userId, memberIds))
            .orderBy(desc(userDeviceKeys.updatedAt))
        : []
    } catch {
      return NextResponse.json({ error: "Failed to fetch device keys" }, { status: 500 })
    }

    const grouped = new Map<string, Array<{ userId: string; deviceId: string; publicKey: string }>>()
    for (const row of deviceRows) {
      const list = grouped.get(row.userId) ?? []
      if (list.length < PER_USER_DEVICE_LIMIT) list.push({ userId: row.userId, deviceId: row.deviceId, publicKey: row.publicKey })
      grouped.set(row.userId, list)
    }
    const boundedDeviceRows = Array.from(grouped.values()).flat()

    return NextResponse.json({
      channel: toSnakeCase(channel),
      memberDeviceKeys: toSnakeCase(boundedDeviceRows),
      wrappedKeys: toSnakeCase(keyRows),
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
    const { user, error } = await assertMembership(channelId)
    if (error || !user) return error!

    const body = await req.json().catch(() => null)
    const keyVersion = Number.isInteger(body?.keyVersion) ? body.keyVersion : null
    const wrappedKeys = Array.isArray(body?.wrappedKeys) ? body.wrappedKeys : null

    if (keyVersion == null || !wrappedKeys?.length) {
      return NextResponse.json({ error: "keyVersion and wrappedKeys[] required" }, { status: 400 })
    }

    let channelInfo: { encryptionKeyVersion: number } | undefined
    try {
      const rows = await db
        .select({ encryptionKeyVersion: dmChannels.encryptionKeyVersion })
        .from(dmChannels)
        .where(eq(dmChannels.id, channelId))
        .limit(1)
      channelInfo = rows[0]
    } catch {
      return NextResponse.json({ error: "Unable to verify channel key version" }, { status: 500 })
    }

    if (!channelInfo) {
      return NextResponse.json({ error: "Unable to verify channel key version" }, { status: 500 })
    }

    if (keyVersion < 0 || keyVersion > MAX_KEY_VERSION || keyVersion > channelInfo.encryptionKeyVersion) {
      return NextResponse.json({ error: "Invalid keyVersion" }, { status: 400 })
    }

    let memberCount: number
    try {
      const rows = await db.select({ userId: dmChannelMembers.userId }).from(dmChannelMembers).where(eq(dmChannelMembers.dmChannelId, channelId))
      memberCount = rows.length
    } catch {
      return NextResponse.json({ error: "Failed to verify channel membership" }, { status: 500 })
    }

    const maxAllowed = Math.max(memberCount * PER_USER_DEVICE_LIMIT, PER_USER_DEVICE_LIMIT)
    if (wrappedKeys.length > maxAllowed) {
      return NextResponse.json({ error: "Too many wrappedKeys" }, { status: 400 })
    }

    for (let index = 0; index < wrappedKeys.length; index += 1) {
      const entryError = validateWrappedKeyEntry(wrappedKeys[index], index)
      if (entryError) return NextResponse.json({ error: entryError }, { status: 400 })
    }

    const rows = wrappedKeys.map((entry: { targetUserId: string; targetDeviceId: string; wrappedKey: string; wrappedByDeviceId: string; senderPublicKey: string }) => ({
      dmChannelId: channelId,
      keyVersion,
      targetUserId: entry.targetUserId,
      targetDeviceId: entry.targetDeviceId,
      wrappedKey: entry.wrappedKey,
      wrappedByUserId: user.id,
      wrappedByDeviceId: entry.wrappedByDeviceId,
      senderPublicKey: entry.senderPublicKey,
    }))

    try {
      await db
        .insert(dmChannelKeys)
        .values(rows)
        .onConflictDoUpdate({
          target: [dmChannelKeys.dmChannelId, dmChannelKeys.keyVersion, dmChannelKeys.targetUserId, dmChannelKeys.targetDeviceId],
          set: {
            wrappedKey: sql`excluded.wrapped_key`,
            wrappedByUserId: sql`excluded.wrapped_by_user_id`,
            wrappedByDeviceId: sql`excluded.wrapped_by_device_id`,
            senderPublicKey: sql`excluded.sender_public_key`,
          },
        })
    } catch {
      return NextResponse.json({ error: "Failed to store encryption keys" }, { status: 500 })
    }

    // Postgres's `prune_dm_channel_keys` cleanup ran off a statement-level
    // AFTER INSERT/UPDATE trigger on dm_channel_keys — SQLite has no
    // equivalent, so call the ported application-code helper directly after
    // this write batch (single dm channel per request).
    pruneDmChannelKeys(db, [channelId])

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[dm/channels/[channelId]/keys POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
