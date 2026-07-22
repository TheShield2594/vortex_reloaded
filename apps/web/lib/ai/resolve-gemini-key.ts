import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Resolve the Gemini API key for a server.
 * Each server owner provides their own key via server settings.
 * Returns null when no key is configured or on query failure.
 */
export async function resolveGeminiApiKey(
  supabase: SupabaseClient,
  serverId: string
): Promise<string | null> {
  try {
    const { data: secrets } = await supabase
      .from("server_secrets")
      .select("gemini_api_key")
      .eq("server_id", serverId)
      .maybeSingle()

    return secrets?.gemini_api_key ?? null
  } catch (error) {
    console.error("[resolveGeminiApiKey] failed", { serverId, error })
    return null
  }
}
