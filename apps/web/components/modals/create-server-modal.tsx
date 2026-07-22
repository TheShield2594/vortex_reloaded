"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Upload, X } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import type { ServerRow } from "@/types/database"
import { TemplateManager } from "@/components/modals/template-manager"

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]
const MAX_ICON_SIZE = 5 * 1024 * 1024 // 5MB

interface Props {
  open: boolean
  onClose: () => void
}

/** Dialog for creating a new server (with icon upload), joining via invite code, or applying a server blueprint. */
export function CreateServerModal({ open, onClose }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const { addServer } = useAppStore(
    useShallow((s) => ({ addServer: s.addServer }))
  )
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState("")
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const [joinCode, setJoinCode] = useState("")
  const [mode, setMode] = useState<"create" | "join" | "template">("create")
  const fileRef = useRef<HTMLInputElement>(null)
  const supabase = useMemo(() => createClientSupabaseClient(), [])

  // Revoke blob URL on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (iconPreview && iconPreview.startsWith("blob:")) {
        URL.revokeObjectURL(iconPreview)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreate() {
    if (loading || !name.trim()) return
    setLoading(true)
    let uploadedIconPath: string | null = null
    try {
      let iconUrl: string | undefined

      if (iconFile) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error("Not authenticated")

        const ext = iconFile.name.split(".").pop()
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`
        uploadedIconPath = path
        const { error: uploadError } = await supabase.storage
          .from("server-icons")
          .upload(path, iconFile, { upsert: true })
        if (uploadError) throw uploadError

        const { data: urlData } = supabase.storage
          .from("server-icons")
          .getPublicUrl(path)
        iconUrl = urlData.publicUrl
      }

      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), iconUrl }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Server creation failed" }))
        throw new Error(body.error || "Server creation failed")
      }
      const { server } = await res.json() as { server: ServerRow }

      addServer(server)
      toast({ title: `Server "${server.name}" created!` })
      handleClose()
      router.push(`/channels/${server.id}`)
    } catch (error: unknown) {
      if (uploadedIconPath) {
        await supabase.storage.from("server-icons").remove([uploadedIconPath]).catch(() => {})
      }
      const message = error instanceof Error ? error.message : "Unknown error"
      toast({ variant: "destructive", title: "Failed to create server", description: message })
    } finally {
      setLoading(false)
    }
  }

  async function handleJoin() {
    if (!joinCode.trim()) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .rpc("join_server_by_invite", { p_invite_code: joinCode.trim() })

      if (error) {
        if (error.message.includes("Invalid invite code")) {
          throw new Error("Invalid invite code. Please check and try again.")
        }
        throw error
      }

      const server = data as unknown as ServerRow
      addServer(server)
      toast({ title: `Joined "${server.name}"!` })
      onClose()
      router.push(`/channels/${server.id}`)
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to join server", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setLoading(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
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
  }

  function handleClose() {
    setName("")
    setIconFile(null)
    if (iconPreview) URL.revokeObjectURL(iconPreview)
    setIconPreview(null)
    setJoinCode("")
    setMode("create")
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent style={{ background: 'var(--theme-bg-primary)', borderColor: 'var(--theme-bg-tertiary)', maxWidth: '440px' }}>
        <DialogHeader>
          <DialogTitle className="text-white text-center text-xl">
            {mode === "create"
              ? "Customize Your Server"
              : mode === "join"
                ? "Join a Server"
                : "Import a Blueprint"}
          </DialogTitle>
          <DialogDescription className="sr-only">Create a new server</DialogDescription>
          <p className="text-center text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
            {mode === "create"
              ? "Give your server a personality with a name and icon."
              : mode === "join"
                ? "Enter an invite code to join an existing server."
                : "Start from a reusable server blueprint."}
          </p>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode("create")}
            className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${mode === "create" ? "text-white" : "text-gray-400 hover:text-gray-200"}`}
            style={{ background: mode === "create" ? 'var(--theme-accent)' : 'var(--theme-bg-secondary)' }}
          >
            Create New
          </button>
          <button
            onClick={() => setMode("join")}
            className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${mode === "join" ? "text-white" : "text-gray-400 hover:text-gray-200"}`}
            style={{ background: mode === "join" ? 'var(--theme-accent)' : 'var(--theme-bg-secondary)' }}
          >
            Join Existing
          </button>
          <button
            onClick={() => setMode("template")}
            className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${mode === "template" ? "text-white" : "text-gray-400 hover:text-gray-200"}`}
            style={{ background: mode === "template" ? 'var(--theme-accent)' : 'var(--theme-bg-secondary)' }}
          >
            Import Blueprint
          </button>
        </div>

        {mode === "create" ? (
          <div className="space-y-4">
            {/* Icon upload */}
            <div className="flex justify-center">
              <div
                onClick={() => fileRef.current?.click()}
                className="w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center cursor-pointer hover:border-white/50 transition-colors overflow-hidden"
                style={{ borderColor: 'var(--theme-text-faint)' }}
              >
                {iconPreview ? (
                  <img src={iconPreview} alt="Server icon preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center">
                    <Upload className="w-5 h-5 mx-auto mb-1" style={{ color: 'var(--theme-text-muted)' }} />
                    <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>UPLOAD</span>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={handleFileChange} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="server-name" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
                Server Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="server-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Awesome Server"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                required
                aria-required="true"
                aria-invalid={name.length > 0 && !name.trim()}
                style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)' }}
              />
            </div>

            <Button
              onClick={handleCreate}
              disabled={loading || !name.trim()}
              className="w-full"
              style={{ background: 'var(--theme-accent)' }}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Server
            </Button>
          </div>
        ) : mode === "join" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="server-invite-code" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
                Invite Code
              </Label>
              <Input
                id="server-invite-code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="e.g. abc123def456"
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)' }}
              />
            </div>

            <Button
              onClick={handleJoin}
              disabled={loading || !joinCode.trim()}
              className="w-full"
              style={{ background: 'var(--theme-accent)' }}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Join Server
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="server-template-name" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
                Server Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="server-template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Blueprint Powered Server"
                required
                aria-required="true"
                aria-invalid={name.length > 0 && !name.trim()}
                style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)' }}
              />
            </div>
            <TemplateManager
              createName={name}
              createDescription={""}
              onServerCreated={(server) => {
                addServer(server)
                onClose()
                router.push(`/channels/${server.id}`)
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
