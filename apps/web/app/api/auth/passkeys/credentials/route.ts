import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { untypedFrom } from "@/lib/supabase/untyped-table"

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data, error } = await untypedFrom(supabase, "passkey_credentials")
      .select("id,name,created_at,last_used_at,device_type,backed_up,revoked_at")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })

    if (error) return NextResponse.json({ error: "Failed to process passkey request" }, { status: 400 })
    return NextResponse.json({ credentials: data })

  } catch (err) {
    console.error("[auth/passkeys/credentials GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id, name } = (await request.json()) as { id?: string; name?: string }
    if (!id || !name?.trim()) return NextResponse.json({ error: "id and name are required" }, { status: 400 })

    const { error } = await untypedFrom(supabase, "passkey_credentials")
      .update({ name: name.trim() })
      .eq("id", id)
      .eq("user_id", auth.user.id)

    if (error) return NextResponse.json({ error: "Failed to process passkey request" }, { status: 400 })
    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[auth/passkeys/credentials PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = (await request.json()) as { id?: string }
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const { error } = await untypedFrom(supabase, "passkey_credentials")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", auth.user.id)

    if (error) return NextResponse.json({ error: "Failed to process passkey request" }, { status: 400 })
    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[auth/passkeys/credentials DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
