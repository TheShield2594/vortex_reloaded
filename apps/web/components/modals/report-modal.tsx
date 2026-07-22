"use client"

import { useState } from "react"
import { Loader2, AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"

import { REPORT_REASONS } from "@/lib/report-reasons"

interface Props {
  open: boolean
  onClose: () => void
  /** The user being reported */
  reportedUserId: string
  reportedUsername: string
  /** Optional message ID if reporting a specific message */
  reportedMessageId?: string
  /** Optional server context */
  serverId?: string
}

export function ReportModal({
  open,
  onClose,
  reportedUserId,
  reportedUsername,
  reportedMessageId,
  serverId,
}: Props) {
  const { toast } = useToast()
  const [reason, setReason] = useState<string>("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)

  function handleClose() {
    setReason("")
    setDescription("")
    onClose()
  }

  async function handleSubmit() {
    if (!reason) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reported_user_id: reportedUserId,
          reported_message_id: reportedMessageId || undefined,
          server_id: serverId || undefined,
          reason,
          description: description.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Report submission failed" }))
        throw new Error(data.error || "Report submission failed")
      }

      toast({ title: "Report submitted", description: "A moderator will review your report." })
      handleClose()
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Failed to submit report",
        description: error instanceof Error ? error.message : "Please try again.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        style={{
          background: "var(--theme-bg-primary)",
          borderColor: "var(--theme-bg-tertiary)",
          color: "var(--theme-text-primary)",
          maxWidth: "480px",
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <AlertTriangle className="w-5 h-5" style={{ color: "var(--theme-warning)" }} />
            Report {reportedUsername}
          </DialogTitle>
          <DialogDescription style={{ color: "var(--theme-text-secondary)" }}>
            {reportedMessageId
              ? "Report this message to server moderators for review."
              : "Report this user to server moderators for review."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label
              className="text-xs font-semibold uppercase tracking-wider mb-2 block"
              style={{ color: "var(--theme-text-secondary)" }}
            >
              Reason <span className="text-red-500">*</span>
            </Label>
            <div className="space-y-2" role="radiogroup" aria-label="Report reason">
              {REPORT_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={reason === r.value}
                  onClick={() => setReason(r.value)}
                  className="w-full flex items-start gap-3 p-3 rounded text-left transition-colors"
                  style={{
                    background:
                      reason === r.value ? "var(--theme-accent)" : "var(--theme-bg-secondary)",
                    border: `1px solid ${reason === r.value ? "var(--theme-accent)" : "transparent"}`,
                  }}
                >
                  <div>
                    <div className="text-sm font-medium text-white">{r.label}</div>
                    <div
                      className="text-xs mt-0.5"
                      style={{
                        color:
                          reason === r.value
                            ? "rgba(255,255,255,0.7)"
                            : "var(--theme-text-muted)",
                      }}
                    >
                      {r.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label
              className="text-xs font-semibold uppercase tracking-wider mb-2 block"
              style={{ color: "var(--theme-text-secondary)" }}
            >
              Additional Details (optional)
            </Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide any additional context for moderators..."
              maxLength={1000}
              rows={3}
              className="w-full rounded px-3 py-2 text-sm resize-none focus:outline-none"
              style={{
                background: "var(--theme-bg-tertiary)",
                color: "var(--theme-text-primary)",
                border: "1px solid var(--theme-bg-tertiary)",
              }}
            />
            <p className="text-xs mt-1" style={{ color: "var(--theme-text-muted)" }}>
              {description.length}/1000
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={handleClose}
            style={{ color: "var(--theme-text-secondary)" }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!reason || submitting}
            variant="destructive"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
