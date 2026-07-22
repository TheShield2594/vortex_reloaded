import { formatDaySeparator } from "@/lib/utils/message-helpers"

interface DaySeparatorProps {
  date: Date
  className?: string
}

export function DaySeparator({ date, className = "px-1" }: DaySeparatorProps): React.ReactElement {
  return (
    <div className={`flex items-center gap-3 my-3 ${className}`} role="separator" aria-label={formatDaySeparator(date)}>
      <div className="flex-1 h-px" style={{ background: "var(--theme-bg-tertiary)" }} />
      <span className="text-xs font-medium flex-shrink-0" style={{ color: "var(--theme-text-muted)" }}>
        {formatDaySeparator(date)}
      </span>
      <div className="flex-1 h-px" style={{ background: "var(--theme-bg-tertiary)" }} />
    </div>
  )
}
