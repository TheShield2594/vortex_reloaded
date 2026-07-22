export const APPEAL_STATUSES = ["submitted", "reviewing", "approved", "denied", "closed"] as const
export type AppealStatus = (typeof APPEAL_STATUSES)[number]

const TERMINAL_APPEAL_STATUSES: AppealStatus[] = ["approved", "denied", "closed"]

const allowedTransitions: Record<AppealStatus, AppealStatus[]> = {
  submitted: ["reviewing", "closed"],
  reviewing: ["approved", "denied", "closed"],
  approved: ["closed"],
  denied: ["closed"],
  closed: [],
}

export function isValidAppealStatus(status: string): status is AppealStatus {
  return APPEAL_STATUSES.includes(status as AppealStatus)
}

export function isValidAppealTransition(from: AppealStatus, to: AppealStatus): boolean {
  return (allowedTransitions[from] ?? []).includes(to)
}

function containsBadPattern(statement: string): boolean {
  return /(unban me now|free nitro|http:\/\/|\.ru\b|discord\.gift)/i.test(statement)
}

export function isTerminalAppealStatus(status: AppealStatus): boolean {
  return TERMINAL_APPEAL_STATUSES.includes(status)
}

export function computeAntiAbuseScore(input: {
  statement: string
  evidenceAttachments: string[]
  recentAppealCount: number
  isRepeatOffender?: boolean
  accountAgeDays?: number
}): number {
  let score = 0
  if (input.statement.length < 80) score += 15
  if (input.statement.length > 2000) score += 10
  if (input.evidenceAttachments.length > 8) score += 25
  if (input.recentAppealCount > 2) score += 30
  if (input.isRepeatOffender) score += 20
  if (typeof input.accountAgeDays === "number" && input.accountAgeDays < 3) score += 10
  if (containsBadPattern(input.statement)) score += 15
  return Math.min(100, score)
}

export function sanitizeEvidenceAttachments(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => Boolean(item) && item.length <= 2000)
    .filter((item) => {
      try {
        const parsed = new URL(item)
        return parsed.protocol === "https:" || parsed.protocol === "http:"
      } catch {
        return false
      }
    })
    .slice(0, 10)
}
