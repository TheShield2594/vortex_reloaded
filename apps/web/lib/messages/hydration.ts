import type { createServerSupabaseClient } from "@/lib/supabase/server"

export type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>

// Base projection — does NOT embed reply_to via FK join because the
// self-referential FK is not guaranteed to be in PostgREST's schema cache.
// Reply-to messages are hydrated in a separate query by withReplyTo().
export const MESSAGE_PROJECTION = "*, author:users!messages_author_id_fkey(*), attachments(*), reactions(*)"
export const REPLY_PROJECTION = "*, author:users!messages_author_id_fkey(*)"

/** Fetch parent messages for any rows that have reply_to_id set and stitch them in. */
export async function withReplyTo(
  supabase: ServerSupabaseClient,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  return hydrateReplyTo(supabase, rows)
}

export async function hydrateReplyTo<T extends { reply_to_id?: string | null } & Record<string, unknown>>(
  supabase: ServerSupabaseClient,
  rows: T[],
): Promise<Array<T & { reply_to: Record<string, unknown> | null }>> {
  const replyIds = [...new Set(rows.map((row) => row.reply_to_id).filter(Boolean))] as string[]

  if (!replyIds.length) {
    return rows.map((row) => ({ ...row, reply_to: null }))
  }

  const { data } = await supabase
    .from("messages")
    .select(REPLY_PROJECTION)
    .in("id", replyIds)

  const replyMap = new Map((data ?? []).map((message: Record<string, unknown>) => [message.id, message]))

  return rows.map((row) => ({
    ...row,
    reply_to: row.reply_to_id ? (replyMap.get(row.reply_to_id) ?? null) : null,
  }))
}
