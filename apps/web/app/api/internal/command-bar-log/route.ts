import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

interface CommandBarTelemetryPayload {
  eventType?: "action" | "discoverability"
  payload?: Record<string, unknown>
  channelId?: string
  serverId?: string
  timestamp?: number
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = (await request.json()) as CommandBarTelemetryPayload
    if (!body.eventType || !body.channelId || !body.serverId) {
      return NextResponse.json({ error: "Invalid telemetry payload" }, { status: 400 })
    }

    console.info("channel_command_bar_telemetry", {
      eventType: body.eventType,
      payload: body.payload ?? {},
      channelId: body.channelId,
      serverId: body.serverId,
      timestamp: body.timestamp ?? Date.now(),
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Failed to record telemetry" }, { status: 400 })
  }
}
