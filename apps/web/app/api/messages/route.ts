import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/utils/api-helpers"
import { rateLimiter } from "@/lib/rate-limit"
import { sendPushToChannel } from "@/lib/push"
import { publishGatewayEvent } from "@/lib/gateway-publish"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/messages")
import {
  evaluateAllRules,
  shouldBlockMessage,
  shouldQuarantineMessage,
  getTimeoutDuration,
  getAlertChannels,
} from "@/lib/automod"
import { SYSTEM_BOT_ID } from "@/lib/server-auth"
import type { AutoModRuleWithParsed } from "@/types/database"
import { getChannelPermissions, hasPermission } from "@/lib/permissions"
import { filterMentionsByBlockState } from "@/lib/blocking"
import { validateAttachments, validateAttachmentContent } from "@/lib/attachment-validation"
import { MESSAGE_PROJECTION, withReplyTo, type ServerSupabaseClient } from "@/lib/messages/hydration"
import { parsePostMessageRequestBody, type MessageAttachment, type PostMessageRequestBody } from "@/lib/messages/validators"
import { computeDecay } from "@vortex/shared"
import { isProcessableImage, processAttachmentImage } from "@/lib/image-processing"
import { validateChannelTypeMessagePolicy, type SupportedMessageChannelType } from "@/lib/messages/channel-type-policy"
import { cached } from "@/lib/server-cache"
async function getChannelForRead(supabase: ServerSupabaseClient, channelId: string, userId: string) {
  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id, server_id")
    .eq("id", channelId)
    .single()

  if (channelError || !channel) {
    return { error: NextResponse.json({ error: "Channel not found" }, { status: 404 }) }
  }

  if (channel.server_id) {
    const { isAdmin, permissions } = await getChannelPermissions(supabase, channel.server_id, channel.id, userId)
    if (!isAdmin && !hasPermission(permissions, "VIEW_CHANNELS")) {
      return { error: NextResponse.json({ error: "Missing VIEW_CHANNELS permission" }, { status: 403 }) }
    }
  }

  return { channel }
}

async function getMessagesAroundTarget(supabase: ServerSupabaseClient, channelId: string, around: string, limit: number) {
  const { data: target } = await supabase
    .from("messages")
    .select("id, channel_id, created_at")
    .eq("id", around)
    .eq("channel_id", channelId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!target) {
    return { error: NextResponse.json({ error: "Message not found" }, { status: 404 }) }
  }

  const sideLimit = Math.max(1, Math.min(limit, 60))
  const [{ data: beforeRows, error: beforeError }, { data: afterRows, error: afterError }] = await Promise.all([
    supabase
      .from("messages")
      .select(MESSAGE_PROJECTION)
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .lt("created_at", target.created_at)
      .order("created_at", { ascending: false })
      .limit(sideLimit + 1),
    supabase
      .from("messages")
      .select(MESSAGE_PROJECTION)
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .gte("created_at", target.created_at)
      .order("created_at", { ascending: true })
      .limit(sideLimit + 1),
  ])

  if (beforeError || afterError) {
    log.error({ route: "/api/messages", action: "getMessagesAround", channelId, error: beforeError?.message ?? afterError?.message }, "around query error")
    return { error: NextResponse.json({ error: "Failed to load message context" }, { status: 500 }) }
  }

  const hasMoreBefore = (beforeRows?.length ?? 0) > sideLimit
  const hasMoreAfter = (afterRows?.length ?? 0) > sideLimit
  const trimmedBefore = (beforeRows ?? []).slice(0, sideLimit).reverse()
  const trimmedAfter = (afterRows ?? []).slice(0, sideLimit)

  const deduped = [...trimmedBefore, ...trimmedAfter].filter((message, index, all) =>
    all.findIndex((candidate) => candidate.id === message.id) === index
  )

  return {
    data: {
      messages: await withReplyTo(supabase, deduped),
      hasMoreBefore,
      hasMoreAfter,
    },
  }
}

async function resolveSafeMentions(supabase: ServerSupabaseClient, userId: string, mentions: string[]) {
  try {
    const filteredMentions = await filterMentionsByBlockState(supabase, userId, mentions)
    return { safeMentions: filteredMentions.allowed }
  } catch (error) {
    log.error({ route: "/api/messages", action: "resolveMentions", userId, error: error instanceof Error ? error.message : error }, "mention validation error")
    return {
      error: NextResponse.json(
        { error: "Failed to validate mentions" },
        { status: 400 }
      ),
    }
  }
}

