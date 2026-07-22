/**
 * GET/PATCH /api/servers/[serverId]/settings/theme
 *
 * Manage the server's recommended theme setting.
 * GET: returns the current recommended theme.
 * PATCH: updates the recommended theme (requires ADMINISTRATOR).
 *
 * Storage: Uses the `description` field as a source for an embedded JSON
 * metadata block `<!-- vortex:{"recommended_theme":"..."} -->` appended
 * after the human-readable description. This avoids requiring a schema
 * migration while the feature is experimental. A dedicated column should
 * be added once the feature is stable.
 */
import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getMemberPermissions } from "@/lib/permissions"

const VALID_THEMES = [
  "twilight", "midnight-neon", "synthwave", "carbon", "oled-black",
  "frost", "clarity", "velvet-dusk", "terminal", "sakura-blossom", "frosthearth", "night-city-neural",
]

const META_REGEX = /<!-- vortex:(.*?) -->/

function extractMeta(description: string | null): Record<string, unknown> {
  if (!description) return {}
  const match = META_REGEX.exec(description)
  if (!match?.[1]) return {}
  try {
    return JSON.parse(match[1]) as Record<string, unknown>
  } catch {
    return {}
  }
}

function embedMeta(description: string | null, meta: Record<string, unknown>): string {
  const base = (description ?? "").replace(META_REGEX, "").trimEnd()
  const metaStr = JSON.stringify(meta)
  // Only append if there's something to store
  const hasValues = Object.values(meta).some((v) => v !== null && v !== undefined)
  if (!hasValues) return base
  return `${base}\n<!-- vortex:${metaStr} -->`
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ serverId: string }> }
): Promise<NextResponse> {
  const { serverId } = await params

  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { isMember } = await getMemberPermissions(supabase, serverId, user.id)
    if (!isMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { data: server, error: serverError } = await supabase
      .from("servers")
      .select("description")
      .eq("id", serverId)
      .single()

    if (serverError || !server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 })
    }

    const meta = extractMeta(server.description ?? null)
    return NextResponse.json({
      recommended_theme: (typeof meta.recommended_theme === "string" ? meta.recommended_theme : null),
    })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
): Promise<NextResponse> {
  const { serverId } = await params

  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { isAdmin } = await getMemberPermissions(supabase, serverId, user.id)
    if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await req.json() as { recommended_theme?: string | null }
    const theme = body.recommended_theme

    if (theme !== null && theme !== undefined && theme !== "" && !VALID_THEMES.includes(theme)) {
      return NextResponse.json({ error: "Invalid theme" }, { status: 400 })
    }

    // Read current description to preserve existing content
    const { data: server, error: serverError } = await supabase
      .from("servers")
      .select("description")
      .eq("id", serverId)
      .single()

    if (serverError || !server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 })
    }

    const meta = extractMeta(server.description ?? null)
    meta.recommended_theme = theme || null
    const newDescription = embedMeta(server.description ?? null, meta)

    const { error: updateError, count } = await supabase
      .from("servers")
      .update({ description: newDescription })
      .eq("id", serverId)

    if (updateError) {
      return NextResponse.json({ error: "Failed to update theme" }, { status: 500 })
    }

    if (count === 0) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 })
    }

    return NextResponse.json({ recommended_theme: theme || null })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
