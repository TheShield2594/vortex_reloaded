"use client"

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, memo, type ReactNode } from "react"

interface ServerEmoji {
  id: string
  name: string
  image_url: string
}

// Module-level emoji cache with 5-minute TTL to persist across server navigations
const emojiCache = new Map<string, { emojis: ServerEmoji[]; timestamp: number }>()
const EMOJI_CACHE_TTL = 5 * 60 * 1000

function getCachedEmojis(serverId: string): ServerEmoji[] | null {
  const entry = emojiCache.get(serverId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > EMOJI_CACHE_TTL) {
    emojiCache.delete(serverId)
    return null
  }
  return entry.emojis
}

function setCachedEmojis(serverId: string, emojis: ServerEmoji[]) {
  emojiCache.set(serverId, { emojis, timestamp: Date.now() })
}

interface ServerEmojiContextValue {
  emojis: ServerEmoji[]
  getEmoji: (name: string) => ServerEmoji | null
  reload: () => void
}

const ServerEmojiContext = createContext<ServerEmojiContextValue>({
  emojis: [],
  getEmoji: () => null,
  reload: () => {},
})

/** Returns the current server's custom emoji list, a name-based lookup, and a reload function. */
export function useServerEmojis() {
  return useContext(ServerEmojiContext)
}

export type { ServerEmoji }

/** Fetches and caches server custom emojis, providing a context for child components to resolve :emoji: tokens.
 *  Emoji lists are cached in module-level memory with a 5-minute TTL so that navigating
 *  between servers doesn't re-fetch on every switch. */
export function ServerEmojiProvider({ serverId, initialEmojis, children }: { serverId: string; initialEmojis?: ServerEmoji[]; children: React.ReactNode }) {
  const [emojis, setEmojis] = useState<ServerEmoji[]>(() => {
    // Prefer cached data, then SSR-provided initial data
    return getCachedEmojis(serverId) ?? initialEmojis ?? []
  })
  const controllerRef = useRef<AbortController | null>(null)

  // When serverId changes, use cache if available, else fall back to SSR data
  useEffect(() => {
    const cached = getCachedEmojis(serverId)
    setEmojis(cached ?? initialEmojis ?? [])
  }, [serverId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cache emojis whenever they change
  useEffect(() => {
    if (emojis.length > 0) setCachedEmojis(serverId, emojis)
  }, [serverId, emojis])

  const reload = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const res = await fetch(`/api/servers/${serverId}/emojis`, { signal: controller.signal })
      if (res.ok && !controller.signal.aborted) {
        const data = await res.json()
        setEmojis(data)
        setCachedEmojis(serverId, data)
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") console.error("Failed to reload emojis", err)
    }
  }, [serverId])

  const getEmoji = useCallback((name: string): ServerEmoji | null => {
    return emojis.find((e) => e.name === name) ?? null
  }, [emojis])

  const value = useMemo(() => ({ emojis, getEmoji, reload }), [emojis, getEmoji, reload])

  return (
    <ServerEmojiContext.Provider value={value}>
      {children}
    </ServerEmojiContext.Provider>
  )
}

const DEFAULT_EMOJI_STYLE: React.CSSProperties = { width: 22, height: 22, objectFit: "contain" }

/** Inline component to render :emoji_name: tokens.
 *  Falls back to :name: text when the emoji is unknown or the image fails to load. */
export const ServerEmojiImage = memo(function ServerEmojiImage({ name, size = 22 }: { name: string; size?: number }) {
  const { getEmoji } = useServerEmojis()
  const [broken, setBroken] = useState(false)
  const emoji = getEmoji(name)
  const style = useMemo<React.CSSProperties>(
    () => (size === 22 ? DEFAULT_EMOJI_STYLE : { width: size, height: size, objectFit: "contain" }),
    [size],
  )
  if (!emoji || broken) return <span>:{name}:</span>
  return (
    <img
      src={emoji.image_url}
      alt={`:${name}:`}
      title={`:${name}:`}
      loading="lazy"
      draggable={false}
      className="inline-block align-middle"
      style={style}
      onError={() => setBroken(true)}
    />
  )
})
