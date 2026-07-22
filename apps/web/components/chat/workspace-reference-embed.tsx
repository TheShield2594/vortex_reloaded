"use client"

import { useEffect, useState } from "react"
import { CheckSquare, FileText } from "lucide-react"

export function extractWorkspaceReference(content: string): { type: "task" | "doc"; id: string } | null {
  const match = content.match(/\[(task|doc):([0-9a-f-]{36})\]/i)
  if (!match) return null
  return { type: match[1].toLowerCase() as "task" | "doc", id: match[2] }
}

export function WorkspaceReferenceEmbed({ type, id }: { type: "task" | "doc"; id: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    fetch(`/api/workspace/reference?type=${type}&id=${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => setData(payload?.reference ?? null))
      .catch(() => setData(null))
  }, [type, id])

  if (!data) return null

  return (
    <div className="mt-2 rounded border border-[var(--theme-bg-tertiary)] bg-[var(--theme-bg-secondary)] p-2 text-xs text-zinc-200">
      <div className="mb-1 flex items-center gap-1 font-medium text-white">
        {type === "task" ? <CheckSquare className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
        {type.toUpperCase()} • {data.title as string}
      </div>
      {type === "task" ? <div>Status: {data.status as string}</div> : <div>Updated: {new Date(data.updated_at as string).toLocaleString()}</div>}
    </div>
  )
}
