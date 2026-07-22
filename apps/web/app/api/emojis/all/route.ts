import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

interface MembershipRow {
  server_id: string
  servers: { id: string; name: string; icon_url: string | null }
}

/** GET /api/emojis/all — Returns all custom emojis across every server the
 *  authenticated user belongs to. Results are grouped by server so the picker
 *  can display them under server-name headers. */
export async function GET(_req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Fetch all server IDs the user is a member of
    const { data: memberships, error: memErr } = await supabase
      .from("server_members")
      .select("server_id, servers!inner(id, name, icon_url)")
      .eq("user_id", user.id)

    if (memErr) {
      console.error("Failed to fetch memberships for emoji lookup:", memErr.message)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
    if (!memberships || memberships.length === 0) return NextResponse.json([], { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } })

    const rows = memberships as unknown as MembershipRow[]
    const serverIds = rows.map((m) => m.server_id)
    const serverMap = new Map<string, MembershipRow["servers"]>(
      rows.map((m) => [m.server_id, m.servers])
    )

    // Fetch all custom emojis across those servers in a single query
    const { data: emojis, error: emojiErr } = await supabase
      .from("server_emojis")
      .select("id, name, image_url, server_id")
      .in("server_id", serverIds)
      .order("name")

    if (emojiErr) {
      console.error("Failed to fetch server emojis:", emojiErr.message)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    // Group by server
    const grouped: Array<{
      server: { id: string; name: string; icon_url: string | null }
      emojis: Array<{ id: string; name: string; image_url: string }>
    }> = []

    const byServer = new Map<string, Array<{ id: string; name: string; image_url: string }>>()
    for (const e of emojis ?? []) {
      let arr = byServer.get(e.server_id)
      if (!arr) { arr = []; byServer.set(e.server_id, arr) }
      arr.push({ id: e.id, name: e.name, image_url: e.image_url })
    }

    for (const [sid, emojiList] of byServer) {
      const server = serverMap.get(sid)
      if (!server || emojiList.length === 0) continue
      grouped.push({ server: { id: server.id, name: server.name, icon_url: server.icon_url }, emojis: emojiList })
    }

    return NextResponse.json(grouped, {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" },
    })

  } catch (err) {
    console.error("[emojis/all GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
