import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/utils/api-helpers"
import { buildICal } from "@/lib/events"

export async function GET(
  _request: Request,
  { params: paramsPromise }: { params: Promise<{ serverId: string }> }
) {
  try {
    const params = await paramsPromise
    const { supabase, error: authError } = await requireAuth()
    if (authError) return authError

    const { data: events, error } = await supabase
      .from("events")
      .select("id,title,description,location,timezone,start_at,end_at,recurrence,recurrence_until,capacity,cancelled_at")
      .eq("server_id", params.serverId)
      .is("cancelled_at", null)
      .order("start_at", { ascending: true })

    if (error) return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 })

    const body = buildICal(events ?? [])

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename=server-${params.serverId}-events.ics`,
      },
    })

  } catch (err) {
    console.error("[servers/[serverId]/events/ical GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
