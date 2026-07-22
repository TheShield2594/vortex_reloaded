import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react"

interface UseChatScrollArgs {
  hasMoreHistory: boolean
  loadOlderMessages: () => Promise<void>
  messageScrollerRef: MutableRefObject<HTMLDivElement | null>
  paginationRequestRef: MutableRefObject<Promise<unknown> | null>
  /** Session-storage key for persisting scroll offset. Omit to skip persistence. */
  scrollStorageKey?: string
  /** Session-storage key for unread anchor. Omit to skip anchor cleanup. */
  unreadAnchorStorageKey?: string
  onReachedBottom: () => void
}

/**
 * Scroll management hook for the column-reverse message container.
 *
 * In a column-reverse layout, scrollTop === 0 means the user is at
 * the very bottom (most recent messages visible).  Scrolling "up"
 * (toward older messages) increases scrollTop.
 */
export function useChatScroll({
  hasMoreHistory,
  loadOlderMessages,
  messageScrollerRef,
  paginationRequestRef,
  scrollStorageKey,
  unreadAnchorStorageKey,
  onReachedBottom,
}: UseChatScrollArgs) {
  const [isAtBottom, setIsAtBottom] = useState(true)
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const container = messageScrollerRef.current
    if (!container) return

    const persistScroll = () => {
      if (scrollStorageKey && typeof window !== "undefined") {
        window.sessionStorage.setItem(scrollStorageKey, String(container.scrollTop))
      }
    }

    const onScroll = () => {
      // In column-reverse, scrollTop is 0 at bottom and increases as
      // you scroll toward older messages.  Large scrollTop = near old
      // messages = trigger pagination.
      const scrollTop = container.scrollTop

      // Load older messages when scrolled far enough toward history.
      // scrollHeight - clientHeight - scrollTop gives the distance from
      // the visual "top" (oldest messages).
      const distanceFromOldest = container.scrollHeight - container.clientHeight - scrollTop
      if (distanceFromOldest < 120 && hasMoreHistory && !paginationRequestRef.current) {
        void loadOlderMessages()
      }

      // In column-reverse, scrollTop near 0 = at bottom (newest messages)
      const nextIsAtBottom = scrollTop < 120
      setIsAtBottom(nextIsAtBottom)

      if (scrollStorageKey) {
        if (scrollSaveTimerRef.current) {
          clearTimeout(scrollSaveTimerRef.current)
        }
        scrollSaveTimerRef.current = setTimeout(() => {
          persistScroll()
          scrollSaveTimerRef.current = null
        }, 250)
      }

      if (nextIsAtBottom) {
        onReachedBottom()
        if (unreadAnchorStorageKey && typeof window !== "undefined") {
          window.sessionStorage.removeItem(unreadAnchorStorageKey)
        }
      }
    }

    onScroll()
    container.addEventListener("scroll", onScroll)

    return () => {
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current)
        scrollSaveTimerRef.current = null
      }
      if (scrollStorageKey) persistScroll()
      container.removeEventListener("scroll", onScroll)
    }
  }, [hasMoreHistory, loadOlderMessages, messageScrollerRef, onReachedBottom, paginationRequestRef, scrollStorageKey, unreadAnchorStorageKey])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const container = messageScrollerRef.current
    if (!container) return
    container.scrollTo({ top: 0, behavior })
  }, [messageScrollerRef])

  return { isAtBottom, setIsAtBottom, scrollToBottom }
}
