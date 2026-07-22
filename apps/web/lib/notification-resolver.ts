export type NotificationMode = "all" | "mentions" | "muted"
export type NotificationEventType = "message" | "mention"

export interface NotificationSetting {
  user_id: string
  mode: NotificationMode
  server_id?: string | null
  channel_id?: string | null
  thread_id?: string | null
}

export interface ResolvedNotification {
  mode: NotificationMode
  shouldPush: boolean
  shouldBadge: boolean
}

/**
 * Deterministic notification precedence:
 * thread override > channel override > server override > global default
 */
export function resolveNotification(
  userId: string,
  serverId: string | null,
  channelId: string | null,
  threadId: string | null,
  eventType: NotificationEventType,
  settings: NotificationSetting[] = [],
  globalDefault: NotificationMode = "all"
): ResolvedNotification {
  const byUser = settings.filter((row) => row.user_id === userId)

  const threadOverride = threadId
    ? byUser.find((row) => row.thread_id === threadId)
    : undefined

  const channelOverride = channelId
    ? byUser.find((row) => row.channel_id === channelId && !row.thread_id)
    : undefined

  const serverOverride = serverId
    ? byUser.find((row) => row.server_id === serverId && !row.channel_id && !row.thread_id)
    : undefined

  const globalOverride = byUser.find(
    (row) => !row.server_id && !row.channel_id && !row.thread_id
  )

  const mode =
    threadOverride?.mode ??
    channelOverride?.mode ??
    serverOverride?.mode ??
    globalOverride?.mode ??
    globalDefault

  const shouldNotify = mode === "all" || (mode === "mentions" && eventType === "mention")

  return {
    mode,
    shouldPush: shouldNotify,
    shouldBadge: shouldNotify,
  }
}
