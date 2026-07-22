/** Abstraction over GIF/sticker providers (Klipy primary, Giphy fallback). */

const FETCH_TIMEOUT_MS = 4000

export interface GifResult {
  id: string
  title: string
  previewUrl: string
  gifUrl: string
  url: string | null
}

/** Fetch with an AbortController timeout so upstream hangs don't block the API route. */
async function fetchWithTimeout(input: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ── Klipy ────────────────────────────────────────────────────────────────────

function mapKlipy(gif: Record<string, unknown>): GifResult {
  const media = (gif.files ?? gif.media_formats ?? {}) as Record<string, Record<string, string> | undefined>
  return {
    id: gif.id as string,
    title: (gif.content_description as string) || (gif.title as string) || "GIF",
    previewUrl: media.tinygif?.url ?? media.nanogif?.url ?? "",
    gifUrl: media.gif?.url ?? media.mediumgif?.url ?? "",
    url: media.gif?.url ?? media.mediumgif?.url ?? media.tinygif?.url ?? (gif.itemurl as string) ?? (gif.url as string) ?? null,
  }
}

export async function klipySearch(apiKey: string, query: string, limit = 30): Promise<GifResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.klipy.com/v2/search?key=${apiKey}&q=${encodeURIComponent(query)}&limit=${limit}&contentfilter=medium&media_filter=gif,tinygif`
    )
    if (!res.ok) return []
    const json = await res.json()
    return (json.results ?? []).map(mapKlipy).filter((g: GifResult) => g.previewUrl && (g.url || g.gifUrl))
  } catch {
    return []
  }
}

export async function klipyTrending(apiKey: string, limit = 30): Promise<GifResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.klipy.com/v2/featured?key=${apiKey}&limit=${limit}&contentfilter=medium&media_filter=gif,tinygif`
    )
    if (!res.ok) return []
    const json = await res.json()
    return (json.results ?? []).map(mapKlipy).filter((g: GifResult) => g.previewUrl && (g.url || g.gifUrl))
  } catch {
    return []
  }
}

export async function klipySearchStickers(apiKey: string, query: string, limit = 30): Promise<GifResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.klipy.com/v2/search?key=${apiKey}&q=${encodeURIComponent(query)}&limit=${limit}&contentfilter=medium&searchfilter=sticker&media_filter=gif,tinygif`
    )
    if (!res.ok) return []
    const json = await res.json()
    return (json.results ?? []).map(mapKlipy).filter((g: GifResult) => g.previewUrl && (g.url || g.gifUrl))
  } catch {
    return []
  }
}

export async function klipyTrendingStickers(apiKey: string, limit = 30): Promise<GifResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.klipy.com/v2/featured?key=${apiKey}&limit=${limit}&contentfilter=medium&searchfilter=sticker&media_filter=gif,tinygif`
    )
    if (!res.ok) return []
    const json = await res.json()
    return (json.results ?? []).map(mapKlipy).filter((g: GifResult) => g.previewUrl && (g.url || g.gifUrl))
  } catch {
    return []
  }
}

export async function klipySearchMemes(apiKey: string, query: string, limit = 30): Promise<GifResult[]> {
  const url = `https://api.klipy.com/v2/search?key=${apiKey}&q=${encodeURIComponent(query)}&limit=${limit}&contentfilter=medium&searchfilter=meme&media_filter=gif,tinygif`
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error(`Klipy meme search failed (${res.status})`)
  const json = await res.json()
  return (json.results ?? []).map(mapKlipy).filter((g: GifResult) => g.previewUrl && (g.url || g.gifUrl))
}

export async function klipyTrendingMemes(apiKey: string, limit = 30): Promise<GifResult[]> {
  const url = `https://api.klipy.com/v2/featured?key=${apiKey}&limit=${limit}&contentfilter=medium&searchfilter=meme&media_filter=gif,tinygif`
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error(`Klipy trending memes failed (${res.status})`)
  const json = await res.json()
  return (json.results ?? []).map(mapKlipy).filter((g: GifResult) => g.previewUrl && (g.url || g.gifUrl))
}

export async function klipySuggestions(apiKey: string, query: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.klipy.com/v2/autocomplete?key=${apiKey}&q=${encodeURIComponent(query)}&limit=8`
    )
    if (!res.ok) return []
    const json = await res.json()
    return json.results ?? []
  } catch {
    return []
  }
}

// ── Giphy (fallback) ────────────────────────────────────────────────────────

function mapGiphy(gif: Record<string, unknown>): GifResult {
  const images = (gif.images ?? {}) as Record<string, Record<string, string> | undefined>
  return {
    id: gif.id as string,
    title: (gif.title as string) || "GIF",
    previewUrl:
      images.fixed_width_small?.url ??
      images.preview_gif?.url ??
      images.fixed_width_small_still?.url ??
      images.original_still?.url ??
      "",
    gifUrl: images.original?.url ?? images.downsized?.url ?? "",
    url: (gif.url as string) || null,
  }
}

export async function giphySearch(apiKey: string, query: string, limit = 30): Promise<GifResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=${limit}&rating=pg-13`
    )
    if (!res.ok) return []
    const json = await res.json()
    return (json.data ?? []).map(mapGiphy).filter((g: GifResult) => g.previewUrl && (g.url || g.gifUrl))
  } catch {
    return []
  }
}

export async function giphyTrending(apiKey: string, limit = 30): Promise<GifResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=${limit}&rating=pg-13`
    )
    if (!res.ok) return []
    const json = await res.json()
    return (json.data ?? []).map(mapGiphy).filter((g: GifResult) => g.previewUrl && (g.url || g.gifUrl))
  } catch {
    return []
  }
}

export async function giphySearchStickers(apiKey: string, query: string, limit = 30): Promise<GifResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.giphy.com/v1/stickers/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=${limit}&rating=pg-13`
    )
    if (!res.ok) return []
    const json = await res.json()
    return (json.data ?? []).map(mapGiphy).filter((g: GifResult) => g.previewUrl && (g.url || g.gifUrl))
  } catch {
    return []
  }
}

export async function giphyTrendingStickers(apiKey: string, limit = 30): Promise<GifResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.giphy.com/v1/stickers/trending?api_key=${apiKey}&limit=${limit}&rating=pg-13`
    )
    if (!res.ok) return []
    const json = await res.json()
    return (json.data ?? []).map(mapGiphy).filter((g: GifResult) => g.previewUrl && (g.url || g.gifUrl))
  } catch {
    return []
  }
}

// ── Provider detection ───────────────────────────────────────────────────────

export type GifProvider = "klipy" | "giphy"

export function detectProvider(): { provider: GifProvider; apiKey: string } | null {
  // Klipy takes priority (primary provider)
  const klipyKey = process.env.KLIPY_API_KEY ?? process.env.NEXT_PUBLIC_KLIPY_API_KEY
  if (klipyKey) return { provider: "klipy", apiKey: klipyKey }

  // Giphy as fallback
  const giphyKey = process.env.GIPHY_API_KEY ?? process.env.NEXT_PUBLIC_GIPHY_API_KEY
  if (giphyKey) return { provider: "giphy", apiKey: giphyKey }

  return null
}
