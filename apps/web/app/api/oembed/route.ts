import { NextRequest, NextResponse } from "next/server"
import { lookup } from "dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import type { IncomingHttpHeaders } from "node:http"
import { rateLimiter } from "@/lib/rate-limit"
import { getClientIp } from "@vortex/shared"

// Simple Open Graph scraper — fetches a URL and returns title, description, image, siteName
// Runs server-side to avoid CORS issues and to not expose the target URL to analytics.

const TIMEOUT_MS = 5000
const MAX_BODY_BYTES = 256 * 1024 // 256 KB — enough to find <head> tags
const MAX_REDIRECTS = 3

function normalizeHost(value: string): string {
  return value.toLowerCase().replace(/\.+$/, "")
}

const cachedBlockedEmbedDomains = (process.env.EMBED_BLOCKED_DOMAINS ?? "")
  .split(",")
  .map((value) => normalizeHost(value.trim()))
  .filter(Boolean)

function getBlockedEmbedDomains(): string[] {
  return cachedBlockedEmbedDomains
}

function isBlockedEmbedHost(hostname: string): boolean {
  const normalizedHost = normalizeHost(hostname)
  const blocked = getBlockedEmbedDomains()
  return blocked.some((domain) => normalizedHost === domain || normalizedHost.endsWith(`.${domain}`))
}

/** Returns true if the IP falls in a private/reserved range (SSRF guard). */
function isPrivateIp(ip: string): boolean {
  // Unwrap IPv4-mapped IPv6 (::ffff:1.2.3.4)
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (v4mapped) return isPrivateIp(v4mapped[1])

  const parts = ip.split(".").map(Number)
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    const [a, b] = parts
    if (a === 10) return true                           // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12
    if (a === 192 && b === 168) return true             // 192.168.0.0/16
    if (a === 127) return true                          // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true             // 169.254.0.0/16 link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true  // 100.64.0.0/10 CGNAT
    if (a === 0) return true                            // 0.0.0.0/8
    return false
  }

  // IPv6 checks
  if (ip === "::1") return true                        // loopback
  if (/^f[cd]/i.test(ip)) return true                  // fc00::/7 unique local
  if (/^fe[89ab]/i.test(ip)) return true               // fe80::/10 link-local
  return false
}

type ValidatedHost = {
  addresses: Array<{ address: string; family: number }>
}

