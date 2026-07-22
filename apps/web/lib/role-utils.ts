import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

/**
 * Fetch the actor's highest role position in the server.
 * Returns -1 when the actor has no roles (so any positive-positioned role is out of reach).
 */
export async function getActorMaxRolePosition(supabase: SupabaseClient<Database>, serverId: string, actorId: string): Promise<number> {
  const { data } = await supabase
    .from("member_roles")
    .select("roles(position)")
    .eq("server_id", serverId)
    .eq("user_id", actorId)
  interface RoleJoin { roles: { position: number } | null }
  return Math.max(-1, ...(data as RoleJoin[] ?? []).map((mr) => mr.roles?.position ?? -1))
}
