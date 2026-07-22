export function buildReplyJumpPath(pathname: string, search: string, messageId: string): string {
  const params = new URLSearchParams(search)
  params.set("message", messageId)
  params.delete("thread")
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

type ReturnShortcutEvent = {
  key: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

export function shouldHandleReturnToContextShortcut(enabled: boolean, event: ReturnShortcutEvent): boolean {
  if (!enabled) return false
  if (event.key !== "Escape") return false
  return !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
}
