"use client"

/**
 * use-local-search.ts
 *
 * React hook that wraps the LocalSearchIndex singleton and manages:
 *   - Feeding decrypted messages into the index (incremental + bulk)
 *   - Lazy background indexing of historical DM pages
 *   - Secure teardown on logout / channel leave
 *
 * Usage in a DM component:
 *
 *   const { indexMessages, addMessage, search, clearChannel } = useLocalSearch()
 *
 *   // After decrypting a batch of messages:
 *   indexMessages(channelId, decryptedDocs)
 *
 *   // On a new realtime message (after decryption):
 *   addMessage(channelId, decryptedDoc)
 *
 *   // Run a search:
 *   const results = search("hello world", channelId)
 *
 *   // On unmount / channel close:
 *   clearChannel(channelId)
 *
 *   // On logout (call once):
 *   clearAll()
 */

import { useCallback, useEffect, useRef } from "react"
import {
  localSearchIndex,
  type IndexedDocument,
  type LocalSearchResult,
} from "@/lib/local-search-index"

// How long to wait between lazy-load batches (ms) to avoid blocking the UI.
const LAZY_BATCH_DELAY_MS = 600

export interface UseLocalSearchReturn {
  /**
   * Bulk-index an array of already-decrypted documents for a channel.
   * Safe to call multiple times; duplicate message IDs are re-indexed
   * (updated) automatically.
   */
  indexMessages: (channelId: string, docs: IndexedDocument[]) => void

  /**
   * Index a single newly-arrived (realtime) message.
   */
  addMessage: (channelId: string, doc: IndexedDocument) => void

  /**
   * Remove a previously indexed message (e.g. on delete).
   */
  removeMessage: (messageId: string) => void

  /**
   * Search the index, optionally scoped to a channel.
   */
  search: (query: string, channelId?: string, limit?: number) => LocalSearchResult[]

  /**
   * Schedule lazy background indexing of historical message pages.
   * Pass a loader function that accepts a `before` cursor and an
   * AbortSignal (for cancellation) and returns decrypted docs.
   * The hook will call it repeatedly until it returns an empty array
   * or the memory cap for the channel is reached.
   *
   * The loading runs in the background and does NOT update React state,
   * so it will not cause re-renders.
   */
  startLazyIndexing: (
    channelId: string,
    loader: (before: string | null, signal: AbortSignal) => Promise<IndexedDocument[]>
  ) => void

  /**
   * Stop any in-progress lazy indexing for a channel.
   */
  stopLazyIndexing: (channelId: string) => void

  /**
   * Remove all indexed documents for a channel.
   * Call this when the user closes / leaves a DM channel.
   */
  clearChannel: (channelId: string) => void

  /**
   * Wipe the entire index.  Call on logout.
   */
  clearAll: () => void
}

export function useLocalSearch(): UseLocalSearchReturn {
  // Track active lazy-loading AbortControllers per channel.
  const lazyAbortRefs = useRef<Map<string, AbortController>>(new Map())

  // Cleanup all lazy loaders when the hook consumer unmounts.
  useEffect(() => {
    return () => {
      for (const controller of lazyAbortRefs.current.values()) {
        controller.abort()
      }
    }
  }, [])

  const indexMessages = useCallback((channelId: string, docs: IndexedDocument[]) => {
    localSearchIndex.addDocuments(docs)
  }, [])

  const addMessage = useCallback((_channelId: string, doc: IndexedDocument) => {
    localSearchIndex.addDocument(doc)
  }, [])

  const removeMessage = useCallback((messageId: string) => {
    localSearchIndex.removeDocument(messageId)
  }, [])

  const search = useCallback(
    (query: string, channelId?: string, limit?: number): LocalSearchResult[] => {
      return localSearchIndex.search(query, channelId, limit)
    },
    []
  )

  const startLazyIndexing = useCallback(
    (
      channelId: string,
      loader: (before: string | null, signal: AbortSignal) => Promise<IndexedDocument[]>
    ) => {
      // Abort any existing run for this channel.
      lazyAbortRefs.current.get(channelId)?.abort()
      const controller = new AbortController()
      lazyAbortRefs.current.set(channelId, controller)

      // Run in the background without blocking renders.
      void (async () => {
        let before: string | null = null

        while (!controller.signal.aborted) {
          let batch: IndexedDocument[]
          try {
            batch = await loader(before, controller.signal)
          } catch {
            break
          }

          if (controller.signal.aborted) break
          if (batch.length === 0) break

          localSearchIndex.addDocuments(batch)

          // Next cursor: the earliest createdAt in this batch.
          const earliest = batch.reduce<string | null>((min, d) => {
            if (min === null || d.createdAt < min) return d.createdAt
            return min
          }, null)

          // No-progress guard: if the cursor didn't advance, stop to avoid
          // an infinite loop when the loader keeps returning the same page.
          if (earliest !== null && earliest === before) break

          before = earliest

          // Small pause to avoid starving the UI thread.
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, LAZY_BATCH_DELAY_MS)
            controller.signal.addEventListener("abort", () => {
              clearTimeout(timer)
              resolve()
            }, { once: true })
          })
        }

        // Clean up the ref if we finished normally (not aborted externally).
        if (!controller.signal.aborted) {
          lazyAbortRefs.current.delete(channelId)
        }
      })()
    },
    []
  )

  const stopLazyIndexing = useCallback((channelId: string) => {
    lazyAbortRefs.current.get(channelId)?.abort()
    lazyAbortRefs.current.delete(channelId)
  }, [])

  const clearChannel = useCallback((channelId: string) => {
    lazyAbortRefs.current.get(channelId)?.abort()
    lazyAbortRefs.current.delete(channelId)
    localSearchIndex.clearChannel(channelId)
  }, [])

  const clearAll = useCallback(() => {
    for (const controller of lazyAbortRefs.current.values()) {
      controller.abort()
    }
    lazyAbortRefs.current.clear()
    localSearchIndex.clearAll()
  }, [])

  return {
    indexMessages,
    addMessage,
    removeMessage,
    search,
    startLazyIndexing,
    stopLazyIndexing,
    clearChannel,
    clearAll,
  }
}
