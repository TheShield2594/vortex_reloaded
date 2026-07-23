import { NextResponse } from "next/server"
import { asc, eq } from "drizzle-orm"
import { createDb, userConnections } from "@vortex/db"
import { toSnakeCase } from "@/lib/utils/case"
import type { Database } from "@/types/database"

type UserConnectionRow = Database["public"]["Tables"]["user_connections"]["Row"]

const db = createDb()

/**
 * GET /api/users/connections/public?userId=<uuid>
 * Returns the public connections for a given user (visible on their profile panel).
 * Accessible to both authenticated and anonymous visitors.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("userId")

    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      return NextResponse.json({ error: "userId query parameter is required" }, { status: 400 })
    }

    let rows
    try {
      rows = await db
        .select({
          id: userConnections.id,
          provider: userConnections.provider,
          providerUserId: userConnections.providerUserId,
          username: userConnections.username,
          displayName: userConnections.displayName,
          profileUrl: userConnections.profileUrl,
          metadata: userConnections.metadata,
          createdAt: userConnections.createdAt,
        })
        .from(userConnections)
        .where(eq(userConnections.userId, userId.trim()))
        .orderBy(asc(userConnections.createdAt))
    } catch {
      return NextResponse.json({ error: "Failed to load connections" }, { status: 500 })
    }

    return NextResponse.json({ connections: toSnakeCase<UserConnectionRow[]>(rows) })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
