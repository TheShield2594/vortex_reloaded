import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { issueStepUpToken } from "@/lib/auth/step-up"

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await request.json().catch(() => ({}))) as { currentPassword?: string }
    if (!body.currentPassword) {
      return NextResponse.json({ error: "currentPassword is required" }, { status: 400 })
    }

    const email = auth.user.email
    if (!email) return NextResponse.json({ error: "Email not found" }, { status: 400 })

    const { createClient } = await import("@supabase/supabase-js")
    const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

    const { error } = await verifier.auth.signInWithPassword({ email, password: body.currentPassword })
    await verifier.auth.signOut().catch(() => undefined)

    if (error) return NextResponse.json({ error: "Step-up verification failed" }, { status: 401 })

    await issueStepUpToken(auth.user.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
