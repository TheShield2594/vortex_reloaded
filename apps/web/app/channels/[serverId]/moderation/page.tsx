import { redirect, notFound } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { ModLedger } from "@/components/moderation/mod-ledger"

export default async function ModLedgerPage({ params: paramsPromise }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await paramsPromise
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: member } = await supabase
    .from("server_members")
    .select("server_id")
    .eq("server_id", serverId)
    .eq("user_id", user.id)
    .single()

  if (!member) notFound()

  return (
    <main className="flex-1 overflow-y-auto bg-zinc-950">
      <ModLedger serverId={serverId} />
    </main>
  )
}
