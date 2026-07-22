"use client"

import { useEffect, useState } from "react"

// GIF/sticker requests go through the server-side proxy (caching + no client-side API key exposure)
const GIF_TRENDING_URL = "/api/gif/trending"
const GIF_SEARCH_URL = "/api/gif/search"
const MEME_TRENDING_URL = "/api/meme/trending"
const MEME_SEARCH_URL = "/api/meme/search"
const STICKER_TRENDING_URL = "/api/sticker/trending"
const STICKER_SEARCH_URL = "/api/sticker/search"

export interface MediaResult {
  id: string
  title: string
  previewUrl: string
  gifUrl: string
  url: string | null
}

interface UseGifMemeStickerOptions {
  /** Whether the picker panel is currently open */
  pickerOpen: boolean
  /** Which tab is active */
  activeTab: "emoji" | "gif" | "meme" | "sticker"
}

interface UseGifMemeStickerReturn {
  gifQuery: string
  setGifQuery: (q: string) => void
  gifResults: MediaResult[]
  gifLoading: boolean
  gifSuggestions: string[]

  memeQuery: string
  setMemeQuery: (q: string) => void
  memeResults: MediaResult[]
  memeLoading: boolean
  memesAvailable: boolean | null

  stickerQuery: string
  setStickerQuery: (q: string) => void
  stickerResults: MediaResult[]
  stickerLoading: boolean

  /** When memes become unavailable, this suggests falling back to the gif tab */
  shouldFallbackToGif: boolean
  /** Call after consuming the fallback signal */
  clearFallbackSignal: () => void
}

export function useGifMemeSticker({ pickerOpen, activeTab }: UseGifMemeStickerOptions): UseGifMemeStickerReturn {
  const [gifQuery, setGifQuery] = useState("")
  const [gifResults, setGifResults] = useState<MediaResult[]>([])
  const [gifLoading, setGifLoading] = useState(false)
  const [gifSuggestions, setGifSuggestions] = useState<string[]>([])

  const [memeQuery, setMemeQuery] = useState("")
  const [memeResults, setMemeResults] = useState<MediaResult[]>([])
  const [memeLoading, setMemeLoading] = useState(false)
  const [memesAvailable, setMemesAvailable] = useState<boolean | null>(null)

  const [stickerQuery, setStickerQuery] = useState("")
  const [stickerResults, setStickerResults] = useState<MediaResult[]>([])
  const [stickerLoading, setStickerLoading] = useState(false)

  const [shouldFallbackToGif, setShouldFallbackToGif] = useState(false)

  // Fetch GIF results (trending or search)
  useEffect(() => {
    if (!pickerOpen || activeTab !== "gif") return

    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      setGifLoading(true)
      try {
        const endpoint = gifQuery.trim()
          ? `${GIF_SEARCH_URL}?q=${encodeURIComponent(gifQuery.trim())}`
          : GIF_TRENDING_URL
        const res = await fetch(endpoint, { signal: controller.signal })
        const json = await res.json()
        setGifResults(Array.isArray(json) ? json : [])
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return
        setGifResults([])
      } finally {
        setGifLoading(false)
      }
    }, 400)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [pickerOpen, activeTab, gifQuery])

  // Fetch GIF search autocomplete suggestions as user types
  useEffect(() => {
    if (!pickerOpen || activeTab !== "gif" || gifQuery.trim().length < 2) {
      setGifSuggestions([])
      return
    }
    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/gif/suggestions?q=${encodeURIComponent(gifQuery.trim())}`, { signal: controller.signal })
        const json = await res.json()
        setGifSuggestions(Array.isArray(json) ? json : [])
      } catch {
        // ignore abort / network errors
      }
    }, 300)
    return () => { clearTimeout(timeout); controller.abort() }
  }, [pickerOpen, activeTab, gifQuery])

  // Fetch sticker results (trending or search)
  useEffect(() => {
    if (!pickerOpen || activeTab !== "sticker") return

    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      setStickerLoading(true)
      try {
        const endpoint = stickerQuery.trim()
          ? `${STICKER_SEARCH_URL}?q=${encodeURIComponent(stickerQuery.trim())}`
          : STICKER_TRENDING_URL
        const res = await fetch(endpoint, { signal: controller.signal })
        const json = await res.json()
        setStickerResults(Array.isArray(json) ? json : [])
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return
        setStickerResults([])
      } finally {
        setStickerLoading(false)
      }
    }, 400)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [pickerOpen, activeTab, stickerQuery])

  // Fetch meme results (trending or search)
  useEffect(() => {
    if (!pickerOpen || activeTab !== "meme") return

    // If we already know memes are unavailable, skip fetching
    if (memesAvailable === false) return

    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      setMemeLoading(true)
      try {
        const endpoint = memeQuery.trim()
          ? `${MEME_SEARCH_URL}?q=${encodeURIComponent(memeQuery.trim())}`
          : MEME_TRENDING_URL
        const res = await fetch(endpoint, { signal: controller.signal })
        if (!res.ok) {
          // Non-OK response shouldn't permanently disable memes — just show empty for this request
          setMemeResults([])
          return
        }
        const json = await res.json()
        const results = Array.isArray(json) ? json : []
        if (!Array.isArray(json)) {
          // Non-array payload is a server error, not proof memes are unavailable
          setMemeResults([])
          return
        }
        setMemeResults(results)
        // Trending returned empty with no query → memes aren't available (Giphy fallback)
        if (!memeQuery.trim() && results.length === 0) {
          setMemesAvailable(false)
          setShouldFallbackToGif(true)
        } else if (results.length > 0) {
          setMemesAvailable(true)
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return
        setMemeResults([])
      } finally {
        setMemeLoading(false)
      }
    }, 400)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [pickerOpen, activeTab, memeQuery, memesAvailable])

  return {
    gifQuery, setGifQuery, gifResults, gifLoading, gifSuggestions,
    memeQuery, setMemeQuery, memeResults, memeLoading, memesAvailable,
    stickerQuery, setStickerQuery, stickerResults, stickerLoading,
    shouldFallbackToGif,
    clearFallbackSignal: () => setShouldFallbackToGif(false),
  }
}
