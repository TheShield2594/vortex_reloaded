"use client"

import { useEffect, useState } from "react"
import { Loader2, CheckCircle, XCircle, Clock, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { REPORT_REASONS } from "@/lib/report-reasons"
import { REPORT_STATUSES, type ReportStatus } from "@/lib/report-status"

interface ReportUser {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
}

interface Report {
  id: string
  reporter_id: string
  reported_user_id: string
  reported_message_id: string | null
  server_id: string
  reason: string
  description: string | null
  status: ReportStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  reporter: ReportUser | null
  reported_user: ReportUser | null
  reviewer: { id: string; username: string; display_name: string | null } | null
}

const STATUS_FILTERS: ReadonlyArray<{ value: "" | ReportStatus; label: string }> = [
  { value: "", label: "All" },
  ...REPORT_STATUSES.map((status) => ({
    value: status,
    label: status.charAt(0).toUpperCase() + status.slice(1),
  })),
]

const REASON_LABELS: Record<string, string> = Object.fromEntries(
  REPORT_REASONS.map((r) => [r.value, r.label])
)

function getStatusIcon(status: ReportStatus) {
  switch (status) {
    case "pending":
      return <Clock className="w-3.5 h-3.5" style={{ color: "var(--theme-warning)" }} />
    case "reviewed":
      return <ExternalLink className="w-3.5 h-3.5" style={{ color: "var(--theme-accent)" }} />
    case "resolved":
      return <CheckCircle className="w-3.5 h-3.5" style={{ color: "var(--theme-success)" }} />
    case "dismissed":
      return <XCircle className="w-3.5 h-3.5" style={{ color: "var(--theme-text-muted)" }} />
    default:
      return null
  }
}

interface Props {
  serverId: string
}

export function ReportsTab({ serverId }: Props) {
  const { toast } = useToast()
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<"" | ReportStatus>("")
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    async function fetchReports() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ server_id: serverId })
        if (statusFilter) params.set("status", statusFilter)
        const res = await fetch(`/api/reports?${params.toString()}`)
        if (!res.ok) throw new Error("Failed to fetch reports")
        const data = await res.json()
        setReports(data)
      } catch (error: unknown) {
        toast({
          variant: "destructive",
          title: "Failed to load reports",
          description: error instanceof Error ? error.message : "Unknown error",
        })
      } finally {
        setLoading(false)
      }
    }
    fetchReports()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, statusFilter])

  async function updateReportStatus(reportId: string, newStatus: ReportStatus) {
    setUpdatingId(reportId)
    try {
      const res = await fetch("/api/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_id: reportId,
          server_id: serverId,
          status: newStatus,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to update report" }))
        throw new Error(data.error || "Failed to update report")
      }

      const updated = await res.json()
      setReports((prev) =>
        prev.map((r) => (r.id === reportId ? { ...r, ...updated } : r))
      )
      toast({ title: `Report ${newStatus}` })
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Failed to update report",
        description: error instanceof Error ? error.message : "Unknown error",
      })
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Reports</h2>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              type="button"
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
              style={{
                background:
                  statusFilter === f.value ? "var(--theme-accent)" : "var(--theme-bg-secondary)",
                color:
                  statusFilter === f.value ? "white" : "var(--theme-text-muted)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--theme-text-muted)" }} />
        </div>
      )}

      {!loading && reports.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
            {statusFilter ? `No ${statusFilter} reports` : "No reports yet"}
          </p>
        </div>
      )}

      {!loading && reports.length > 0 && (
        <div className="space-y-3">
          {reports.map((report) => (
            <div
              key={report.id}
              className="rounded-lg p-4 space-y-3"
              style={{
                background: "var(--theme-bg-secondary)",
                border: "1px solid var(--theme-bg-tertiary)",
              }}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {getStatusIcon(report.status)}
                  <span
                    className="text-xs font-medium uppercase tracking-wide"
                    style={{ color: "var(--theme-text-muted)" }}
                  >
                    {report.status}
                  </span>
                  <span className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                    {new Date(report.created_at).toLocaleDateString()} at{" "}
                    {new Date(report.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <span
                  className="flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium"
                  style={{
                    background:
                      report.reason === "harassment"
                        ? "rgba(242,63,67,0.15)"
                        : "rgba(88,101,242,0.15)",
                    color:
                      report.reason === "harassment"
                        ? "var(--theme-danger)"
                        : "var(--theme-accent)",
                  }}
                >
                  {REASON_LABELS[report.reason] ?? report.reason}
                </span>
              </div>

              {/* Users row */}
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span style={{ color: "var(--theme-text-muted)" }}>Reported by:</span>
                  <UserBadge user={report.reporter} />
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ color: "var(--theme-text-muted)" }}>Against:</span>
                  <UserBadge user={report.reported_user} />
                </div>
              </div>

              {/* Description */}
              {report.description && (
                <p
                  className="text-sm rounded px-3 py-2"
                  style={{
                    color: "var(--theme-text-normal)",
                    background: "var(--theme-bg-tertiary)",
                  }}
                >
                  {report.description}
                </p>
              )}

              {/* Message ID reference */}
              {report.reported_message_id && (
                <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                  Message ID: {report.reported_message_id}
                </p>
              )}

              {/* Reviewer info */}
              {report.reviewer && report.reviewed_at && (
                <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                  Reviewed by {report.reviewer.display_name || report.reviewer.username} on{" "}
                  {new Date(report.reviewed_at).toLocaleDateString()}
                </p>
              )}

              {/* Action buttons — only for pending/reviewed reports */}
              {(report.status === "pending" || report.status === "reviewed") && (
                <div className="flex items-center gap-2 pt-1">
                  {report.status === "pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updatingId === report.id}
                      onClick={() => updateReportStatus(report.id, "reviewed")}
                      style={{
                        borderColor: "var(--theme-bg-tertiary)",
                        color: "var(--theme-text-secondary)",
                        background: "transparent",
                      }}
                    >
                      {updatingId === report.id ? (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : (
                        <ExternalLink className="mr-1.5 h-3 w-3" />
                      )}
                      Mark Reviewed
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={updatingId === report.id}
                    onClick={() => updateReportStatus(report.id, "resolved")}
                    style={{
                      borderColor: "var(--theme-bg-tertiary)",
                      color: "var(--theme-success)",
                      background: "transparent",
                    }}
                  >
                    {updatingId === report.id ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <CheckCircle className="mr-1.5 h-3 w-3" />
                    )}
                    Resolve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={updatingId === report.id}
                    onClick={() => updateReportStatus(report.id, "dismissed")}
                    style={{
                      borderColor: "var(--theme-bg-tertiary)",
                      color: "var(--theme-text-muted)",
                      background: "transparent",
                    }}
                  >
                    {updatingId === report.id ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <XCircle className="mr-1.5 h-3 w-3" />
                    )}
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UserBadge({ user }: { user: ReportUser | null }) {
  if (!user) return <span className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Unknown</span>
  const displayName = user.display_name || user.username
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <div className="flex items-center gap-1.5">
      <Avatar className="w-5 h-5">
        {user.avatar_url && <AvatarImage src={user.avatar_url} />}
        <AvatarFallback
          style={{
            background: "var(--theme-accent)",
            color: "white",
            fontSize: "8px",
          }}
        >
          {initials}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm font-medium text-white">{displayName}</span>
    </div>
  )
}
