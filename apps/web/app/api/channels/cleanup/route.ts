import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"

/**
 * POST /api/channels/cleanup
 *
 * Deletes all channels whose `expires_at` timestamp is in the past.
 * Should be called periodically (e.g. every minute) by a cron job or
 * an external scheduler. Protect with CRON_SECRET env var.
 *
 * Returns: { deleted: number }
 */
export async function POST(request: Request) {
  // Fail closed: reject all requests when CRON_SECRET is not configured
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const supabase = await createServiceRoleClient()
    const { data, error } = await supabase.rpc("delete_expired_channels")
    if (error) throw error

    return NextResponse.json({ deleted: data ?? 0 })
  } catch (err: unknown) {
    console.error("[channels/cleanup] Error deleting expired channels:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * GET /api/channels/cleanup
 *
 * This endpoint only supports POST. Returns 405 Method Not Allowed.
 */
export async function GET() {
  try {
    return NextResponse.json({ error: "Method Not Allowed. Use POST." }, { status: 405, headers: { Allow: "POST" } })

  } catch (err) {
    console.error("[channels/cleanup GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