/** Check screening + timeout status. Permissions are resolved externally to avoid duplicate queries. */
async function enforceServerMessagingGuards({
  supabase,
  serverId,
  userId,
  screeningEnabled,
}: {
  supabase: ServerSupabaseClient
  serverId: string
  userId: string
  screeningEnabled: boolean
}) {
  const [screeningResult, timeoutResult] = await Promise.all([
    screeningEnabled
      ? supabase
          .from("member_screening")
          .select("accepted_at")
          .eq("server_id", serverId)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("member_timeouts")
      .select("timed_out_until")
      .eq("server_id", serverId)
      .eq("user_id", userId)
      .maybeSingle(),
  ])

  if (screeningEnabled && !screeningResult.data) {
    return {
      error: NextResponse.json(
        { error: "You must accept the server rules before sending messages.", code: "SCREENING_REQUIRED" },
        { status: 403 }
      ),
    }
  }

  const timeout = timeoutResult.data
  if (timeout && new Date(timeout.timed_out_until) > new Date()) {
    return {
      error: NextResponse.json(
        {
          error: `You are timed out until ${new Date(timeout.timed_out_until).toISOString()}.`,
          code: "TIMED_OUT",
          until: timeout.timed_out_until,
        },
        { status: 403 }
      ),
    }
  }

  return { error: null }
}

