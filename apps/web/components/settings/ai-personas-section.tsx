"use client"

import { useState, useEffect, useCallback } from "react"
import { Bot, Plus, Trash2, Pencil, Loader2, Save, ChevronDown, ChevronUp } from "lucide-react"

interface Persona {
  id: string
  name: string
  avatar_url: string | null
  description: string | null
  system_prompt: string | null
  is_active: boolean
  allowed_channel_ids: string[]
  created_at: string
}

interface AiPersonasSectionProps {
  serverId: string
}

/**
 * AI Personas section for the AI Settings tab.
 * Server owners can create, edit, and delete custom AI personas.
 */
export function AiPersonasSection({ serverId }: AiPersonasSectionProps) {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState("")
  const [createDescription, setCreateDescription] = useState("")
  const [createPrompt, setCreatePrompt] = useState("")
  const [createSaving, setCreateSaving] = useState(false)

  // Edit form
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editPrompt, setEditPrompt] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  const fetchPersonas = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/ai-personas`)
      if (!res.ok) throw new Error("Failed to load")
      const data = await res.json()
      setPersonas(data.personas ?? [])
    } catch {
      setError("Failed to load AI personas")
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => { fetchPersonas() }, [fetchPersonas])

  const showSuccessMsg = (msg: string): void => {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  const handleCreate = async (): Promise<void> => {
    setError(null)
    setCreateSaving(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/ai-personas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          description: createDescription.trim() || undefined,
          systemPrompt: createPrompt.trim(),
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Failed to create")
      }
      setShowCreate(false)
      setCreateName("")
      setCreateDescription("")
      setCreatePrompt("")
      showSuccessMsg("Persona created")
      await fetchPersonas()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create persona")
    } finally {
      setCreateSaving(false)
    }
  }

  const handleUpdate = async (personaId: string): Promise<void> => {
    setError(null)
    setEditSaving(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/ai-personas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          personaId,
          name: editName.trim(),
          description: editDescription.trim() || null,
          systemPrompt: editPrompt.trim(),
        }),
      })
      if (!res.ok) throw new Error("Failed to update")
      setEditingId(null)
      showSuccessMsg("Persona updated")
      await fetchPersonas()
    } catch {
      setError("Failed to update persona")
    } finally {
      setEditSaving(false)
    }
  }

  const handleDelete = async (personaId: string, name: string): Promise<void> => {
    if (!window.confirm(`Delete persona "${name}"?`)) return
    setError(null)
    try {
      const res = await fetch(`/api/servers/${serverId}/ai-personas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", personaId }),
      })
      if (!res.ok) throw new Error("Failed to delete")
      showSuccessMsg(`${name} deleted`)
      await fetchPersonas()
    } catch {
      setError("Failed to delete persona")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--theme-text-muted)" }} />
      </div>
    )
  }

  return (
    <div className="rounded-md p-4" style={{ background: "var(--theme-bg-secondary)" }}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-white flex items-center gap-1.5">
          <Bot className="w-4 h-4" style={{ color: "var(--theme-ai-badge-text)" }} />
          AI Personas
        </h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors"
          style={{ background: "var(--theme-accent, #5865F2)" }}
        >
          {showCreate ? <ChevronUp className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showCreate ? "Cancel" : "Create Persona"}
        </button>
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--theme-text-muted)" }}>
        Custom AI bots that respond in channels. Members invoke them with @mention.
      </p>

      {/* Create form */}
      {showCreate && (
        <div
          className="mb-3 rounded-md p-3 border space-y-2"
          style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-accent, #5865F2)" }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>Name (1-32 chars)</label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="CookingBot"
                maxLength={32}
                className="w-full rounded-md border py-1.5 px-2 text-xs text-white placeholder:text-gray-500"
                style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>Description (optional)</label>
              <input
                type="text"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="A helpful cooking assistant"
                className="w-full rounded-md border py-1.5 px-2 text-xs text-white placeholder:text-gray-500"
                style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
              />
            </div>
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>
              System Prompt — defines the persona&apos;s personality and knowledge
            </label>
            <textarea
              value={createPrompt}
              onChange={(e) => setCreatePrompt(e.target.value)}
              placeholder="You are a friendly cooking expert who loves Italian cuisine. You give concise recipe suggestions and cooking tips."
              rows={3}
              maxLength={4000}
              className="w-full rounded-md border py-1.5 px-2 text-xs text-white placeholder:text-gray-500 resize-none"
              style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
            />
            <div className="text-right text-[10px]" style={{ color: "var(--theme-text-muted)" }}>
              {createPrompt.length}/4000
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-md px-3 py-1.5 text-xs border"
              style={{ borderColor: "var(--theme-border)", color: "var(--theme-text-muted)" }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={createSaving || !createName.trim() || !createPrompt.trim()}
              className="flex items-center gap-1 rounded-md px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              style={{ background: "var(--theme-accent, #5865F2)" }}
            >
              {createSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Create
            </button>
          </div>
        </div>
      )}

      {/* Persona list */}
      {personas.length === 0 && !showCreate && (
        <p className="text-xs py-2" style={{ color: "var(--theme-text-muted)" }}>
          No personas yet. Create one to get started.
        </p>
      )}

      <div className="space-y-2">
        {personas.map((p) => {
          const isEditing = editingId === p.id
          return (
            <div
              key={p.id}
              className="rounded-md p-3 border"
              style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-border)" }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: "var(--theme-ai-badge-bg)", color: "var(--theme-ai-badge-text)" }}
                  >
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-white">{p.name}</span>
                      <span
                        className="inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] font-bold uppercase"
                        style={{ background: "var(--theme-ai-badge-bg)", color: "var(--theme-ai-badge-text)" }}
                      >
                        <Bot className="w-2.5 h-2.5" /> BOT
                      </span>
                    </div>
                    {p.description && (
                      <div className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{p.description}</div>
                    )}
                    {p.system_prompt && !isEditing && (
                      <div className="text-[11px] mt-1 line-clamp-2 italic" style={{ color: "var(--theme-text-muted)", opacity: 0.7 }}>
                        {p.system_prompt}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (isEditing) { setEditingId(null) } else {
                        setEditingId(p.id)
                        setEditName(p.name)
                        setEditDescription(p.description ?? "")
                        setEditPrompt(p.system_prompt ?? "")
                      }
                    }}
                    className="p-1.5 rounded transition-colors hover:bg-white/5"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" style={{ color: "var(--theme-text-muted)" }} />
                  </button>
                  <button
                    onClick={() => handleDelete(p.id, p.name)}
                    className="p-1.5 rounded transition-colors hover:bg-red-500/10"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </button>
                </div>
              </div>

              {isEditing && (
                <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: "var(--theme-border)" }}>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>Name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={32}
                        className="w-full rounded-md border py-1.5 px-2 text-xs text-white"
                        style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
                      />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>Description</label>
                      <input
                        type="text"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full rounded-md border py-1.5 px-2 text-xs text-white"
                        style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>System Prompt</label>
                    <textarea
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      placeholder="Define the persona's personality and knowledge..."
                      rows={4}
                      maxLength={4000}
                      className="w-full rounded-md border py-1.5 px-2 text-xs text-white placeholder:text-gray-500 resize-none"
                      style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
                    />
                    <div className="text-right text-[10px]" style={{ color: "var(--theme-text-muted)" }}>
                      {editPrompt.length}/4000
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-md px-3 py-1.5 text-xs border"
                      style={{ borderColor: "var(--theme-border)", color: "var(--theme-text-muted)" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleUpdate(p.id)}
                      disabled={editSaving || !editName.trim()}
                      className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      style={{ background: "var(--theme-accent, #5865F2)" }}
                    >
                      {editSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {error && <div className="mt-2 rounded-md bg-red-500/10 p-2 text-xs text-red-400">{error}</div>}
      {success && <div className="mt-2 rounded-md bg-green-500/10 p-2 text-xs text-green-400">{success}</div>}
    </div>
  )
}
