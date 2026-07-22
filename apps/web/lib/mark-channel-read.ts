import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createClientSupabaseClient } from "@/lib/supabase/client"

/**
 * Shared helper that calls the mark_channel_read RPC.
 * Used by useMarkChannelRead (hook) and keyboard shortcut handler.
 */
export async function markChannelReadRpc(
  supabase: SupabaseClient<Database>,
  channelId: string,
  caller: string
): Promise<void> {
  try {
    const { error } = await supabase.rpc("mark_channel_read", { p_channel_id: channelId })
    if (error) {
      console.error("markChannelReadRpc failed", { caller, channelId, error: error.message })
    }
  } catch (err) {
    console.error("markChannelReadRpc failed", { caller, channelId, error: err instanceof Error ? err.message : String(err) })
  }
}

/** Convenience wrapper that creates its own Supabase client — for use in callbacks without a client in scope. */
export function markChannelRead(channelId: string): void {
  void markChannelReadRpc(createClientSupabaseClient(), channelId, "shortcut")
}
