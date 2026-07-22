import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { untypedFrom } from "@/lib/supabase/untyped-table"

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data } = await untypedFrom(supabase, "auth_security_policies")
      .select("passkey_first,enforce_passkey,fallback_password,fallback_magic_link")
      .eq("user_id", auth.user.id)
      .maybeSingle()

    return NextResponse.json({
      policy: data || {
        passkey_first: false,
        enforce_passkey: false,
        fallback_password: true,
        fallback_magic_link: true,
      },
    })

  } catch (err) {
    console.error("[auth/security/policy GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const patch = await request.json()
    const { error } = await untypedFrom(supabase, "auth_security_policies").upsert({
      user_id: auth.user.id,
      passkey_first: !!patch.passkey_first,
      enforce_passkey: !!patch.enforce_passkey,
      fallback_password: patch.fallback_password !== false,
      fallback_magic_link: patch.fallback_magic_link !== false,
    })

    if (error) {
      console.error("[auth/security/policy PATCH] db error:", error.message)
      return NextResponse.json({ error: "Failed to update security policy" }, { status: 500 })
    }
    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[auth/security/policy PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
