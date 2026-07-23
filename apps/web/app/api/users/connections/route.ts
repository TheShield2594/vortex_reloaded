import { NextResponse } from "next/server"
import { and, asc, eq } from "drizzle-orm"
import { createDb, userConnections } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { toSnakeCase } from "@/lib/utils/case"
import type { Database } from "@/types/database"

type UserConnectionRow = Database["public"]["Tables"]["user_connections"]["Row"]

const db = createDb()

const MANUAL_PROVIDERS = ["github", "x", "twitch", "reddit", "website"] as const
type ManualProvider = (typeof MANUAL_PROVIDERS)[number]
const MANUAL_PROVIDER_SET = new Set<string>(MANUAL_PROVIDERS)

function normalizeProviderUserId(provider: string, value: string) {
  return provider === "website" ? value.trim().toLowerCase() : value.trim().toLowerCase().replace(/^@/, "")
}

export async function GET() {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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
        .where(eq(userConnections.userId, user.id))
        .orderBy(asc(userConnections.createdAt))
    } catch (err) {
      console.error("Failed to load connections", { userId: user.id, error: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: "Failed to load connections" }, { status: 500 })
    }
    return NextResponse.json({ connections: toSnakeCase<UserConnectionRow[]>(rows) })
  } catch (err) {
    console.error("GET /api/users/connections error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await request.json().catch(() => ({}))) as {
      provider?: string
      username?: string
      profile_url?: string
      display_name?: string
    }

    const providerRaw = (body.provider ?? "").trim().toLowerCase()
    if (!MANUAL_PROVIDER_SET.has(providerRaw)) {
      return NextResponse.json({ error: "Unsupported provider" }, { status: 422 })
    }

    const provider = providerRaw as ManualProvider

    const profileUrl = (body.profile_url ?? "").trim()
    if (!profileUrl) return NextResponse.json({ error: "profile_url is required" }, { status: 422 })

    const providerUserId = normalizeProviderUserId(provider, body.username || profileUrl)
    if (!providerUserId) return NextResponse.json({ error: "username is required" }, { status: 422 })

    let row: typeof userConnections.$inferSelect | undefined
    try {
      const rows = await db
        .insert(userConnections)
        .values({
          userId: user.id,
          provider,
          providerUserId,
          username: body.username?.trim() || providerUserId,
          displayName: body.display_name?.trim() || null,
          profileUrl,
          metadata: {},
        })
        .onConflictDoUpdate({
          target: [userConnections.userId, userConnections.provider],
          set: {
            providerUserId,
            username: body.username?.trim() || providerUserId,
            displayName: body.display_name?.trim() || null,
            profileUrl,
            metadata: {},
          },
        })
        .returning()
      row = rows[0]
    } catch (err) {
      console.error("Failed to save connection", { userId: user.id, provider, error: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: "Failed to save connection" }, { status: 500 })
    }

    if (!row) {
      return NextResponse.json({ error: "Failed to save connection" }, { status: 500 })
    }
    return NextResponse.json({ connection: toSnakeCase<UserConnectionRow>(row) })
  } catch (err) {
    console.error("POST /api/users/connections error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 422 })

    try {
      await db
        .delete(userConnections)
        .where(and(eq(userConnections.id, id), eq(userConnections.userId, user.id)))
    } catch (err) {
      console.error("Failed to delete connection", { userId: user.id, connectionId: id, error: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: "Failed to delete connection" }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("DELETE /api/users/connections error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
