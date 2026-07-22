import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const type = searchParams.get("type")
    const id = searchParams.get("id")
    if (!type || !id) return NextResponse.json({ error: "type and id required" }, { status: 400 })

    if (type === "task") {
      const { data, error } = await supabase.from("channel_tasks").select("id, title, status, due_date, channel_id").eq("id", id).single()
      if (error) {
        console.error("[workspace/reference GET] task lookup error:", error.message)
        return NextResponse.json({ error: "Reference not found" }, { status: 404 })
      }
      return NextResponse.json({ reference: data })
    }

    if (type === "doc") {
      const { data, error } = await supabase.from("channel_docs").select("id, title, updated_at, channel_id").eq("id", id).single()
      if (error) {
        console.error("[workspace/reference GET] doc lookup error:", error.message)
        return NextResponse.json({ error: "Reference not found" }, { status: 404 })
      }
      return NextResponse.json({ reference: data })
    }

    return NextResponse.json({ error: "unsupported type" }, { status: 400 })

  } catch (err) {
    console.error("[workspace/reference GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