async function enforceSlowmode({
  supabase,
  channelId,
  userId,
  slowmodeDelay,
}: {
  supabase: ServerSupabaseClient
  channelId: string
  userId: string
  slowmodeDelay: number
}) {
  if (slowmodeDelay <= 0) {
    return { error: null }
  }

  const { data: lastMsg } = await supabase
    .from("messages")
    .select("created_at")
    .eq("channel_id", channelId)
    .eq("author_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()

  if (!lastMsg) {
    return { error: null }
  }

  const elapsedMs = Date.now() - new Date(lastMsg.created_at).getTime()
  const cooldownMs = slowmodeDelay * 1000
  if (elapsedMs >= cooldownMs) {
    return { error: null }
  }

  const retryAfter = Math.ceil((cooldownMs - elapsedMs) / 1000)
  return {
    error: NextResponse.json(
      { error: `Slowmode: wait ${retryAfter}s before sending again.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    ),
  }
}

async function runServerAutomodChecks({
  supabase,
  serverId,
  channelId,
  user,
  content,
  mentions,
}: {
  supabase: ServerSupabaseClient
  serverId: string
  channelId: string
  user: { id: string; created_at: string }
  content: string
  mentions: string[]
}): Promise<NextResponse | null> {
  // All three are cached — typically 0ms on hot path
  const [settingsData, rolesData, rawRules] = await Promise.all([
    cached(`automod-settings:${serverId}`, async () => {
      const { data } = await supabase.from("servers").select("automod_dry_run, automod_emergency_disable").eq("id", serverId).maybeSingle()
      return (data ?? {}) as { automod_dry_run?: boolean; automod_emergency_disable?: boolean }
    }, 60_000),
    cached(`member-roles:${serverId}:${user.id}`, async () => {
      const { data } = await supabase.from("member_roles").select("role_id").eq("server_id", serverId).eq("user_id", user.id)
      return (data ?? []).map((r: { role_id: string }) => r.role_id) as string[]
    }, 30_000),
    cached(`automod-rules:${serverId}`, async () => {
      const { data } = await supabase.from("automod_rules")
        .select("id, name, trigger_type, config, conditions, actions, enabled, priority")
        .eq("server_id", serverId).eq("enabled", true)
        .order("priority", { ascending: true }).order("created_at", { ascending: true })
      return data ?? []
    }, 60_000),
  ])

  if (settingsData.automod_emergency_disable) {
    return null
  }

  if (!rawRules?.length) {
    return null
  }

  const resolvedRoleIds = rolesData

  const earliestWindowSeconds = rawRules.reduce((acc, rule) => {
    const cfg = (rule.config && typeof rule.config === "object" && !Array.isArray(rule.config) ? rule.config : {}) as Record<string, unknown>
    const windowSeconds = typeof cfg.window_seconds === "number" ? cfg.window_seconds : null
    if (!windowSeconds) return acc
    if (acc === null) return windowSeconds
    return Math.max(acc, windowSeconds)
  }, null as number | null)

  let recentMessageCount = 0
  if (earliestWindowSeconds) {
    const since = new Date(Date.now() - earliestWindowSeconds * 1000).toISOString()
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channelId)
      .eq("author_id", user.id)
      .gte("created_at", since)
    recentMessageCount = count ?? 0
  }

  const accountAgeMinutes = Math.floor((Date.now() - new Date(user.created_at).getTime()) / 60_000)
  const rules: AutoModRuleWithParsed[] = rawRules.reduce<AutoModRuleWithParsed[]>((acc, r) => {
    if (!r || typeof r !== "object") return acc
    const config =
      r.config && typeof r.config === "object" && !Array.isArray(r.config) ? r.config : {}
    const conditions =
      r.conditions && typeof r.conditions === "object" && !Array.isArray(r.conditions)
        ? r.conditions
        : {}
    const actions = Array.isArray(r.actions)
      ? (r.actions as unknown[]).filter((a): a is Record<string, unknown> => {
          if (!a || typeof a !== "object") return false
          return typeof (a as Record<string, unknown>).type === "string"
        })
      : []
    acc.push({ ...r, config, conditions, actions } as unknown as AutoModRuleWithParsed)
    return acc
  }, [])

  const violations = evaluateAllRules(rules, content.trim(), mentions, {
    channelId,
    memberRoleIds: resolvedRoleIds,
    accountAgeMinutes,
    recentMessageCount,
  })

  if (violations.length === 0) {
    return null
  }

  const blocked = shouldBlockMessage(violations)
  const quarantined = shouldQuarantineMessage(violations)
  const dryRun = Boolean(settingsData?.automod_dry_run)

  const { error: auditErr } = await supabase.from("audit_logs").insert({
    server_id: serverId,
    actor_id: user.id,
    action: dryRun ? "automod_dry_run" : blocked ? "automod_block" : "automod_action",
    target_id: user.id,
    target_type: "user",
    changes: {
      channel_id: channelId,
      blocked,
      quarantined,
      dry_run: dryRun,
      violations: violations.map((v) => ({ rule_id: v.rule_id, rule_name: v.rule_name, reason: v.reason })),
    },
  })
  if (auditErr) {
    log.error({ serverId, userId: user.id, action: dryRun ? "automod_dry_run" : blocked ? "automod_block" : "automod_action", error: auditErr.message }, "automod audit log insert failed")
  }

  await Promise.all(
    violations.map((violation) =>
      supabase.rpc("increment_automod_rule_hit", { p_rule_id: violation.rule_id })
    )
  )

  const timeoutDuration = getTimeoutDuration(violations)
  if (timeoutDuration && !dryRun) {
    const until = new Date(Date.now() + timeoutDuration * 1000).toISOString()
    await supabase.from("member_timeouts").upsert(
      {
        server_id: serverId,
        user_id: user.id,
        timed_out_until: until,
        moderator_id: null,
        reason: `AutoMod: ${violations[0].reason}`,
        created_at: new Date().toISOString(),
      },
      { onConflict: "server_id,user_id" }
    )

    const { error: timeoutAuditErr } = await supabase.from("audit_logs").insert({
      server_id: serverId,
      actor_id: null,
      action: "automod_timeout",
      target_id: user.id,
      target_type: "user",
      changes: { duration_seconds: timeoutDuration, reason: violations[0].reason },
    })
    if (timeoutAuditErr) {
      log.error({ serverId, userId: user.id, error: timeoutAuditErr.message }, "automod timeout audit log insert failed")
    }
  }

  const alertChannels = getAlertChannels(violations)
  if (alertChannels.length > 0 && !dryRun) {
    createServiceRoleClient()
      .then((serviceSupabase) => {
        Promise.all(
          alertChannels.map((alertChannelId) =>
            serviceSupabase
              .from("messages")
              .insert({
                channel_id: alertChannelId,
                author_id: SYSTEM_BOT_ID,
                content: `⚠️ AutoMod flagged a message from <@${user.id}>: ${violations[0].reason}`,
                mentions: [],
                mention_everyone: false,
              })
              .then(async () => {
                const { error: alertAuditErr } = await supabase.from("audit_logs").insert({
                  server_id: serverId,
                  actor_id: null,
                  action: "automod_alert",
                  target_id: user.id,
                  target_type: "user",
                  changes: { channel_id: alertChannelId, reason: violations[0].reason },
                })
                if (alertAuditErr) {
                  log.error({ serverId, channelId: alertChannelId, userId: user.id, error: alertAuditErr.message }, "automod alert audit log insert failed")
                }
              })
          )
        ).catch(() => {})
      })
      .catch(() => {})
  }

  if (!dryRun && (blocked || quarantined)) {
    return NextResponse.json(
      {
        error: blocked ? "Your message was blocked by AutoMod." : "Your message was quarantined for moderator review.",
        code: blocked ? "AUTOMOD_BLOCKED" : "AUTOMOD_QUARANTINED",
        reason: violations[0].reason,
      },
      { status: 403 }
    )
  }

  return null
}

async function insertMessageWithAttachments({
  supabase,
  channelId,
  userId,
  content,
  replyToId,
  safeMentions,
  mentionEveryone,
  clientNonce,
  attachments,
}: {
  supabase: ServerSupabaseClient
  channelId: string
  userId: string
  content?: string
  replyToId?: string
  safeMentions: string[]
  mentionEveryone: boolean
  clientNonce?: string
  attachments: MessageAttachment[]
}) {
  const { data: message, error: msgError } = await supabase
    .from("messages")
    .insert({
      channel_id: channelId,
      author_id: userId,
      content: content?.trim() || null,
      reply_to_id: replyToId || null,
      mentions: safeMentions,
      mention_everyone: mentionEveryone,
      client_nonce: clientNonce?.trim() || null,
    })
    .select(MESSAGE_PROJECTION)
    .single()

  if (msgError) {
    return { message: null, msgError }
  }

  if (attachments.length > 0 && message) {
    const now = new Date()
    const { data: insertedAttachments } = await supabase
      .from("attachments")
      .insert(
        attachments.map((a) => {
          const decay = computeDecay({ sizeBytes: a.size, uploadedAt: now })
          return {
            ...a,
            message_id: message.id,
            // Mark processable images as pending so the pipeline picks them up
            ...(isProcessableImage(a.content_type) ? { processing_state: "pending" as const } : {}),
            ...(decay
              ? {
                  expires_at: decay.expiresAt.toISOString(),
                  last_accessed_at: now.toISOString(),
                  lifetime_days: decay.days,
                  decay_cost: decay.cost,
                }
              : {}),
          }
        })
      )
      .select("id, filename, content_type, message_id, storage_path")

    // Fire-and-forget: trigger image processing for image attachments
    if (insertedAttachments?.length) {
      for (const att of insertedAttachments) {
        if (att.storage_path && isProcessableImage(att.content_type)) {
          processAttachmentImage(att.id, att.storage_path, att.content_type).catch((err) => {
            log.error({ route: "/api/messages", action: "processImage", attachmentId: att.id, error: err }, "image processing failed for attachment")
          })
        }
      }
    }
  }

  return { message, msgError: null }
}

export async function GET(request: Request) {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const { searchParams } = new URL(request.url)
    const channelId = searchParams.get("channelId")
    const before = searchParams.get("before")
    const around = searchParams.get("around")
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100)

    if (!channelId) {
      return NextResponse.json({ error: "channelId required" }, { status: 400 })
    }

    const { error: channelError } = await getChannelForRead(supabase, channelId, user.id)
    if (channelError) return channelError

    if (around) {
      const aroundResult = await getMessagesAroundTarget(supabase, channelId, around, limit)
      if (aroundResult.error) return aroundResult.error
      return NextResponse.json(aroundResult.data)
    }

    let query = supabase
      .from("messages")
      .select(MESSAGE_PROJECTION)
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (before) {
      query = query.lt("created_at", before)
    }

    const { data: messages, error } = await query

    if (error) return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })

    return NextResponse.json(await withReplyTo(supabase, (messages ?? []).reverse()))

  } catch (err) {
    log.error({ route: "/api/messages", action: "GET", error: err }, "GET error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
  const t0 = performance.now()
  const lap = (label: string) => {
    const elapsed = (performance.now() - t0).toFixed(1)
    log.debug({ elapsed, label }, "msg-send lap")
  }

  const { supabase, user, error: authError } = await requireAuth()
  if (authError) return authError
  lap("auth")

  let body: PostMessageRequestBody

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsedBody = parsePostMessageRequestBody(body)
  if (parsedBody.error) return parsedBody.error
  const { channelId, content, replyToId, mentions, mentionRoleIds, mentionEveryone, attachments, clientNonce } = parsedBody.payload

  const attachmentValidation = validateAttachments(attachments)
  if (!attachmentValidation.valid) {
    return NextResponse.json({ error: attachmentValidation.error }, { status: 400 })
  }

  // Client provides serverId so server-scoped queries can start alongside channel lookup
  const rawServerId = (body as Record<string, unknown>).serverId
  const clientServerId: string | null = typeof rawServerId === "string" && rawServerId ? rawServerId : null

  // --- Group 1: cached lookups + per-request checks ---
  // Channel metadata, permissions, and automod rules are cached (30-60s TTL).
  // Nonce, rate limit, and mentions are always fresh.
  const [channelData, idempotencyResult, rl, mentionResult, permResult] = await Promise.all([
    cached(`channel:${channelId}`, async () => {
      const { data } = await supabase.from("channels").select("slowmode_delay, server_id, type").eq("id", channelId).single()
      return data
    }, 30_000),
    clientNonce?.trim()
      ? supabase.from("messages").select(MESSAGE_PROJECTION).eq("channel_id", channelId).eq("author_id", user.id).eq("client_nonce", clientNonce.trim()).maybeSingle()
      : Promise.resolve({ data: null }),
    rateLimiter.check(`msg:${user.id}`, { limit: 5, windowMs: 10_000 }),
    mentions.length > 0
      ? resolveSafeMentions(supabase, user.id, mentions)
      : Promise.resolve({ safeMentions: [] as string[], error: undefined as NextResponse | undefined }),
    clientServerId
      ? cached(`perms:${clientServerId}:${channelId}:${user.id}`, () =>
          getChannelPermissions(supabase, clientServerId, channelId, user.id),
          30_000,
        )
      : Promise.resolve(null),
  ])
  lap("group-1 (channel+nonce+rl+mentions+perms)")

  const channel = channelData
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 })

  const serverId: string | null = channel.server_id ?? null
  if (clientServerId && serverId && clientServerId !== serverId) {
    return NextResponse.json({ error: "serverId mismatch" }, { status: 400 })
  }

  if (idempotencyResult.data) {
    const [hydrated] = await withReplyTo(supabase, [idempotencyResult.data])
    return NextResponse.json(hydrated, { status: 200 })
  }

  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You are sending messages too fast. Slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)), "X-RateLimit-Remaining": "0" } }
    )
  }

  if (mentionResult.error) return mentionResult.error
  const { safeMentions } = mentionResult

  if (attachments.length > 0) {
    const contentValidation = await validateAttachmentContent(attachments)
    if (!contentValidation.valid) {
      return NextResponse.json({ error: contentValidation.error }, { status: 400 })
    }
    lap("attachment-validation")
  }

  if (channel.type === "voice" || channel.type === "stage" || channel.type === "category") {
    return NextResponse.json({ error: "This channel type does not support text messages." }, { status: 400 })
  }

  const channelType = (channel.type ?? "text") as SupportedMessageChannelType

  // --- Permission + policy checks (using pre-fetched permissions) ---
  if (permResult) {
    if (!permResult.isAdmin && !hasPermission(permResult.permissions, "SEND_MESSAGES")) {
      return NextResponse.json({ error: "Missing SEND_MESSAGES permission" }, { status: 403 })
    }
    if (mentionEveryone && !permResult.isAdmin && !hasPermission(permResult.permissions, "MENTION_EVERYONE")) {
      return NextResponse.json({ error: "Missing MENTION_EVERYONE permission" }, { status: 403 })
    }
    const policy = validateChannelTypeMessagePolicy({
      channelType,
      hasSendPermission: permResult.isAdmin || hasPermission(permResult.permissions, "SEND_MESSAGES"),
      content, attachments,
    })
    if (policy.error) return NextResponse.json({ error: policy.error }, { status: policy.status })
  } else if (!serverId) {
    const policy = validateChannelTypeMessagePolicy({ channelType, hasSendPermission: true, content, attachments })
    if (policy.error) return NextResponse.json({ error: policy.error }, { status: policy.status })
  }

  // --- Group 2: guards + slowmode + automod (all parallel, lightweight) ---
  // Guards no longer calls getChannelPermissions (eliminated duplicate).
  // Automod fetches its own rules but member_roles/settings queries are cheap.
  const [guardResult, slowmodeResult, automodResponse] = await Promise.all([
    serverId
      ? enforceServerMessagingGuards({ supabase, serverId, userId: user.id, screeningEnabled: permResult?.screeningEnabled ?? false })
      : Promise.resolve({ error: null }),
    channel.slowmode_delay > 0
      ? enforceSlowmode({ supabase, channelId, userId: user.id, slowmodeDelay: channel.slowmode_delay })
      : Promise.resolve({ error: null }),
    serverId && content?.trim()
      ? runServerAutomodChecks({
          supabase, serverId, channelId,
          user: { id: user.id, created_at: user.created_at },
          content, mentions,
        })
      : Promise.resolve(null),
  ])
  lap("group-2 (guards+slowmode+automod)")

  if (guardResult.error) return guardResult.error
  if (slowmodeResult.error) return slowmodeResult.error
  if (automodResponse) return automodResponse

  // --- Insert message ---
  const { message, msgError } = await insertMessageWithAttachments({
    supabase,
    channelId,
    userId: user.id,
    content,
    replyToId,
    safeMentions,
    mentionEveryone,
    clientNonce,
    attachments,
  })
  lap("insert")

  if (msgError) {
    const isDuplicate = msgError.code === "23505" || /duplicate key/i.test(msgError.message ?? "")

    if (isDuplicate && clientNonce?.trim()) {
      const { data: existing } = await supabase
        .from("messages")
        .select(MESSAGE_PROJECTION)
        .eq("channel_id", channelId)
        .eq("author_id", user.id)
        .eq("client_nonce", clientNonce.trim())
        .maybeSingle()

      if (existing) {
        const [hydrated] = await withReplyTo(supabase, [existing])
        return NextResponse.json(hydrated, { status: 200 })
      }
    }

    log.error({ route: "/api/messages", action: "POST", userId: user.id, channelId, error: msgError.message }, "insert failed")
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 })
  }
  // --- Send push notifications (fire-and-forget) ---
  const messageWithAuthor = message as { author?: { display_name?: string; username?: string; avatar_url?: string | null } }
  const senderName = messageWithAuthor?.author?.display_name || messageWithAuthor?.author?.username || "Someone"
  const senderAvatarUrl = messageWithAuthor?.author?.avatar_url ?? null

  // --- Insert in-app inbox notifications for mentions/replies (fire-and-forget) ---
  Promise.resolve()
    .then(async () => {
      const MAX_NOTIFICATION_BODY_LENGTH = 512
      const serviceSupabase = await createServiceRoleClient()
      const recipientIds = new Set<string>()

      for (const mentionedUserId of safeMentions) {
        if (mentionedUserId && mentionedUserId !== user.id) {
          recipientIds.add(mentionedUserId)
        }
      }

      let replyAuthorId: string | null = null
      if (replyToId) {
        const { data: repliedMessage } = await serviceSupabase
          .from("messages")
          .select("author_id")
          .eq("id", replyToId)
          .maybeSingle()
        replyAuthorId = repliedMessage?.author_id ?? null
      }

      if (replyAuthorId && replyAuthorId !== user.id) {
        recipientIds.add(replyAuthorId)
      }

      if (recipientIds.size === 0) return

      // Fetch global notification preferences to respect per-type opt-outs
      const recipientList = Array.from(recipientIds)
      const { data: globalPrefs } = await serviceSupabase
        .from("user_notification_preferences")
        .select("user_id, mention_notifications, reply_notifications")
        .in("user_id", recipientList)
      interface NotifPref { user_id: string; mention_notifications: boolean | null; reply_notifications: boolean | null }
      const prefMap = new Map<string, NotifPref>(
        (globalPrefs ?? []).map((p: NotifPref) => [p.user_id, p])
      )

      const bodyPreview = (content?.trim() || "Sent an attachment").slice(0, MAX_NOTIFICATION_BODY_LENGTH)
      const rows = recipientList
        .filter((recipientId) => {
          const isMentionTarget = safeMentions.includes(recipientId)
          const prefs = prefMap.get(recipientId)
          // If user has explicitly disabled this type, skip (default true when no row)
          if (isMentionTarget && prefs && prefs.mention_notifications === false) return false
          if (!isMentionTarget && prefs && prefs.reply_notifications === false) return false
          return true
        })
        .map((recipientId) => {
          const isMentionTarget = safeMentions.includes(recipientId)
          return {
            user_id: recipientId,
            type: isMentionTarget ? "mention" as const : "reply" as const,
            title: isMentionTarget
              ? `${senderName} mentioned you`
              : `${senderName} replied to your message`,
            body: bodyPreview,
            server_id: channel.server_id,
            channel_id: channelId,
            message_id: message.id,
          }
        })

      if (rows.length > 0) {
        await serviceSupabase.from("notifications").insert(rows)
      }
    })
    .catch((err) => { log.error({ route: "/api/messages", action: "notificationInsert", userId: user.id, channelId, error: err }, "in-app notification insert failed") })

  // When @everyone/@here is used, treat all channel members as mentioned
  // so they receive push notifications even if their mode is "mentions only"
  let pushMentionedIds = mentionEveryone
    ? undefined // handled below — we pass a flag instead
    : [...safeMentions]

  // Resolve @role mentions: find members with mentioned roles and add them to push recipients
  if (!mentionEveryone && mentionRoleIds.length > 0 && serverId) {
    try {
      // Verify mentioned roles are actually mentionable
      const { data: mentionableRoles } = await supabase
        .from("roles")
        .select("id")
        .in("id", mentionRoleIds)
        .eq("server_id", serverId)
        .eq("mentionable", true)
      const validRoleIds = (mentionableRoles ?? []).map((r: { id: string }) => r.id)

      if (validRoleIds.length > 0) {
        // Find all members who have these roles
        const { data: roleMemberRows } = await supabase
          .from("member_roles")
          .select("user_id")
          .eq("server_id", serverId)
          .in("role_id", validRoleIds)

        if (roleMemberRows?.length) {
          const roleMemberIds = roleMemberRows.map((r: { user_id: string }) => r.user_id)
          // Merge into push mentioned IDs (dedup)
          const existingSet = new Set(pushMentionedIds ?? [])
          for (const uid of roleMemberIds) {
            if (!existingSet.has(uid)) {
              existingSet.add(uid)
              pushMentionedIds = pushMentionedIds ?? []
              pushMentionedIds.push(uid)
            }
          }
        }
      }
    } catch (err) {
      log.error({ route: "/api/messages", action: "resolveRoleMentions", userId: user.id, serverId, error: err }, "failed to resolve role mentions")
    }
  }

  sendPushToChannel({
    serverId: channel.server_id,
    channelId,
    senderName,
    senderAvatarUrl,
    content: content?.trim() ?? "Sent an attachment",
    mentionedIds: pushMentionedIds,
    mentionEveryone,
    excludeUserId: user.id,
  }).catch((err) => { log.error({ route: "/api/messages", action: "sendPush", userId: user.id, channelId, error: err }, "sendPushToChannel failed") })

  // Publish to Socket.IO gateway for real-time delivery (#696)
  publishGatewayEvent({
    type: "message.created",
    channelId,
    serverId: channel.server_id,
    actorId: user.id,
    data: { messageId: message.id, replyToId: replyToId ?? null },
  }, { route: "/api/messages" }).catch((err: unknown) => {
    log.error({ route: "/api/messages", action: "message.created", userId: user.id, channelId, messageId: message.id, error: err instanceof Error ? err.message : String(err) }, "gateway publish failed")
  })

  // Skip the extra DB query when there's no reply to hydrate
  const hydratedMessage = replyToId
    ? (await withReplyTo(supabase, [message]))[0]
    : { ...message, reply_to: null }
  lap("total")
  return NextResponse.json(hydratedMessage, { status: 201 })
  } catch (err) {
    log.error({ route: "/api/messages", action: "POST", error: err }, "POST error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
