import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { createDb, users } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { checkRateLimit } from "@/lib/utils/api-helpers"
import { sanitizeBannerColor } from "@/lib/banner-color"
import { toSnakeCase } from "@/lib/utils/case"
import type { UserRow } from "@/types/database"

const db = createDb()

type ProfileUpdatePayload = Partial<Pick<UserRow,
  "display_name" | "username" | "bio" | "custom_tag" | "status_message" | "status_emoji" | "status_expires_at" | "status" | "banner_color" | "avatar_url" | "appearance_settings"
>>

export async function PATCH(request: Request) {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limited = await checkRateLimit(user.id, "profile:update", { limit: 30, windowMs: 60_000 })
    if (limited) return limited

    const body = (await request.json()) as ProfileUpdatePayload
    const allowedKeys: Array<keyof ProfileUpdatePayload> = [
      "display_name",
      "username",
      "bio",
      "custom_tag",
      "status_message",
      "status_emoji",
      "status_expires_at",
      "status",
      "banner_color",
      "avatar_url",
      "appearance_settings",
    ]

    if (body.banner_color !== undefined && body.banner_color !== null) {
      const normalized = sanitizeBannerColor(body.banner_color)
      if (!normalized) {
        return NextResponse.json(
          { error: "Invalid banner_color. Use a hex color (e.g. #5865f2) or an allowed named color." },
          { status: 422 }
        )
      }
      body.banner_color = normalized
    }

    if (body.status_expires_at !== undefined && body.status_expires_at !== null) {
      const expiryTime = new Date(body.status_expires_at).getTime()
      if (Number.isNaN(expiryTime)) {
        return NextResponse.json(
          { error: "Invalid status_expires_at. Use an ISO-8601 datetime." },
          { status: 422 }
        )
      }
    }

    if (body.status_emoji !== undefined && body.status_emoji !== null && body.status_emoji.length > 8) {
      return NextResponse.json(
        { error: "status_emoji must be 8 characters or fewer." },
        { status: 422 }
      )
    }

    const updatePayload: ProfileUpdatePayload = {
      display_name: body.display_name,
      username: body.username,
      bio: body.bio,
      custom_tag: body.custom_tag,
      status_message: body.status_message,
      status_emoji: body.status_emoji,
      status_expires_at: body.status_expires_at,
      status: body.status,
      banner_color: body.banner_color,
      avatar_url: body.avatar_url,
      appearance_settings: body.appearance_settings,
    }

    for (const key of allowedKeys) {
      if (updatePayload[key] === undefined) {
        delete updatePayload[key]
      }
    }

    const updateValues: Partial<typeof users.$inferInsert> = {}
    if (updatePayload.display_name !== undefined) updateValues.displayName = updatePayload.display_name
    if (updatePayload.username !== undefined) updateValues.username = updatePayload.username
    if (updatePayload.bio !== undefined) updateValues.bio = updatePayload.bio
    if (updatePayload.custom_tag !== undefined) updateValues.customTag = updatePayload.custom_tag
    if (updatePayload.status_message !== undefined) updateValues.statusMessage = updatePayload.status_message
    if (updatePayload.status_emoji !== undefined) updateValues.statusEmoji = updatePayload.status_emoji
    if (updatePayload.status_expires_at !== undefined) updateValues.statusExpiresAt = updatePayload.status_expires_at
    if (updatePayload.status !== undefined) updateValues.status = updatePayload.status
    if (updatePayload.banner_color !== undefined) updateValues.bannerColor = updatePayload.banner_color
    if (updatePayload.avatar_url !== undefined) updateValues.avatarUrl = updatePayload.avatar_url
    if (updatePayload.appearance_settings !== undefined) updateValues.appearanceSettings = updatePayload.appearance_settings

    let row: typeof users.$inferSelect | undefined
    try {
      if (Object.keys(updateValues).length > 0) {
        const rows = await db.update(users).set(updateValues).where(eq(users.id, user.id)).returning()
        row = rows[0]
      } else {
        const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
        row = rows[0]
      }
    } catch {
      return NextResponse.json({ error: "Failed to update profile" }, { status: 500 })
    }

    if (!row) {
      return NextResponse.json({ error: "Failed to update profile" }, { status: 500 })
    }

    return NextResponse.json(toSnakeCase<UserRow>(row))
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
