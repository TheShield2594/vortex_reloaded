/**
 * GET  /api/users/badges?userId=<id>  — fetch badges for a specific user
 * POST /api/users/badges              — award a badge (service role only)
 * DELETE /api/users/badges?userId=<id>&badgeId=<id> — revoke a badge (service role only)
 */
import { type NextRequest, NextResponse } from "next/server"
import { requireAuthWithServiceRole } from "@/lib/utils/api-helpers"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get("userId")
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 })
    }

    const supabase = await createServerSupabaseClient()

    const { data: badges, error } = await supabase
      .from("user_badges")
      .select("*, badge:badge_definitions(*)")
      .eq("user_id", userId)
      .order("awarded_at", { ascending: false })

    if (error) {
      return NextResponse.json({ error: "Failed to fetch user badges" }, { status: 500 })
    }

    return NextResponse.json(badges)
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { serviceSupabase, user, error: authError } = await requireAuthWithServiceRole()
    if (authError || !serviceSupabase || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { userId, badgeId } = body as { userId?: string; badgeId?: string }
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }
    if (!badgeId || typeof badgeId !== "string") {
      return NextResponse.json({ error: "badgeId is required" }, { status: 400 })
    }

    // Validate badge exists
    const { data: badgeDef } = await serviceSupabase
      .from("badge_definitions")
      .select("id")
      .eq("id", badgeId)
      .single()

    if (!badgeDef) {
      return NextResponse.json({ error: "Badge not found" }, { status: 404 })
    }

    // Award the badge
    const { data: awarded, error: insertError } = await serviceSupabase
      .from("user_badges")
      .insert({
        user_id: userId,
        badge_id: badgeId,
        awarded_by: user.id,
      })
      .select("*, badge:badge_definitions(*)")
      .single()

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json({ error: "User already has this badge" }, { status: 409 })
      }
      return NextResponse.json({ error: "Failed to award badge" }, { status: 500 })
    }

    return NextResponse.json(awarded, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { serviceSupabase, user, error: authError } = await requireAuthWithServiceRole()
    if (authError || !serviceSupabase || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get("userId")
    const badgeId = searchParams.get("badgeId")

    if (!userId || !badgeId) {
      return NextResponse.json({ error: "userId and badgeId are required" }, { status: 400 })
    }

    const { error: deleteError } = await serviceSupabase
      .from("user_badges")
      .delete()
      .eq("user_id", userId)
      .eq("badge_id", badgeId)

    if (deleteError) {
      return NextResponse.json({ error: "Failed to revoke badge" }, { status: 500 })
    }

    return NextResponse.json({ message: "Badge revoked" })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
