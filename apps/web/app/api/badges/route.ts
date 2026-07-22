/**
 * GET /api/badges — list all badge definitions (public catalog)
 */
import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/badges")

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()

    const { data: badges, error } = await supabase
      .from("badge_definitions")
      .select("*")
      .order("sort_order", { ascending: true })

    if (error) {
      log.error({ err: error.message }, "Failed to fetch badge definitions")
      return NextResponse.json({ error: "Failed to fetch badges" }, { status: 500 })
    }

    return NextResponse.json(badges)
  } catch (err) {
    log.error({ err }, "Unexpected error in GET /api/badges")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
