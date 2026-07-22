export const REPORT_REASON_VALUES = ["spam", "harassment", "inappropriate_content", "other"] as const

export type ReportReason = (typeof REPORT_REASON_VALUES)[number]

export const REPORT_REASONS = [
  { value: "spam" as const, label: "Spam", description: "Unwanted or repetitive content" },
  { value: "harassment" as const, label: "Harassment", description: "Targeting or bullying a user" },
  {
    value: "inappropriate_content" as const,
    label: "Inappropriate Content",
    description: "NSFW, violent, or otherwise inappropriate material",
  },
  { value: "other" as const, label: "Other", description: "A reason not listed above" },
] as const
