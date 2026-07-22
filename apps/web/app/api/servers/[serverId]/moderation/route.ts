/**
 * GET  /api/servers/[serverId]/moderation  – fetch moderation settings
 * PATCH /api/servers/[serverId]/moderation – update moderation settings
 *
 * Only the server owner may read or change these settings.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireServerOwner } from "@/lib/server-auth"
import { parseJsonBody, insertAuditLog } from "@/lib/utils/api-helpers"
import type { Json } from "@/types/database"

type Params = { params: Promise<{ serverId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const { supabase, error } = await requireServerOwner(serverId)
    if (error) return error

    const { data, error: dbErr } = await supabase
      .from("servers")
      .select("verification_level, explicit_content_filter, default_message_notifications, screening_enabled, automod_dry_run, automod_emergency_disable, join_role_id")
      .eq("id", serverId)
      .single()

    if (dbErr) {
      console.error("[servers/[serverId]/moderation GET] db error:", dbErr.message)
      return NextResponse.json({ error: "Failed to fetch moderation settings" }, { status: 500 })
    }
    return NextResponse.json(data)

  } catch (err) {
    console.error("[servers/[serverId]/moderation GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const { supabase, user, error } = await requireServerOwner(serverId)
    if (error) return error

    const { data: body, error: parseError } = await parseJsonBody<Record<string, unknown>>(req)
    if (parseError) return parseError

    const updates: Record<string, unknown> = {}

    // Validate each field against its expected type and range before persisting.
    if ("verification_level" in body) {
      const v = body.verification_level
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 4) {
        return NextResponse.json({ error: "verification_level must be an integer 0–4" }, { status: 400 })
      }
      updates.verification_level = v
    }
    if ("explicit_content_filter" in body) {
      const v = body.explicit_content_filter
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 2) {
        return NextResponse.json({ error: "explicit_content_filter must be an integer 0–2" }, { status: 400 })
      }
      updates.explicit_content_filter = v
    }
    if ("default_message_notifications" in body) {
      const v = body.default_message_notifications
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 1) {
        return NextResponse.json({ error: "default_message_notifications must be an integer 0–1" }, { status: 400 })
      }
      updates.default_message_notifications = v
    }
    if ("screening_enabled" in body) {
      const v = body.screening_enabled
      if (typeof v !== "boolean") {
        return NextResponse.json({ error: "screening_enabled must be a boolean" }, { status: 400 })
      }
      updates.screening_enabled = v
    }
    if ("automod_dry_run" in body) {
      const v = body.automod_dry_run
      if (typeof v !== "boolean") {
        return NextResponse.json({ error: "automod_dry_run must be a boolean" }, { status: 400 })
      }
      updates.automod_dry_run = v
    }
    if ("automod_emergency_disable" in body) {
      const v = body.automod_emergency_disable
      if (typeof v !== "boolean") {
        return NextResponse.json({ error: "automod_emergency_disable must be a boolean" }, { status: 400 })
      }
      updates.automod_emergency_disable = v
    }
    if ("join_role_id" in body) {
      const v = body.join_role_id
      if (v !== null && typeof v !== "string") {
        return NextResponse.json({ error: "join_role_id must be a UUID string or null" }, { status: 400 })
      }
      updates.join_role_id = v
    }

    if (Object.keys(updates).length === 0)
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })

    const { error: dbErr } = await supabase.from("servers").update(updates).eq("id", serverId)
    if (dbErr) {
      console.error("[servers/[serverId]/moderation PATCH] db error:", dbErr.message)
      return NextResponse.json({ error: "Failed to update moderation settings" }, { status: 500 })
    }

    // Audit log
    await insertAuditLog(supabase, {
      server_id: serverId,
      actor_id: user!.id,
      action: "moderation_settings_updated",
      target_id: serverId,
      target_type: "server",
      changes: updates as Record<string, Json | undefined>,
    })

    return NextResponse.json({ message: "Moderation settings updated" })

  } catch (err) {
    console.error("[servers/[serverId]/moderation PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
