"use client"

import { useState, useMemo, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Plus,
  Compass,
  Upload,
  Loader2,
  Copy,
  Check,
  ArrowRight,
  ArrowLeft,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import { STARTER_TEMPLATES, TEMPLATE_META, type StarterTemplateKey } from "@/lib/server-templates"
import { VortexLogo } from "@/components/ui/vortex-logo"
import type { ServerRow } from "@/types/database"

type OnboardingStep = "welcome" | "create" | "invite" | "done"

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]
const MAX_ICON_SIZE = 5 * 1024 * 1024 // 5MB

interface OnboardingFlowProps {
  username: string
  userId: string
}

export function OnboardingFlow({ username, userId }: OnboardingFlowProps) {
  const router = useRouter()
  const { toast } = useToast()
  const { addServer } = useAppStore(useShallow((s) => ({ addServer: s.addServer })))
  const supabase = useMemo(() => createClientSupabaseClient(), [])

  const [step, setStep] = useState<OnboardingStep>("welcome")
  const [selectedTemplate, setSelectedTemplate] = useState<StarterTemplateKey | null>(null)
  const [serverName, setServerName] = useState("")
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [createdServer, setCreatedServer] = useState<ServerRow | null>(null)
  const [copied, setCopied] = useState(false)
  const [origin, setOrigin] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const clearIconState = useCallback(() => {
    setIconFile(null)
    if (iconPreview) URL.revokeObjectURL(iconPreview)
    setIconPreview(null)
    if (fileRef.current) fileRef.current.value = ""
  }, [iconPreview])

  // Revoke blob URL on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (iconPreview?.startsWith("blob:")) {
        URL.revokeObjectURL(iconPreview)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Unsupported image format",
        description: "Server icons must be JPG, PNG, GIF, or WebP.",
      })
      e.target.value = ""
      return
    }

    if (file.size > MAX_ICON_SIZE) {
      toast({
        variant: "destructive",
        title: "Image too large",
        description: "Server icons must be under 5 MB.",
      })
      e.target.value = ""
      return
    }

    setIconFile(file)
    if (iconPreview) URL.revokeObjectURL(iconPreview)
    setIconPreview(URL.createObjectURL(file))
  }, [iconPreview, toast])

  const handleTemplateSelect = useCallback((name: StarterTemplateKey) => {
    setSelectedTemplate((prev) => (prev === name ? null : name))
    if (!serverName) {
      setServerName(`${name} Hub`)
    }
  }, [serverName])

  const handleCreateServer = useCallback(async () => {
    if (loading || !serverName.trim()) return
    setLoading(true)

    let uploadedIconPath: string | null = null
    try {
      let iconUrl = ""

      if (iconFile) {
        const ext = iconFile.name.split(".").pop()
        const path = `${userId}/${crypto.randomUUID()}.${ext}`
        uploadedIconPath = path
        const { error: uploadError } = await supabase.storage
          .from("server-icons")
          .upload(path, iconFile, { upsert: true })
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from("server-icons").getPublicUrl(path)
        iconUrl = urlData.publicUrl
      }

      let server: ServerRow

      if (selectedTemplate && STARTER_TEMPLATES[selectedTemplate]) {
        // Create from template via API
        const res = await fetch("/api/server-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "create-server",
            name: serverName.trim(),
            description: "",
            iconUrl,
            template: STARTER_TEMPLATES[selectedTemplate],
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Server creation failed" }))
          throw new Error(body.error || "Server creation failed")
        }
        const data = await res.json()
        server = data.server as ServerRow
      } else {
        // Plain server creation via API
        const res = await fetch("/api/servers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: serverName.trim(), iconUrl }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Server creation failed" }))
          throw new Error(body.error || "Server creation failed")
        }
        const data = await res.json()
        server = data.server as ServerRow
      }

      // Post system bot welcome message
      try {
        await fetch("/api/onboarding/welcome-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverId: server.id }),
        })
      } catch {
        // Non-critical — server was created successfully even if welcome message fails
      }

      addServer(server)
      setCreatedServer(server)
      setStep("invite")
    } catch (error: unknown) {
      if (uploadedIconPath) {
        await supabase.storage.from("server-icons").remove([uploadedIconPath]).catch(() => {})
      }
      const message = error instanceof Error ? error.message : "Unknown error"
      toast({ variant: "destructive", title: "Failed to create server", description: message })
      clearIconState()
    } finally {
      setLoading(false)
    }
  }, [loading, serverName, iconFile, userId, supabase, selectedTemplate, addServer, toast, clearIconState])

  async function handleCopyInvite(): Promise<void> {
    if (!createdServer) return
    const inviteUrl = `${window.location.origin}/invite/${createdServer.invite_code}`
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      toast({ title: "Invite link copied!" })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ variant: "destructive", title: "Failed to copy invite link" })
    }
  }

  async function markOnboardingComplete(): Promise<void> {
    const res = await fetch("/api/onboarding/complete", { method: "POST" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Failed to complete onboarding" }))
      throw new Error(body.error || "Failed to complete onboarding")
    }
  }

  async function completeOnboarding(): Promise<void> {
    try {
      await markOnboardingComplete()
      if (createdServer) {
        router.push(`/channels/${createdServer.id}`)
      } else {
        router.push("/channels/me")
      }
      router.refresh()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      toast({ variant: "destructive", title: "Couldn't finish onboarding", description: message })
    }
  }

  async function skipOnboarding(): Promise<void> {
    try {
      await markOnboardingComplete()
      router.push("/channels/me")
      router.refresh()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      toast({ variant: "destructive", title: "Couldn't finish onboarding", description: message })
    }
  }

  async function browseServers(): Promise<void> {
    try {
      await markOnboardingComplete()
      router.push("/channels/discover")
      router.refresh()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      toast({ variant: "destructive", title: "Couldn't finish onboarding", description: message })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "var(--theme-bg-primary)" }}>
      {/* Background gradient */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: "radial-gradient(ellipse at 50% 20%, color-mix(in srgb, var(--theme-accent) 30%, transparent), transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-lg mx-4">
        {/* Step: Welcome */}
        {step === "welcome" && (
          <div className="text-center space-y-6 animate-in fade-in duration-300">
            <div className="flex justify-center mb-2">
              <div
                className="w-20 h-20 rounded-3xl flex items-center justify-center"
                style={{ background: "color-mix(in srgb, var(--theme-accent) 20%, var(--theme-bg-secondary))" }}
              >
                <VortexLogo size={40} />
              </div>
            </div>

            <div>
              <h1 className="text-3xl font-bold text-white mb-2">
                Welcome to VortexChat{username ? `, ${username}` : ""}!
              </h1>
              <p className="text-base" style={{ color: "var(--theme-text-secondary)" }}>
                Let's get you set up. Create your own community or discover servers to join.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <Button
                onClick={() => setStep("create")}
                className="w-full h-14 text-base font-semibold rounded-xl"
                style={{ background: "var(--theme-accent)" }}
              >
                <Plus className="w-5 h-5 mr-2" />
                Create a Server
              </Button>

              <Button
                variant="outline"
                onClick={browseServers}
                className="w-full h-14 text-base font-semibold rounded-xl border-2"
                style={{
                  borderColor: "var(--theme-surface-elevated)",
                  background: "var(--theme-bg-secondary)",
                  color: "var(--theme-text-primary)",
                }}
              >
                <Compass className="w-5 h-5 mr-2" />
                Browse Servers
              </Button>
            </div>

            <button
              type="button"
              onClick={skipOnboarding}
              className="text-sm transition-colors hover:underline"
              style={{ color: "var(--theme-text-muted)" }}
            >
              Skip for now
            </button>
          </div>
        )}

        {/* Step: Create Server */}
        {step === "create" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep("welcome")}
                className="flex items-center gap-1 text-sm transition-colors"
                style={{ color: "var(--theme-text-muted)" }}
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <span className="text-xs font-medium" style={{ color: "var(--theme-text-muted)" }}>
                Step 1 of 2
              </span>
            </div>

            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-1">Create Your Server</h2>
              <p className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>
                Pick a template to get started, or go blank.
              </p>
            </div>

            {/* Template grid */}
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(TEMPLATE_META) as StarterTemplateKey[]).map((name) => {
                const meta = TEMPLATE_META[name]
                const Icon = meta.icon
                const isSelected = selectedTemplate === name
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handleTemplateSelect(name)}
                    className="relative p-4 rounded-xl text-left transition-all duration-200 border-2"
                    style={{
                      background: isSelected
                        ? `color-mix(in srgb, ${meta.color} 12%, var(--theme-bg-secondary))`
                        : "var(--theme-bg-secondary)",
                      borderColor: isSelected ? meta.color : "transparent",
                    }}
                  >
                    <Icon
                      className="w-6 h-6 mb-2"
                      style={{ color: meta.color }}
                    />
                    <div className="text-sm font-semibold text-white">{name}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--theme-text-muted)" }}>
                      {meta.description}
                    </div>
                    {isSelected && (
                      <div
                        className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: meta.color }}
                      >
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Or blank */}
            <button
              type="button"
              onClick={() => setSelectedTemplate(null)}
              className="w-full p-3 rounded-xl text-center text-sm transition-all border-2"
              style={{
                background: selectedTemplate === null
                  ? "color-mix(in srgb, var(--theme-accent) 12%, var(--theme-bg-secondary))"
                  : "var(--theme-bg-secondary)",
                borderColor: selectedTemplate === null ? "var(--theme-accent)" : "transparent",
                color: "var(--theme-text-secondary)",
              }}
            >
              Start from scratch (blank server)
            </button>

            {/* Server name + icon */}
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div
                  onClick={() => fileRef.current?.click()}
                  className="w-16 h-16 rounded-2xl border-2 border-dashed flex items-center justify-center cursor-pointer hover:border-white/40 transition-colors overflow-hidden flex-shrink-0"
                  style={{ borderColor: "var(--theme-text-faint)" }}
                >
                  {iconPreview ? (
                    <img src={iconPreview} alt="Server icon preview" className="w-full h-full object-cover" />
                  ) : (
                    <Upload className="w-5 h-5" style={{ color: "var(--theme-text-muted)" }} />
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={handleFileChange} />

                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>
                    Server Name
                  </Label>
                  <Input
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    placeholder="My Awesome Server"
                    onKeyDown={(e) => e.key === "Enter" && serverName.trim() && handleCreateServer()}
                    style={{
                      background: "var(--theme-bg-tertiary)",
                      borderColor: "var(--theme-bg-tertiary)",
                      color: "var(--theme-text-primary)",
                    }}
                  />
                </div>
              </div>

              <Button
                onClick={handleCreateServer}
                disabled={loading || !serverName.trim()}
                className="w-full h-12 text-base font-semibold rounded-xl"
                style={{ background: "var(--theme-accent)" }}
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                ) : (
                  <ArrowRight className="w-5 h-5 mr-2" />
                )}
                {loading ? "Creating..." : "Create Server"}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Invite Friends */}
        {step === "invite" && createdServer && (
          <div className="text-center space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center justify-between">
              <div />
              <span className="text-xs font-medium" style={{ color: "var(--theme-text-muted)" }}>
                Step 2 of 2
              </span>
            </div>

            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
              style={{ background: "color-mix(in srgb, var(--theme-accent) 20%, var(--theme-bg-secondary))" }}
            >
              <Users className="w-8 h-8" style={{ color: "var(--theme-accent)" }} />
            </div>

            <div>
              <h2 className="text-2xl font-bold text-white mb-1">
                &ldquo;{createdServer.name}&rdquo; is ready!
              </h2>
              <p className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>
                Invite friends to your new server. You can always do this later.
              </p>
            </div>

            {/* Invite link display */}
            <div
              className="rounded-xl p-4 space-y-3"
              style={{ background: "var(--theme-bg-secondary)" }}
            >
              <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>
                Invite Link
              </Label>
              <div className="flex items-center gap-2">
                <div
                  className="flex-1 px-3 py-2.5 rounded-lg text-sm truncate select-all"
                  style={{
                    background: "var(--theme-bg-tertiary)",
                    color: "var(--theme-text-primary)",
                  }}
                >
                  {`${origin}/invite/${createdServer.invite_code}`}
                </div>
                <Button
                  onClick={handleCopyInvite}
                  className="flex-shrink-0 h-10 px-4 rounded-lg"
                  style={{ background: "var(--theme-accent)" }}
                >
                  {copied ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <Button
                onClick={completeOnboarding}
                className="w-full h-12 text-base font-semibold rounded-xl"
                style={{ background: "var(--theme-accent)" }}
              >
                Take me to my server
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
