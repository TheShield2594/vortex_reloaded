export const REPORT_STATUSES = ["pending", "reviewed", "resolved", "dismissed"] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const REPORT_STATUS_TRANSITIONS: ReportStatus[] = ["reviewed", "resolved", "dismissed"]
