interface TypingIndicatorProps {
  users: string[]
}

function buildTypingText(users: string[]): string {
  if (users.length === 1) {
    return `${users[0]} is typing…`
  }

  if (users.length === 2) {
    return `${users[0]} and ${users[1]} are typing…`
  }

  return `${users[0]} and ${users.length - 1} others are typing…`
}

/** Shared typing indicator for chat and DM surfaces. */
export function TypingIndicator({ users }: TypingIndicatorProps) {
  if (users.length === 0) {
    return null
  }

  return (
    <div className="px-4 py-1 flex items-center gap-1.5 flex-shrink-0 composer-presence-rail overflow-hidden" style={{ minHeight: "24px" }} role="status" aria-live="polite">
      <span className="flex gap-0.5 items-end" aria-hidden="true">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </span>
      <span className="text-xs truncate min-w-0 block" style={{ color: "var(--theme-text-muted)" }}>
        {buildTypingText(users)}
      </span>
    </div>
  )
}
