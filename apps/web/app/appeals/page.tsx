"use client"

import { useEffect, useState } from "react"

interface AppealSummary {
  id: string
  server_id: string
  status: string
  submitted_at: string
}

export default function AppealsPage() {
  const [serverId, setServerId] = useState("")
  const [statement, setStatement] = useState("")
  const [evidence, setEvidence] = useState("")
  const [trackingId, setTrackingId] = useState<string | null>(null)
  const [appeals, setAppeals] = useState<AppealSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  async function loadAppeals() {
    const res = await fetch("/api/appeals")
    if (!res.ok) return
    setAppeals(await res.json())
  }

  useEffect(() => {
    loadAppeals()
  }, [])

  async function submitAppeal() {
    setError(null)
    const evidenceAttachments = evidence
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)

    const res = await fetch("/api/appeals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, statement, evidenceAttachments }),
    })

    const payload = await res.json()
    if (!res.ok) {
      setError(payload.error ?? "Unable to submit appeal")
      return
    }

    setTrackingId(payload.trackingId)
    setStatement("")
    setEvidence("")
    await loadAppeals()
  }

  return (
    <main className="mx-auto max-w-3xl p-6 text-white" style={{ paddingTop: "max(24px, calc(env(safe-area-inset-top) + 24px))" }}>
      <h1 className="text-2xl font-semibold">Ban appeal</h1>
      <p className="mt-2 text-sm text-zinc-300">Submit one active appeal per server and track review status.</p>

      <section className="mt-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
        <label htmlFor="serverId" className="block text-sm mb-2">Server ID</label>
        <input id="serverId" className="w-full rounded bg-zinc-800 p-2 mb-3" value={serverId} onChange={(e) => setServerId(e.target.value)} />

        <label htmlFor="statement" className="block text-sm mb-2">Statement (min 20 chars)</label>
        <textarea id="statement" className="w-full rounded bg-zinc-800 p-2 mb-3 min-h-32" value={statement} onChange={(e) => setStatement(e.target.value)} />

        <label htmlFor="evidence" className="block text-sm mb-2">Evidence attachments (one URL per line)</label>
        <textarea id="evidence" className="w-full rounded bg-zinc-800 p-2 mb-4 min-h-24" value={evidence} onChange={(e) => setEvidence(e.target.value)} />

        <button className="rounded bg-indigo-600 px-4 py-2 text-sm" onClick={submitAppeal}>Submit appeal</button>

        {trackingId && <p className="mt-3 text-green-400 text-sm">Submitted. Tracking ID: {trackingId}</p>}
        {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}
      </section>

      <section className="mt-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="text-lg font-medium">Your appeals</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {appeals.map((appeal) => (
            <li key={appeal.id} className="rounded border border-zinc-700 p-2">
              <p>Tracking: {appeal.id}</p>
              <p>Status: <span className="font-medium">{appeal.status}</span></p>
              <p>Submitted: {new Date(appeal.submitted_at).toLocaleString()}</p>
            </li>
          ))}
          {appeals.length === 0 && <li className="text-zinc-400">No appeals yet.</li>}
        </ul>
      </section>
    </main>
  )
}
