import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { isUserConnectionsTableMissing, USER_CONNECTIONS_SETUP_HINT } from "@/lib/supabase/user-connections-errors"

const MANUAL_PROVIDERS = ["github", "x", "twitch", "reddit", "website"] as const
type ManualProvider = (typeof MANUAL_PROVIDERS)[number]
const MANUAL_PROVIDER_SET = new Set<string>(MANUAL_PROVIDERS)

function normalizeProviderUserId(provider: string, value: string) {
  return provider === "website" ? value.trim().toLowerCase() : value.trim().toLowerCase().replace(/^@/, "")
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data, error } = await supabase
      .from("user_connections")
      .select("id, provider, provider_user_id, username, display_name, profile_url, metadata, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })

    if (error) {
      if (isUserConnectionsTableMissing(error)) {
        return NextResponse.json({ error: USER_CONNECTIONS_SETUP_HINT }, { status: 503 })
      }
      console.error("Failed to load connections", { userId: user.id, error: error.message })
      return NextResponse.json({ error: "Failed to load connections" }, { status: 500 })
    }
    return NextResponse.json({ connections: data ?? [] })
  } catch (err) {
    console.error("GET /api/users/connections error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
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

    const { data, error } = await supabase
      .from("user_connections")
      .upsert({
        user_id: user.id,
        provider,
        provider_user_id: providerUserId,
        username: body.username?.trim() || providerUserId,
        display_name: body.display_name?.trim() || null,
        profile_url: profileUrl,
        metadata: {},
      }, { onConflict: "user_id,provider" })
      .select("id, provider, provider_user_id, username, display_name, profile_url, metadata, created_at")
      .single()

    if (error) {
      if (isUserConnectionsTableMissing(error)) {
        return NextResponse.json({ error: USER_CONNECTIONS_SETUP_HINT }, { status: 503 })
      }
      console.error("Failed to save connection", { userId: user.id, provider, error: error.message })
      return NextResponse.json({ error: "Failed to save connection" }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: "Failed to save connection" }, { status: 500 })
    }
    return NextResponse.json({ connection: data })
  } catch (err) {
    console.error("POST /api/users/connections error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 422 })

    const { error } = await supabase
      .from("user_connections")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)

    if (error) {
      if (isUserConnectionsTableMissing(error)) {
        return NextResponse.json({ error: USER_CONNECTIONS_SETUP_HINT }, { status: 503 })
      }
      console.error("Failed to delete connection", { userId: user.id, connectionId: id, error: error.message })
      return NextResponse.json({ error: "Failed to delete connection" }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("DELETE /api/users/connections error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
