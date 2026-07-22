import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { untypedFrom } from "@/lib/supabase/untyped-table"

function formatIcalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"
}

function escapeIcal(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n")
}

export async function GET(
  _request: Request,
  { params: paramsPromise }: { params: Promise<{ serverId: string; eventId: string }> }
) {
  try {
    const params = await paramsPromise
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // New columns (external_url, banner_url, event_type) added by migration
    // 00060_events_enhancements.sql are not yet in the generated Supabase types.
    // Cast via unknown to satisfy TypeScript while preserving runtime correctness.
    const { data: event } = await untypedFrom(supabase, "events")
      .select("id, title, description, location, start_at, end_at, server_id")
      .eq("id", params.eventId)
      .eq("server_id", params.serverId)
      .single() as { data: {
        id: string
        title: string
        description: string | null
        location?: string | null
        start_at: string
        end_at: string | null
        server_id: string
        external_url?: string | null
      } | null }

    // Re-fetch external_url separately via raw RPC to avoid type-gen issues
    let externalUrl: string | null = null
    if (event) {
      // external_url column from migration 00060 is not yet in generated types
      const { data: extra } = await untypedFrom(supabase, "events")
        .select("external_url")
        .eq("id", params.eventId)
        .single() as { data: { external_url?: string | null } | null }
      externalUrl = extra?.external_url ?? null
    }

    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

    const start = new Date(event.start_at)
    const end = event.end_at ? new Date(event.end_at) : new Date(start.getTime() + 60 * 60 * 1000)
    const uid = `${event.id}@vortexchat`
    const url = externalUrl ?? `${process.env.NEXT_PUBLIC_APP_URL ?? "https://vortexchat.app"}/channels/${params.serverId}/events`

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//VortexChat//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTART:${formatIcalDate(start)}`,
      `DTEND:${formatIcalDate(end)}`,
      `SUMMARY:${escapeIcal(event.title)}`,
      event.location ? `LOCATION:${escapeIcal(event.location)}` : "",
      event.description ? `DESCRIPTION:${escapeIcal(event.description)}` : "",
      `URL:${url}`,
      `DTSTAMP:${formatIcalDate(new Date())}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .filter(Boolean)
      .join("\r\n")

    return new NextResponse(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(event.title)}.ics"`,
      },
    })

  } catch (err) {
    console.error("[servers/[serverId]/events/[eventId]/ical GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
