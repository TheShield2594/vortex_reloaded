"use client"

import { useState, useEffect, useCallback } from "react"
import { AiPersonasSection } from "@/components/settings/ai-personas-section"
import {
  Key,
  Loader2,
  Save,
  Trash2,
  Plus,
  Star,
  ChevronDown,
  ChevronUp,
  Globe,
  Server,
  Pencil,
  Check,
} from "lucide-react"
import {
  AI_PROVIDERS,
  AI_PROVIDER_META,
  AI_FUNCTIONS,
  AI_FUNCTION_META,
  type AiProvider,
  type AiFunction,
} from "@vortex/shared"

interface AiSettingsTabProps {
  serverId: string
}

interface ProviderEntry {
  id: string
  provider: AiProvider
  label: string | null
  hasApiKey: boolean
  baseUrl: string | null
  model: string | null
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

interface SettingsState {
  hasGeminiKey: boolean
  providers: ProviderEntry[]
  routing: Record<string, string>
}

export function AiSettingsTab({ serverId }: AiSettingsTabProps) {
  const [state, setState] = useState<SettingsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Add provider form
  const [showAddForm, setShowAddForm] = useState(false)
  const [addProvider, setAddProvider] = useState<AiProvider>("openai")
  const [addLabel, setAddLabel] = useState("")
  const [addApiKey, setAddApiKey] = useState("")
  const [addBaseUrl, setAddBaseUrl] = useState("")
  const [addModel, setAddModel] = useState("")
  const [addIsDefault, setAddIsDefault] = useState(false)
  const [addSaving, setAddSaving] = useState(false)

  // Edit provider
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editApiKey, setEditApiKey] = useState("")
  const [editModel, setEditModel] = useState("")
  const [editLabel, setEditLabel] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  // Routing saves
  const [routingSaving, setRoutingSaving] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/ai-settings`)
      if (!res.ok) throw new Error("Failed to load AI settings")
      const data = await res.json()
      setState(data as SettingsState)
    } catch {
      setError("Failed to load AI settings")
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const clearFeedback = (): void => {
    setError(null)
    setSuccess(null)
  }

  const showSuccess = (msg: string): void => {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  // ── Add provider ────────────────────────────────────────────────────────

  const handleAddProvider = async (): Promise<void> => {
    clearFeedback()
    setAddSaving(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/ai-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_provider",
          provider: addProvider,
          label: addLabel || undefined,
          apiKey: addApiKey || undefined,
          baseUrl: addBaseUrl || undefined,
          model: addModel || undefined,
          isDefault: addIsDefault,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Failed to add provider")
      }
      // Reset form and reload
      setShowAddForm(false)
      setAddProvider("openai")
      setAddLabel("")
      setAddApiKey("")
      setAddBaseUrl("")
      setAddModel("")
      setAddIsDefault(false)
      showSuccess(`${AI_PROVIDER_META[addProvider].label} added successfully`)
      await fetchSettings()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add provider")
    } finally {
      setAddSaving(false)
    }
  }

  // ── Update provider ─────────────────────────────────────────────────────

  const handleUpdateProvider = async (configId: string): Promise<void> => {
    clearFeedback()
    setEditSaving(true)
    try {
      const updates: Record<string, unknown> = { action: "update_provider", configId }
      if (editApiKey) updates.apiKey = editApiKey
      if (editModel) updates.model = editModel
      if (editLabel !== undefined) updates.label = editLabel

      const res = await fetch(`/api/servers/${serverId}/ai-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Failed to update provider")
      }
      setEditingId(null)
      setEditApiKey("")
      setEditModel("")
      setEditLabel("")
      showSuccess("Provider updated")
      await fetchSettings()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update provider")
    } finally {
      setEditSaving(false)
    }
  }

  // ── Remove provider ─────────────────────────────────────────────────────

  const handleRemoveProvider = async (configId: string, label: string): Promise<void> => {
    clearFeedback()
    try {
      const res = await fetch(`/api/servers/${serverId}/ai-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_provider", configId }),
      })
      if (!res.ok) throw new Error("Failed to remove provider")
      showSuccess(`${label} removed`)
      await fetchSettings()
    } catch {
      setError("Failed to remove provider")
    }
  }

  // ── Set default ─────────────────────────────────────────────────────────

  const handleSetDefault = async (configId: string): Promise<void> => {
    clearFeedback()
    try {
      const res = await fetch(`/api/servers/${serverId}/ai-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_provider", configId, isDefault: true }),
      })
      if (!res.ok) throw new Error("Failed to set default")
      showSuccess("Default provider updated")
      await fetchSettings()
    } catch {
      setError("Failed to set default provider")
    }
  }

  // ── Set routing ─────────────────────────────────────────────────────────

  const handleSetRouting = async (aiFunction: AiFunction, providerConfigId: string | null): Promise<void> => {
    clearFeedback()
    setRoutingSaving(aiFunction)
    try {
      const res = await fetch(`/api/servers/${serverId}/ai-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_routing",
          aiFunction,
          providerConfigId: providerConfigId === "" ? null : providerConfigId,
        }),
      })
      if (!res.ok) throw new Error("Failed to update routing")
      await fetchSettings()
    } catch {
      setError("Failed to update function routing")
    } finally {
      setRoutingSaving(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--theme-text-muted)" }} />
      </div>
    )
  }

  const providers = state?.providers ?? []
  const routing = state?.routing ?? {}
  const meta = AI_PROVIDER_META[addProvider]

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-white">AI Settings</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--theme-text-muted)" }}>
          Configure AI providers and choose which provider powers each AI feature.
          You can assign different providers to different functions.
        </p>
      </div>

      {/* ── Configured Providers ───────────────────────────────────────── */}
      <div className="rounded-md p-4" style={{ background: "var(--theme-bg-secondary)" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-white">Providers</h3>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors"
            style={{ background: "var(--theme-accent, #5865F2)" }}
          >
            {showAddForm ? <ChevronUp className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {showAddForm ? "Cancel" : "Add Provider"}
          </button>
        </div>

        {providers.length === 0 && !showAddForm && (
          <p className="text-xs text-amber-400">
            No AI providers configured. Add a provider to enable AI features.
          </p>
        )}

        {/* Provider list */}
        <div className="space-y-2">
          {providers.map((p: ProviderEntry) => {
            const providerMeta = AI_PROVIDER_META[p.provider]
            const isEditing = editingId === p.id
            const displayLabel = p.label ?? providerMeta.label

            return (
              <div
                key={p.id}
                className="rounded-md p-3 border"
                style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-border)" }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {p.provider === "ollama" ? (
                      <Server className="h-4 w-4 text-green-400" />
                    ) : (
                      <Globe className="h-4 w-4" style={{ color: "var(--theme-text-muted)" }} />
                    )}
                    <span className="text-sm font-medium text-white">{displayLabel}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--theme-bg-secondary)", color: "var(--theme-text-muted)" }}>
                      {providerMeta.label}
                    </span>
                    {p.model && (
                      <span className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                        {p.model}
                      </span>
                    )}
                    {p.isDefault && (
                      <span className="flex items-center gap-0.5 text-xs text-amber-400">
                        <Star className="h-3 w-3" /> Default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!p.isDefault && (
                      <button
                        onClick={() => handleSetDefault(p.id)}
                        className="p-1.5 rounded transition-colors hover:bg-white/5"
                        title="Set as default"
                      >
                        <Star className="h-3.5 w-3.5" style={{ color: "var(--theme-text-muted)" }} />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (isEditing) {
                          setEditingId(null)
                        } else {
                          setEditingId(p.id)
                          setEditModel(p.model ?? "")
                          setEditLabel(p.label ?? "")
                          setEditApiKey("")
                        }
                      }}
                      className="p-1.5 rounded transition-colors hover:bg-white/5"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" style={{ color: "var(--theme-text-muted)" }} />
                    </button>
                    <button
                      onClick={() => handleRemoveProvider(p.id, displayLabel)}
                      className="p-1.5 rounded transition-colors hover:bg-red-500/10"
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-400" />
                    </button>
                  </div>
                </div>

                {/* Inline edit form */}
                {isEditing && (
                  <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: "var(--theme-border)" }}>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>Label</label>
                        <input
                          type="text"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          placeholder={providerMeta.label}
                          className="w-full rounded-md border py-1.5 px-2 text-xs text-white placeholder:text-gray-500"
                          style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
                        />
                      </div>
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>Model</label>
                        <input
                          type="text"
                          value={editModel}
                          onChange={(e) => setEditModel(e.target.value)}
                          placeholder={providerMeta.defaultModel}
                          className="w-full rounded-md border py-1.5 px-2 text-xs text-white placeholder:text-gray-500"
                          style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>
                        New API Key (leave blank to keep current)
                      </label>
                      <input
                        type="password"
                        value={editApiKey}
                        onChange={(e) => setEditApiKey(e.target.value)}
                        placeholder="Enter new key to replace..."
                        className="w-full rounded-md border py-1.5 px-2 text-xs text-white placeholder:text-gray-500"
                        style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
                      />
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
                        onClick={() => handleUpdateProvider(p.id)}
                        disabled={editSaving}
                        className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        style={{ background: "var(--theme-accent, #5865F2)" }}
                      >
                        {editSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Add provider form ─────────────────────────────────────────── */}
        {showAddForm && (
          <div
            className="mt-3 rounded-md p-3 border space-y-3"
            style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-accent, #5865F2)" }}
          >
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>Provider</label>
                <select
                  value={addProvider}
                  onChange={(e) => {
                    const p = e.target.value as AiProvider
                    setAddProvider(p)
                    setAddModel("")
                    setAddBaseUrl("")
                  }}
                  className="w-full rounded-md border py-1.5 px-2 text-xs text-white"
                  style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
                >
                  {AI_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {AI_PROVIDER_META[p].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>
                  Label <span className="text-gray-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder={`My ${meta.label}`}
                  className="w-full rounded-md border py-1.5 px-2 text-xs text-white placeholder:text-gray-500"
                  style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
                />
              </div>
            </div>

            {meta.requiresApiKey && (
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>API Key</label>
                <div className="relative">
                  <Key className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--theme-text-muted)" }} />
                  <input
                    type="password"
                    value={addApiKey}
                    onChange={(e) => setAddApiKey(e.target.value)}
                    placeholder={meta.placeholder}
                    className="w-full rounded-md border py-1.5 pl-8 pr-2 text-xs text-white placeholder:text-gray-500"
                    style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
                  />
                </div>
              </div>
            )}

            {meta.supportsBaseUrl && (
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>
                  Base URL {meta.requiresApiKey ? <span className="text-gray-500">(optional — for proxies)</span> : ""}
                </label>
                <input
                  type="url"
                  value={addBaseUrl}
                  onChange={(e) => setAddBaseUrl(e.target.value)}
                  placeholder={addProvider === "ollama" ? "http://localhost:11434" : "https://api.openai.com/v1"}
                  className="w-full rounded-md border py-1.5 px-2 text-xs text-white placeholder:text-gray-500"
                  style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--theme-text-muted)" }}>
                  Model <span className="text-gray-500">(default: {meta.defaultModel})</span>
                </label>
                <input
                  type="text"
                  value={addModel}
                  onChange={(e) => setAddModel(e.target.value)}
                  placeholder={meta.defaultModel}
                  className="w-full rounded-md border py-1.5 px-2 text-xs text-white placeholder:text-gray-500"
                  style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 py-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addIsDefault}
                    onChange={(e) => setAddIsDefault(e.target.checked)}
                    className="rounded"
                  />
                  <span style={{ color: "var(--theme-text-muted)" }}>Set as default provider</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowAddForm(false)}
                className="rounded-md px-3 py-1.5 text-xs border"
                style={{ borderColor: "var(--theme-border)", color: "var(--theme-text-muted)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddProvider}
                disabled={addSaving || (meta.requiresApiKey && !addApiKey.trim())}
                className="flex items-center gap-1 rounded-md px-4 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50"
                style={{ background: "var(--theme-accent, #5865F2)" }}
              >
                {addSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Add Provider
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Function Routing ───────────────────────────────────────────── */}
      {providers.length > 0 && (
        <div className="rounded-md p-4" style={{ background: "var(--theme-bg-secondary)" }}>
          <h3 className="text-sm font-medium text-white mb-1">Function Routing</h3>
          <p className="text-xs mb-3" style={{ color: "var(--theme-text-muted)" }}>
            Choose which provider powers each AI feature. Leave on &quot;Use Default&quot; to use your default provider.
          </p>

          <div className="space-y-2">
            {AI_FUNCTIONS.map((fn) => {
              const fnMeta = AI_FUNCTION_META[fn]
              const currentRouting = routing[fn] ?? ""
              const isSaving = routingSaving === fn

              return (
                <div
                  key={fn}
                  className="flex items-center justify-between rounded-md p-2.5 border"
                  style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-border)" }}
                >
                  <div className="min-w-0 flex-1 mr-3">
                    <div className="text-xs font-medium text-white">{fnMeta.label}</div>
                    <div className="text-xs truncate" style={{ color: "var(--theme-text-muted)" }}>
                      {fnMeta.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isSaving && <Loader2 className="h-3 w-3 animate-spin" style={{ color: "var(--theme-text-muted)" }} />}
                    <select
                      value={currentRouting}
                      onChange={(e) => handleSetRouting(fn, e.target.value || null)}
                      disabled={isSaving}
                      className="rounded-md border py-1 px-2 text-xs text-white min-w-[160px] disabled:opacity-50"
                      style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-border)" }}
                    >
                      <option value="">Use Default</option>
                      {providers.map((p: ProviderEntry) => (
                        <option key={p.id} value={p.id}>
                          {p.label ?? AI_PROVIDER_META[p.provider].label}
                          {p.model ? ` (${p.model})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── AI Personas ──────────────────────────────────────────────── */}
      <AiPersonasSection serverId={serverId} />

      {/* ── Legacy Gemini status ───────────────────────────────────────── */}
      {state?.hasGeminiKey && providers.length === 0 && (
        <div className="rounded-md p-3 border border-amber-500/30 bg-amber-500/5">
          <p className="text-xs text-amber-400">
            You have a legacy Gemini API key configured. It will continue to work, but adding a provider
            above will give you access to multi-provider routing and more AI features.
          </p>
        </div>
      )}

      {/* ── Feedback ───────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-400">
          {success}
        </div>
      )}
    </div>
  )
}
