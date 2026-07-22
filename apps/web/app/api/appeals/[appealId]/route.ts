import { NextRequest, NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { aggregateMemberPermissions } from "@/lib/server-auth"
import { isTerminalAppealStatus, isValidAppealStatus, isValidAppealTransition } from "@/lib/appeals"
import { canModerate } from "@/lib/moderation-auth"
import { requireAuth, parseJsonBody, insertAuditLog } from "@/lib/utils/api-helpers"
import { sendPushToUser } from "@/lib/push"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ appealId: string }> }
): Promise<NextResponse> {
  try {
  const { appealId } = await params
  const { supabase, user, error: authError } = await requireAuth()
  if (authError) return authError

  const { data: appeal, error } = await supabase
    .from("moderation_appeals")
    .select("*")
    .eq("id", appealId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: "Failed to fetch appeal" }, { status: 500 })
  if (!appeal) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data: member } = await supabase
    .from("server_members")
    .select("member_roles(roles(permissions))")
    .eq("server_id", appeal.server_id)
    .eq("user_id", user.id)
    .maybeSingle()

  const memberWithRoles = member as { member_roles?: Array<{ roles: { permissions: number } | null }> } | null
  const permissions = aggregateMemberPermissions(memberWithRoles?.member_roles)
  const isModerator = canModerate(permissions)
  const isOwner = appeal.user_id === user.id

  if (!isOwner && !isModerator) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const serviceSupabase = await createServiceRoleClient()
  const notesPromise = isModerator
    ? serviceSupabase
        .from("moderation_appeal_internal_notes")
        .select("id, author_id, note, created_at")
        .eq("appeal_id", appealId)
        .order("created_at", { ascending: false })
    : Promise.resolve({ data: [] as Record<string, unknown>[] })

  const eventsPromise = serviceSupabase
    .from("moderation_appeal_status_events")
    .select("id, actor_id, previous_status, new_status, metadata, created_at")
    .eq("appeal_id", appealId)
    .order("created_at", { ascending: false })

  const [notesResult, eventsResult] = await Promise.all([notesPromise, eventsPromise])

  return NextResponse.json({
    appeal,
    internalNotes: notesResult.data ?? [],
    statusEvents: eventsResult.data ?? [],
  })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ appealId: string }> }
): Promise<NextResponse> {
  try {
  const { appealId } = await params
  const { supabase, user, error: authError } = await requireAuth()
  if (authError) return authError

  const serviceSupabase = await createServiceRoleClient()
  const { data: appeal, error } = await serviceSupabase
    .from("moderation_appeals")
    .select("id, server_id, user_id, status")
    .eq("id", appealId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: "Failed to fetch appeal" }, { status: 500 })
  if (!appeal) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data: member } = await supabase
    .from("server_members")
    .select("member_roles(roles(permissions))")
    .eq("server_id", appeal.server_id)
    .eq("user_id", user.id)
    .maybeSingle()

  const memberWithRoles = member as { member_roles?: Array<{ roles: { permissions: number } | null }> } | null
  const permissions = aggregateMemberPermissions(memberWithRoles?.member_roles)
  if (!canModerate(permissions)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data: body, error: parseError } = await parseJsonBody(req)
  if (parseError) return parseError

  const parsed = body as {
    status?: unknown
    assignReviewerId?: unknown
    internalNote?: unknown
    decisionTemplateId?: unknown
    decisionReason?: unknown
  }

  const nextStatus = typeof parsed.status === "string" ? parsed.status : undefined
  const assignReviewerId = typeof parsed.assignReviewerId === "string" ? parsed.assignReviewerId : undefined
  const internalNote = typeof parsed.internalNote === "string" ? parsed.internalNote.trim() : ""
  const decisionTemplateId = typeof parsed.decisionTemplateId === "string" ? parsed.decisionTemplateId : null
  const decisionReason = typeof parsed.decisionReason === "string" ? parsed.decisionReason : null

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (assignReviewerId) updatePayload.assigned_reviewer_id = assignReviewerId

  if (nextStatus) {
    if (!isValidAppealStatus(nextStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
    if (!isValidAppealStatus(appeal.status)) {
      return NextResponse.json({ error: "Invalid current status" }, { status: 500 })
    }
    if (!isValidAppealTransition(appeal.status, nextStatus)) {
      return NextResponse.json({ error: "Invalid state transition" }, { status: 409 })
    }

    updatePayload.status = nextStatus
    if (isTerminalAppealStatus(nextStatus)) updatePayload.closed_at = new Date().toISOString()
    if (decisionTemplateId) updatePayload.decision_template_id = decisionTemplateId
    if (decisionReason) updatePayload.decision_reason = decisionReason
  }

  const { error: updateError } = await serviceSupabase
    .from("moderation_appeals")
    .update(updatePayload)
    .eq("id", appealId)

  if (updateError) return NextResponse.json({ error: "Failed to update appeal" }, { status: 500 })

  if (internalNote) {
    const { error: noteError } = await serviceSupabase.from("moderation_appeal_internal_notes").insert({
      appeal_id: appealId,
      server_id: appeal.server_id,
      author_id: user.id,
      note: internalNote,
    })

    if (noteError) {
      console.warn("Failed appeal internal note insert", { appealId, moderatorId: user.id, action: "internal_note", error: noteError })
      return NextResponse.json({ error: "Failed to save internal note" }, { status: 500 })
    }
  }

  if (nextStatus) {
    const { error: statusEventError } = await serviceSupabase.from("moderation_appeal_status_events").insert({
      appeal_id: appealId,
      server_id: appeal.server_id,
      actor_id: user.id,
      previous_status: appeal.status,
      new_status: nextStatus as typeof appeal.status,
      metadata: {
        decisionTemplateId,
      },
    })

    if (statusEventError) {
      console.warn("Failed appeal status event insert", { appealId, moderatorId: user.id, action: "status_update", error: statusEventError })
      return NextResponse.json({ error: "Failed to write status event" }, { status: 500 })
    }

    const { error: auditError } = await insertAuditLog(serviceSupabase, {
      server_id: appeal.server_id,
      actor_id: user.id,
      action: "appeal_status_changed",
      target_id: appealId,
      target_type: "appeal",
      changes: { from: appeal.status, to: nextStatus },
    })

    if (auditError) {
      console.warn("Failed appeal audit log insert", { appealId, moderatorId: user.id, action: "status_update", error: auditError })
      return NextResponse.json({ error: "Failed to write audit log" }, { status: 500 })
    }

    const { error: notificationError } = await serviceSupabase.from("notifications").insert([
      {
        user_id: appeal.user_id,
        type: "system",
        title: "Appeal updated",
        body: `Your appeal status is now ${nextStatus}.`,
        server_id: appeal.server_id,
      },
      {
        user_id: user.id,
        type: "system",
        title: "Appeal status changed",
        body: `Appeal ${appealId} moved to ${nextStatus}.`,
        server_id: appeal.server_id,
      },
    ])

    if (notificationError) {
      console.warn("Failed appeal notification insert", { appealId, moderatorId: user.id, action: "status_update", error: notificationError })
      return NextResponse.json({ error: "Failed to send notifications" }, { status: 500 })
    }

    // Push notification to the appeal owner about the status change
    await sendPushToUser(appeal.user_id, {
      title: "Appeal updated",
      body: `Your appeal status is now ${nextStatus}.`,
      url: `/appeals`,
      tag: `appeal-${appealId}`,
    }).catch((err) => { console.error("Failed to send appeal push", err) })
  }

  return NextResponse.json({ message: "Appeal updated" })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
