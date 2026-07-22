import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { mapActionType } from "@/lib/mod-ledger"

export default async function TargetModLedgerPage({ params: paramsPromise }: { params: Promise<{ serverId: string; targetId: string }> }) {
  const { serverId, targetId } = await paramsPromise
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

  const { data: entries } = await supabase
    .from("audit_logs")
    .select("id, action, created_at, changes")
    .eq("server_id", serverId)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(100)

  return (
    <main className="flex-1 overflow-y-auto bg-zinc-950 p-6 text-zinc-100">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Target Timeline</h1>
        <p className="text-sm text-zinc-400">User: {targetId}</p>
        <Link className="text-sm text-sky-400" href={`/channels/${serverId}/moderation`}>Back to full moderation timeline</Link>
      </div>
      <div className="space-y-2">
        {(entries ?? []).map((entry) => (
          <article key={entry.id} className="rounded border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-sm font-medium">{entry.action} · {mapActionType(entry.action)}</p>
            <p className="text-xs text-zinc-400">{new Date(entry.created_at).toLocaleString()}</p>
            {((entry.changes as Record<string, unknown> | null)?.reason as string | undefined) && (
              <p className="text-xs text-zinc-300 mt-1">Reason: {String((entry.changes as Record<string, unknown>).reason)}</p>
            )}
          </article>
        ))}
      </div>
    </main>
  )
}
