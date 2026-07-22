import { NextRequest, NextResponse } from "next/server"
import { requireServerOwner } from "@/lib/server-auth"
import {
  AI_PROVIDERS,
  AI_FUNCTIONS,
  AI_PROVIDER_META,
  type AiProvider,
  type AiFunction,
} from "@vortex/shared"

type Params = { params: Promise<{ serverId: string }> }

// ── GET ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/servers/{serverId}/ai-settings
 *
 * Returns:
 *   - hasGeminiKey (legacy compat)
 *   - providers: configured provider list (without raw API keys)
 *   - routing: per-function provider assignments
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const { supabase, error } = await requireServerOwner(serverId)
    if (error) return error

    // Fetch all three in parallel
    const [secretsResult, providersResult, routingResult] = await Promise.all([
      supabase
        .from("server_secrets")
        .select("gemini_api_key")
        .eq("server_id", serverId)
        .maybeSingle(),
      supabase
        .from("ai_provider_configs")
        .select("id, provider, label, api_key, base_url, model, is_default, created_at, updated_at")
        .eq("server_id", serverId)
        .order("created_at", { ascending: true }),
      supabase
        .from("ai_function_routing")
        .select("ai_function, provider_config_id")
        .eq("server_id", serverId),
    ])

    if (secretsResult.error || providersResult.error || routingResult.error) {
      console.error("[ai-settings GET] query errors:", {
        secrets: secretsResult.error?.message,
        providers: providersResult.error?.message,
        routing: routingResult.error?.message,
      })
      return NextResponse.json({ error: "Failed to load AI settings" }, { status: 500 })
    }

    // Build routing map: { chat_summary: "config-uuid", ... }
    const routing: Record<string, string> = {}
    if (routingResult.data) {
      for (const row of routingResult.data) {
        routing[row.ai_function as string] = row.provider_config_id as string
      }
    }

    return NextResponse.json({
      // Legacy compat
      hasGeminiKey: !!secretsResult.data?.gemini_api_key,
      // New multi-provider data
      providers: (providersResult.data ?? []).map((p: Record<string, unknown>) => ({
        id: p.id,
        provider: p.provider,
        label: p.label,
        hasApiKey: !!p.api_key,
        baseUrl: p.base_url,
        model: p.model,
        isDefault: p.is_default,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
      routing,
    })
  } catch (err) {
    console.error("[ai-settings GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// ── PATCH ────────────────────────────────────────────────────────────────────

/**
 * PATCH /api/servers/{serverId}/ai-settings
 *
 * Supports two modes via the request body:
 *
 * Legacy mode (backwards compat):
 *   { geminiApiKey: string | null }
 *
 * New mode — manage providers:
 *   { action: "add_provider", provider, label?, apiKey?, baseUrl?, model?, isDefault? }
 *   { action: "update_provider", configId, label?, apiKey?, baseUrl?, model?, isDefault? }
 *   { action: "remove_provider", configId }
 *   { action: "set_routing", aiFunction, providerConfigId: string | null }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const { supabase, error } = await requireServerOwner(serverId)
    if (error) return error

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (body === null || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const data = body as Record<string, unknown>

    // ── Legacy mode: geminiApiKey ────────────────────────────────────────
    if ("geminiApiKey" in data) {
      return handleLegacyGeminiKey(supabase, serverId, data)
    }

    const action = data.action
    if (typeof action !== "string") {
      return NextResponse.json({ error: "Missing action field" }, { status: 400 })
    }

    switch (action) {
      case "add_provider":
        return handleAddProvider(supabase, serverId, data)
      case "update_provider":
        return handleUpdateProvider(supabase, serverId, data)
      case "remove_provider":
        return handleRemoveProvider(supabase, serverId, data)
      case "set_routing":
        return handleSetRouting(supabase, serverId, data)
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    console.error("[ai-settings PATCH] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleLegacyGeminiKey(
  supabase: Awaited<ReturnType<typeof requireServerOwner>>["supabase"],
  serverId: string,
  data: Record<string, unknown>
): Promise<NextResponse> {
  const rawGeminiApiKey = data.geminiApiKey
  if (rawGeminiApiKey === undefined) {
    return NextResponse.json({ error: "geminiApiKey is required" }, { status: 400 })
  }

  const geminiApiKey =
    rawGeminiApiKey === null
      ? null
      : typeof rawGeminiApiKey === "string"
        ? rawGeminiApiKey.trim()
        : undefined

  if (geminiApiKey === undefined) {
    return NextResponse.json({ error: "geminiApiKey must be a string or null" }, { status: 400 })
  }

  if (geminiApiKey === "") {
    return NextResponse.json({ error: "geminiApiKey cannot be empty" }, { status: 400 })
  }

  const { error: upsertError } = await supabase
    .from("server_secrets")
    .upsert(
      { server_id: serverId, gemini_api_key: geminiApiKey, updated_at: new Date().toISOString() },
      { onConflict: "server_id" }
    )

  if (upsertError) {
    console.error("[ai-settings] legacy upsert error:", upsertError)
    return NextResponse.json({ error: "Failed to update AI settings" }, { status: 500 })
  }

  return NextResponse.json({ hasGeminiKey: !!geminiApiKey })
}

function isValidProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value)
}

function isValidAiFunction(value: unknown): value is AiFunction {
  return typeof value === "string" && (AI_FUNCTIONS as readonly string[]).includes(value)
}

async function handleAddProvider(
  supabase: Awaited<ReturnType<typeof requireServerOwner>>["supabase"],
  serverId: string,
  data: Record<string, unknown>
): Promise<NextResponse> {
  if (!isValidProvider(data.provider)) {
    return NextResponse.json(
      { error: `Invalid provider. Must be one of: ${AI_PROVIDERS.join(", ")}` },
      { status: 400 }
    )
  }

  const provider = data.provider
  const meta = AI_PROVIDER_META[provider]

  // Validate API key requirement
  if (meta.requiresApiKey) {
    if (typeof data.apiKey !== "string" || data.apiKey.trim() === "") {
      return NextResponse.json({ error: `${meta.label} requires an API key` }, { status: 400 })
    }
  }

  // Validate base URL for providers that need it
  if (provider === "ollama") {
    if (typeof data.baseUrl !== "string" || data.baseUrl.trim() === "") {
      return NextResponse.json({ error: "Ollama requires a base URL" }, { status: 400 })
    }
  }

  const isDefault = data.isDefault === true

  // If setting as default, clear other defaults first
  if (isDefault) {
    await supabase
      .from("ai_provider_configs")
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq("server_id", serverId)
      .eq("is_default", true)
  }

  const row = {
    server_id: serverId,
    provider,
    label: typeof data.label === "string" ? data.label.trim() || null : null,
    api_key: typeof data.apiKey === "string" ? data.apiKey.trim() : null,
    base_url: typeof data.baseUrl === "string" ? data.baseUrl.trim() || null : null,
    model: typeof data.model === "string" ? data.model.trim() || null : null,
    is_default: isDefault,
    updated_at: new Date().toISOString(),
  }

  const { data: inserted, error: insertError } = await supabase
    .from("ai_provider_configs")
    .insert(row)
    .select("id, provider, label, base_url, model, is_default, created_at, updated_at")
    .single()

  if (insertError) {
    console.error("[ai-settings] add_provider error:", insertError)
    return NextResponse.json({ error: "Failed to add provider" }, { status: 500 })
  }

  return NextResponse.json({
    provider: {
      id: inserted.id,
      provider: inserted.provider,
      label: inserted.label,
      hasApiKey: !!row.api_key,
      baseUrl: inserted.base_url,
      model: inserted.model,
      isDefault: inserted.is_default,
      createdAt: inserted.created_at,
      updatedAt: inserted.updated_at,
    },
  })
}

async function handleUpdateProvider(
  supabase: Awaited<ReturnType<typeof requireServerOwner>>["supabase"],
  serverId: string,
  data: Record<string, unknown>
): Promise<NextResponse> {
  if (typeof data.configId !== "string") {
    return NextResponse.json({ error: "configId is required" }, { status: 400 })
  }

  // Verify the config belongs to this server
  const { data: existing, error: existingError } = await supabase
    .from("ai_provider_configs")
    .select("id, server_id, provider, api_key, base_url")
    .eq("id", data.configId)
    .eq("server_id", serverId)
    .maybeSingle()

  if (existingError) {
    console.error("[ai-settings] update_provider lookup error:", existingError)
    return NextResponse.json({ error: "Failed to look up provider config" }, { status: 500 })
  }

  if (!existing) {
    return NextResponse.json({ error: "Provider config not found" }, { status: 404 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof data.label === "string") updates.label = data.label.trim() || null
  if (typeof data.apiKey === "string") updates.api_key = data.apiKey.trim() || null
  if (typeof data.baseUrl === "string") updates.base_url = data.baseUrl.trim() || null
  if (typeof data.model === "string") updates.model = data.model.trim() || null

  // Validate that after merge, required fields are not empty
  const mergedApiKey = typeof data.apiKey === "string" ? data.apiKey.trim() : existing.api_key
  const mergedBaseUrl = typeof data.baseUrl === "string" ? data.baseUrl.trim() : existing.base_url
  const provider = existing.provider as string

  const providerMeta = AI_PROVIDER_META[provider as keyof typeof AI_PROVIDER_META]
  if (providerMeta?.requiresApiKey && !mergedApiKey) {
    return NextResponse.json({ error: `${providerMeta.label} requires an API key` }, { status: 400 })
  }
  if (provider === "ollama" && !mergedBaseUrl) {
    return NextResponse.json({ error: "Ollama requires a base URL" }, { status: 400 })
  }

  if (typeof data.isDefault === "boolean") {
    // If setting as default, clear others first
    if (data.isDefault) {
      await supabase
        .from("ai_provider_configs")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq("server_id", serverId)
        .eq("is_default", true)
    }
    updates.is_default = data.isDefault
  }

  const { error: updateError } = await supabase
    .from("ai_provider_configs")
    .update(updates)
    .eq("id", data.configId)

  if (updateError) {
    console.error("[ai-settings] update_provider error:", updateError)
    return NextResponse.json({ error: "Failed to update provider" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

async function handleRemoveProvider(
  supabase: Awaited<ReturnType<typeof requireServerOwner>>["supabase"],
  serverId: string,
  data: Record<string, unknown>
): Promise<NextResponse> {
  if (typeof data.configId !== "string") {
    return NextResponse.json({ error: "configId is required" }, { status: 400 })
  }

  // Verify ownership before deleting
  const { data: existing, error: existingError } = await supabase
    .from("ai_provider_configs")
    .select("id, server_id")
    .eq("id", data.configId)
    .eq("server_id", serverId)
    .maybeSingle()

  if (existingError) {
    console.error("[ai-settings] remove_provider lookup error:", existingError)
    return NextResponse.json({ error: "Failed to look up provider config" }, { status: 500 })
  }

  if (!existing) {
    return NextResponse.json({ error: "Provider config not found" }, { status: 404 })
  }

  // Cascade will remove related routing entries
  const { error: deleteError } = await supabase
    .from("ai_provider_configs")
    .delete()
    .eq("id", data.configId)

  if (deleteError) {
    console.error("[ai-settings] remove_provider error:", deleteError)
    return NextResponse.json({ error: "Failed to remove provider" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

async function handleSetRouting(
  supabase: Awaited<ReturnType<typeof requireServerOwner>>["supabase"],
  serverId: string,
  data: Record<string, unknown>
): Promise<NextResponse> {
  if (!isValidAiFunction(data.aiFunction)) {
    return NextResponse.json(
      { error: `Invalid AI function. Must be one of: ${AI_FUNCTIONS.join(", ")}` },
      { status: 400 }
    )
  }

  const aiFunction = data.aiFunction

  // null = clear routing (use default)
  if (data.providerConfigId === null) {
    const { error: deleteError } = await supabase
      .from("ai_function_routing")
      .delete()
      .eq("server_id", serverId)
      .eq("ai_function", aiFunction)

    if (deleteError) {
      console.error("[ai-settings] clear routing error:", deleteError)
      return NextResponse.json({ error: "Failed to clear routing" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  }

  if (typeof data.providerConfigId !== "string") {
    return NextResponse.json({ error: "providerConfigId must be a string or null" }, { status: 400 })
  }

  // Verify the provider config belongs to this server
  const { data: config, error: configError } = await supabase
    .from("ai_provider_configs")
    .select("id")
    .eq("id", data.providerConfigId)
    .eq("server_id", serverId)
    .maybeSingle()

  if (configError) {
    console.error("[ai-settings] set_routing lookup error:", configError)
    return NextResponse.json({ error: "Failed to look up provider config" }, { status: 500 })
  }

  if (!config) {
    return NextResponse.json({ error: "Provider config not found" }, { status: 404 })
  }

  const { error: upsertError } = await supabase
    .from("ai_function_routing")
    .upsert(
      {
        server_id: serverId,
        ai_function: aiFunction,
        provider_config_id: data.providerConfigId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "server_id,ai_function" }
    )

  if (upsertError) {
    console.error("[ai-settings] set_routing error:", upsertError)
    return NextResponse.json({ error: "Failed to update routing" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
