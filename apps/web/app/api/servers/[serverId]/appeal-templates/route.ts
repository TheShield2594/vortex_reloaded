import { NextRequest, NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { requireModerator } from "@/lib/moderation-auth"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const { serverId } = await params
    const auth = await requireModerator(serverId)
    if (auth.error) return auth.error

    const { data, error } = await auth.supabase
      .from("moderation_decision_templates")
      .select("id, title, body, decision, created_at")
      .eq("server_id", serverId)
      .order("created_at", { ascending: false })

    if (error) return NextResponse.json({ error: "Failed to fetch appeal templates" }, { status: 500 })
    return NextResponse.json(data ?? [])

  } catch (err) {
    console.error("[servers/[serverId]/appeal-templates GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
  const { serverId } = await params
  const auth = await requireModerator(serverId)
  if (auth.error) return auth.error
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 })
  }

  const { title, body: templateBody, decision } = body as {
    title?: unknown
    body?: unknown
    decision?: unknown
  }

  if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 80) {
    return NextResponse.json({ error: "Invalid title" }, { status: 400 })
  }

  if (typeof templateBody !== "string" || templateBody.trim().length < 10 || templateBody.trim().length > 3000) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  if (typeof decision !== "string" || !["approved", "denied", "closed"].includes(decision)) {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 })
  }

  const serviceSupabase = await createServiceRoleClient()
  const { data, error } = await serviceSupabase
    .from("moderation_decision_templates")
    .insert({
      server_id: serverId,
      title: title.trim(),
      body: templateBody.trim(),
      decision: decision as "approved" | "denied" | "closed",
      created_by: auth.user.id,
    })
    .select("id, title, body, decision")
    .single()

  if (error) return NextResponse.json({ error: "Failed to create appeal template" }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
  } catch (err) {
    console.error("[servers/[serverId]/appeal-templates POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
