import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { STARTER_TEMPLATES, validateAndNormalizeTemplate, type ServerTemplate } from "@/lib/server-templates"

function diffSummary(current: { roleCount: number; categoryCount: number; channelCount: number }, template: ServerTemplate) {
  return {
    roles: { current: current.roleCount, incoming: template.roles.length, delta: template.roles.length - current.roleCount },
    categories: { current: current.categoryCount, incoming: template.categories.length, delta: template.categories.length - current.categoryCount },
    channels: { current: current.channelCount, incoming: template.channels.length, delta: template.channels.length - current.channelCount },
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const mode = url.searchParams.get("mode")
    if (mode === "starter") {
      return NextResponse.json({ templates: STARTER_TEMPLATES })
    }
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 })

  } catch (err) {
    console.error("[server-templates GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let body: Record<string, unknown>
    try {
      const parsed: unknown = await request.json()
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
      }
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const mode = body?.mode as string | undefined
    const result = validateAndNormalizeTemplate(body?.template)
    if (mode !== "export" && result.errors.length > 0) {
      return NextResponse.json({ errors: result.errors, warnings: result.warnings }, { status: 400 })
    }

    if (mode === "validate") {
      return NextResponse.json({ template: result.template, warnings: result.warnings })
    }

    // Modes that operate on an existing server require membership verification
    if (mode === "preview" || mode === "apply" || mode === "export") {
      const serverId = String(body?.serverId ?? "")
      if (!serverId) return NextResponse.json({ error: "serverId is required" }, { status: 400 })

      // Permission check: verify user is a member of the server before any DB operation
      const { data: member } = await supabase
        .from("server_members")
        .select("id")
        .eq("server_id", serverId)
        .eq("user_id", user.id)
        .maybeSingle()
      if (!member) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      if (mode === "preview") {
        const [{ count: roleCount }, { count: channelCount }, { count: categoryCount }] = await Promise.all([
          supabase.from("roles").select("id", { count: "exact", head: true }).eq("server_id", serverId),
          supabase.from("channels").select("id", { count: "exact", head: true }).eq("server_id", serverId).neq("type", "category"),
          supabase.from("channels").select("id", { count: "exact", head: true }).eq("server_id", serverId).eq("type", "category"),
        ])

        return NextResponse.json({
          warnings: result.warnings,
          diff: diffSummary(
            { roleCount: roleCount ?? 0, categoryCount: categoryCount ?? 0, channelCount: channelCount ?? 0 },
            result.template!,
          ),
        })
      }

      if (mode === "apply") {
        const { data, error } = await supabase.rpc("apply_server_template", {
          p_server_id: serverId,
          p_template: result.template as unknown as never,
        })
        if (error) {
          console.error("[server-templates POST apply] error:", error.message)
          return NextResponse.json({ error: "Failed to apply template" }, { status: 400 })
        }
        return NextResponse.json({ ok: true, result: data, warnings: result.warnings })
      }

      if (mode === "export") {
        const { data, error } = await supabase.rpc("export_server_template", { p_server_id: serverId })
        if (error) {
          console.error("[server-templates POST export] error:", error.message)
          return NextResponse.json({ error: "Failed to export template" }, { status: 400 })
        }
        return NextResponse.json({ template: data })
      }
    }

    if (mode === "create-server") {
      const name = String(body?.name ?? "").trim()
      if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

      const { data, error } = await supabase.rpc("create_server_from_template", {
        p_name: name,
        p_description: String(body?.description ?? ""),
        p_icon_url: String(body?.iconUrl ?? ""),
        p_template: result.template as unknown as never,
      })
      if (error) {
        console.error("[server-templates POST create-server] error:", error.message)
        return NextResponse.json({ error: "Failed to create server from template" }, { status: 400 })
      }
      return NextResponse.json({ server: data, warnings: result.warnings }, { status: 201 })
    }

    return NextResponse.json({ error: "Invalid mode" }, { status: 400 })

  } catch (err) {
    console.error("[server-templates POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
