/**
 * GET  /api/users/badges?userId=<id>  — fetch badges for a specific user
 * POST /api/users/badges              — award a badge (service role only)
 * DELETE /api/users/badges?userId=<id>&badgeId=<id> — revoke a badge (service role only)
 */
import { type NextRequest, NextResponse } from "next/server"
import { and, desc, eq } from "drizzle-orm"
import { badgeDefinitions, createDb, userBadges } from "@vortex/db"
import { requireAuthWithServiceRole } from "@/lib/utils/api-helpers"
import { toSnakeCase } from "@/lib/utils/case"
import type { BadgeDefinitionRow, UserBadgeRow } from "@/types/database"

type UserBadgeWithDefinition = UserBadgeRow & { badge: BadgeDefinitionRow | null }

const db = createDb()

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get("userId")
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 })
    }

    let rows
    try {
      rows = await db
        .select({
          id: userBadges.id,
          userId: userBadges.userId,
          badgeId: userBadges.badgeId,
          awardedAt: userBadges.awardedAt,
          awardedBy: userBadges.awardedBy,
          metadata: userBadges.metadata,
          badge: badgeDefinitions,
        })
        .from(userBadges)
        .leftJoin(badgeDefinitions, eq(userBadges.badgeId, badgeDefinitions.id))
        .where(eq(userBadges.userId, userId))
        .orderBy(desc(userBadges.awardedAt))
    } catch {
      return NextResponse.json({ error: "Failed to fetch user badges" }, { status: 500 })
    }

    const badges = toSnakeCase<UserBadgeWithDefinition[]>(rows)
    return NextResponse.json(badges)
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuthWithServiceRole()
    if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { userId, badgeId } = body as { userId?: string; badgeId?: string }
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }
    if (!badgeId || typeof badgeId !== "string") {
      return NextResponse.json({ error: "badgeId is required" }, { status: 400 })
    }

    // Validate badge exists
    const [badgeDef] = await db
      .select({ id: badgeDefinitions.id })
      .from(badgeDefinitions)
      .where(eq(badgeDefinitions.id, badgeId))
      .limit(1)

    if (!badgeDef) {
      return NextResponse.json({ error: "Badge not found" }, { status: 404 })
    }

    // Award the badge
    let awarded: typeof userBadges.$inferSelect | undefined
    try {
      const rows = await db
        .insert(userBadges)
        .values({ userId, badgeId, awardedBy: user.id })
        .returning()
      awarded = rows[0]
    } catch (insertError) {
      if (insertError instanceof Error && /UNIQUE constraint failed/.test(insertError.message)) {
        return NextResponse.json({ error: "User already has this badge" }, { status: 409 })
      }
      return NextResponse.json({ error: "Failed to award badge" }, { status: 500 })
    }

    if (!awarded) {
      return NextResponse.json({ error: "Failed to award badge" }, { status: 500 })
    }

    const [badgeRow] = await db
      .select()
      .from(badgeDefinitions)
      .where(eq(badgeDefinitions.id, badgeId))
      .limit(1)

    const result = toSnakeCase<UserBadgeWithDefinition>({ ...awarded, badge: badgeRow ?? null })

    return NextResponse.json(result, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuthWithServiceRole()
    if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get("userId")
    const badgeId = searchParams.get("badgeId")

    if (!userId || !badgeId) {
      return NextResponse.json({ error: "userId and badgeId are required" }, { status: 400 })
    }

    try {
      await db
        .delete(userBadges)
        .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)))
    } catch {
      return NextResponse.json({ error: "Failed to revoke badge" }, { status: 500 })
    }

    return NextResponse.json({ message: "Badge revoked" })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
