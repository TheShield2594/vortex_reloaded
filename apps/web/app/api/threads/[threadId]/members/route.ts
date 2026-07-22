import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

interface Params {
  params: Promise<{ threadId: string }>
}

// GET /api/threads/[threadId]/members
export async function GET(_request: Request, { params: paramsPromise }: Params) {
  try {
    const { threadId } = await paramsPromise
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: members, error } = await supabase
      .from("thread_members")
      .select(`*, user:users(*)`)
      .eq("thread_id", threadId)

    if (error) return NextResponse.json({ error: "Failed to fetch thread members" }, { status: 500 })

    return NextResponse.json(members ?? [])

  } catch (err) {
    console.error("[threads/[threadId]/members GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/threads/[threadId]/members — join thread
export async function POST(_request: Request, { params: paramsPromise }: Params) {
  try {
    const { threadId } = await paramsPromise
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Check thread exists and is not locked
    const { data: thread } = await supabase
      .from("threads")
      .select("id, locked")
      .eq("id", threadId)
      .single()

    if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    if (thread.locked) return NextResponse.json({ error: "Thread is locked" }, { status: 403 })

    const { error } = await supabase
      .from("thread_members")
      .insert({ thread_id: threadId, user_id: user.id })

    if (error && error.code !== "23505") {
      // 23505 = unique violation (already a member) — not an error
      return NextResponse.json({ error: "Failed to join thread" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[threads/[threadId]/members POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/threads/[threadId]/members — leave thread
export async function DELETE(_request: Request, { params: paramsPromise }: Params) {
  try {
    const { threadId } = await paramsPromise
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { error } = await supabase
      .from("thread_members")
      .delete()
      .eq("thread_id", threadId)
      .eq("user_id", user.id)

    if (error) return NextResponse.json({ error: "Failed to leave thread" }, { status: 500 })

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[threads/[threadId]/members DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