type PinnedFetchResponse = {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

async function fetchWithPinnedAddress(targetUrl: URL, pinnedAddress: string, signal: AbortSignal): Promise<PinnedFetchResponse> {
  return new Promise((resolve, reject) => {
    const isHttps = targetUrl.protocol === "https:"
    const req = (isHttps ? httpsRequest : httpRequest)({
      protocol: targetUrl.protocol,
      hostname: pinnedAddress,
      port: targetUrl.port ? Number(targetUrl.port) : undefined,
      method: "GET",
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: {
        "User-Agent": "VortexChatBot/1.0 (link preview)",
        Accept: "text/html",
        Host: targetUrl.host,
      },
      servername: targetUrl.hostname,
    }, (res) => {
      const chunks: Buffer[] = []
      let bytesRead = 0
      let settled = false

      const finish = () => {
        if (settled) return
        settled = true
        resolve({
          status: res.statusCode ?? 502,
          headers: res.headers,
          body: Buffer.concat(chunks),
        })
      }

      res.on("data", (chunk: Buffer) => {
        bytesRead += chunk.length
        if (bytesRead > MAX_BODY_BYTES) {
          chunks.push(chunk.subarray(0, chunk.length - (bytesRead - MAX_BODY_BYTES)))
          res.destroy()
          return
        }
        chunks.push(chunk)
      })

      res.on("end", finish)
      res.on("close", finish)
      res.on("error", reject)
    })

    const abortHandler = () => {
      req.destroy(new Error("aborted"))
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
    }

    if (signal.aborted) {
      abortHandler()
      return
    }

    signal.addEventListener("abort", abortHandler, { once: true })
    req.on("error", reject)
    req.end()
  })
}

async function validateHost(parsedUrl: URL): Promise<ValidatedHost | NextResponse> {
  if (isBlockedEmbedHost(parsedUrl.hostname)) {
    return NextResponse.json({ error: "domain blocked" }, { status: 403 })
  }

  try {
    const addresses = (await lookup(parsedUrl.hostname, { all: true }))
      .filter(({ address }) => !isPrivateIp(address))

    if (addresses.length === 0) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    return { addresses }
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  // Rate limit by IP — 30 requests per minute (SSRF-sensitive endpoint)
  const ip = getClientIp(req.headers) ?? "unknown"
  // failClosed: oembed makes server-side HTTP requests — must not allow unlimited traffic when Redis is down
  const rl = await rateLimiter.check(`oembed:${ip}`, { limit: 30, windowMs: 60_000, failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 })
  }

  const url = req.nextUrl.searchParams.get("url")
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 })

  // Only allow http/https
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("bad protocol")
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 })
  }

  const initialValidation = await validateHost(parsedUrl)
  if (initialValidation instanceof NextResponse) return initialValidation
  let currentValidation = initialValidation

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    let currentUrl = parsedUrl
    let resp: PinnedFetchResponse | null = null

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      let fetchError: unknown = null

      for (const { address } of currentValidation.addresses) {
        try {
          resp = await fetchWithPinnedAddress(currentUrl, address, controller.signal)
          fetchError = null
          break
        } catch (error) {
          fetchError = error
        }
      }

      if (!resp) {
        if ((fetchError as { name?: string } | null)?.name === "AbortError") {
          throw fetchError
        }
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }

      if (resp.status >= 300 && resp.status < 400) {
        const location = typeof resp.headers.location === "string" ? resp.headers.location : null
        if (!location) {
          return NextResponse.json({ error: "redirect failed" }, { status: 502 })
        }

        let nextUrl: URL
        try {
          nextUrl = new URL(location, currentUrl)
          if (!["http:", "https:"].includes(nextUrl.protocol)) throw new Error("bad protocol")
        } catch {
          return NextResponse.json({ error: "invalid redirect" }, { status: 400 })
        }

        const validation = await validateHost(nextUrl)
        if (validation instanceof NextResponse) {
          return validation
        }

        currentUrl = nextUrl
        currentValidation = validation
        resp = null
        continue
      }

      break
    }

    if (!resp) {
      return NextResponse.json({ error: "fetch failed" }, { status: 502 })
    }

    if (resp.status >= 300 && resp.status < 400) {
      return NextResponse.json({ error: "too many redirects" }, { status: 502 })
    }

    if (resp.status < 200 || resp.status >= 300) {
      return NextResponse.json({ error: "fetch failed" }, { status: 502 })
    }

    const contentType = Array.isArray(resp.headers["content-type"])
      ? resp.headers["content-type"].join(",")
      : (resp.headers["content-type"] ?? "")
    if (!contentType.includes("text/html")) {
      return NextResponse.json({ error: "not html" }, { status: 422 })
    }

    const html = resp.body.toString("utf-8")
    const og = parseOG(html, currentUrl.origin, currentUrl.protocol)
    return NextResponse.json(og, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    })
  } catch (err: unknown) {
    if ((err as { name?: string } | null)?.name === "AbortError") {
      return NextResponse.json({ error: "timeout" }, { status: 504 })
    }
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  } finally {
    clearTimeout(timer)
  }
}

function parseOG(html: string, origin: string, protocol: string) {
  function meta(prop: string): string | null {
    // Extract each <meta> tag and parse attributes in any order
    const tagRe = /<meta\b[^>]*>/gi
    let tag: RegExpExecArray | null
    while ((tag = tagRe.exec(html)) !== null) {
      const attrs = tag[0]
      const propMatch = attrs.match(/property=["']og:([^"']+)["']/i) ?? attrs.match(/name=["']([^"']+)["']/i)
      const contentMatch = attrs.match(/content=["']([^"']*?)["']/i)
      if (!propMatch || !contentMatch) continue
      const key = propMatch[1].toLowerCase()
      if (key === prop || key === `og:${prop}`) return decodeHTMLEntities(contentMatch[1])
    }
    return null
  }

  const title =
    meta("title") ??
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ??
    null

  const description = meta("description")

  let image = meta("image")
  if (image) {
    if (image.startsWith("//")) {
      image = protocol + image
    } else if (image.startsWith("/")) {
      image = origin + image
    }
  }

  const siteName = meta("site_name") ?? null
  const favicon = `${origin}/favicon.ico`

  return {
    title,
    description,
    image,
    siteName,
    favicon,
  }
}

function decodeHTMLEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|039);|&apos;/g, "'")
}
