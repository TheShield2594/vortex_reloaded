import { redirect, notFound } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { EventsCalendar } from "@/components/events/events-calendar"
import { hasPermission } from "@vortex/shared"
import { getMemberPermissions } from "@/lib/permissions"

export default async function ServerEventsPage({ params: paramsPromise }: { params: Promise<{ serverId: string }> }) {
  const params = await paramsPromise
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const perms = await getMemberPermissions(supabase, params.serverId, user.id)

  if (!perms.isMember) notFound()

  const { data: channels, error: channelsError } = await supabase
    .from("channels")
    .select("id,name,type")
    .eq("server_id", params.serverId)
  if (channelsError) throw channelsError

  const canManageEvents = perms.isAdmin || hasPermission(perms.permissions, "MANAGE_EVENTS")

  return (
    <main className="flex-1 overflow-y-auto bg-zinc-950">
      <EventsCalendar serverId={params.serverId} channels={channels ?? []} canManageEvents={canManageEvents} currentUserId={user.id} />
    </main>
  )
}
