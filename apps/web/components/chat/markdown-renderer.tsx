"use client"

import { memo, lazy, Suspense, useState, useEffect, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import type { Plugin } from "unified"
import type { Root, Text, PhrasingContent } from "mdast"
import { visit } from "unist-util-visit"
import { ServerEmojiImage } from "@/components/chat/server-emoji-context"
import { useAppStore } from "@/lib/stores/app-store"

// ─── Big-emoji detection ────────────────────────────────────────────────────

const RE_ONLY_EMOJI = /^(?:\s*(?::([a-z0-9_]+):|[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?(?:\u200D[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?)*)\s*){1,5}$/u

/** Returns true if a message consists of 1-5 emojis (custom or unicode) and nothing else. */
function isOnlyEmoji(content: string): boolean {
  const stripped = content.trim()
  return stripped.length > 0 && stripped.length < 100 && RE_ONLY_EMOJI.test(stripped)
}

// ─── Lazy code highlighter ─────────────────────────────────────────────────

const SUPPORTED_PRISM_LANGUAGES = new Set([
  "markup", "html", "xml", "svg", "mathml", "css", "clike",
  "javascript", "js", "jsx", "typescript", "ts", "tsx",
  "bash", "shell", "python", "py", "ruby", "rb", "go",
  "java", "kotlin", "swift", "c", "cpp", "csharp", "cs",
  "json", "yaml", "markdown", "md", "sql", "graphql",
  "diff", "git", "rust", "php", "r", "scala", "dart",
  "haskell", "erlang", "elixir", "clojure", "groovy",
  "objectivec", "perl", "lua", "coffeescript", "sass",
  "scss", "less", "stylus", "toml", "ini", "dockerfile",
  "nginx", "regex", "wasm", "text",
])

const HighlightedCode = lazy(() =>
  import("prism-react-renderer").then((m) => ({
    default: function HighlightedCodeInner({ code, language }: { code: string; language: string }) {
      return (
        <m.Highlight code={code} language={language} theme={m.themes.nightOwl}>
          {({ style, tokens, getLineProps, getTokenProps }) => (
            <pre className="overflow-x-auto text-sm p-3 font-mono" style={{ ...style, margin: 0 }}>
              {tokens.map((line, i) => (
                <div key={i} {...getLineProps({ line })}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </div>
              ))}
            </pre>
          )}
        </m.Highlight>
      )
    },
  }))
)

// ─── Custom remark plugins ──────────────────────────────────────────────────

/** Generic helper: split text nodes by a regex, replacing matches with HTML nodes. */
function splitTextByPattern(
  regex: RegExp,
  buildHtml: (match: RegExpExecArray) => string,
): Plugin<[], Root> {
  return () => (tree) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index === undefined) return
      const value = node.value
      const parts: PhrasingContent[] = []
      let lastIdx = 0
      let match: RegExpExecArray | null
      regex.lastIndex = 0

      while ((match = regex.exec(value)) !== null) {
        if (match.index > lastIdx) {
          parts.push({ type: "text", value: value.slice(lastIdx, match.index) })
        }
        parts.push({ type: "html", value: buildHtml(match) } as unknown as PhrasingContent)
        lastIdx = match.index + match[0].length
      }

      if (parts.length === 0) return
      if (lastIdx < value.length) {
        parts.push({ type: "text", value: value.slice(lastIdx) })
      }
      parent.children.splice(index, 1, ...parts)
    })
  }
}

/** Remark plugin: :emoji_name: → <vortex-emoji> elements. */
const remarkCustomEmoji = splitTextByPattern(
  /:([a-z0-9_]+):/g,
  (m) => `<vortex-emoji data-name="${m[1]}"></vortex-emoji>`,
)

/** Remark plugin: <@userId> → <vortex-mention> elements. */
const remarkMentions = splitTextByPattern(
  /<@(\w+)>/g,
  (m) => `<vortex-mention data-uid="${m[1]}"></vortex-mention>`,
)

/** Remark plugin: <@&roleId> → <vortex-role-mention> elements. */
const remarkRoleMentions = splitTextByPattern(
  /<@&([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi,
  (m) => `<vortex-role-mention data-rid="${m[1]}"></vortex-role-mention>`,
)

/** Remark plugin: <@bot:personaId> → <vortex-persona-mention> elements. */
const remarkPersonaMentions = splitTextByPattern(
  /<@bot:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi,
  (m) => `<vortex-persona-mention data-pid="${m[1]}"></vortex-persona-mention>`,
)

/** Remark plugin: ||spoiler|| → <vortex-spoiler> elements. */
const remarkSpoiler = splitTextByPattern(
  /\|\|([\s\S]*?)\|\|/g,
  (m) => `<vortex-spoiler>${m[1]}</vortex-spoiler>`,
)

/** Remark plugin: <t:epoch> or <t:epoch:format> → <vortex-timestamp> elements. */
const remarkTimestamps = splitTextByPattern(
  /<t:(\d+)(?::([tTdDfFR]))?>/g,
  (m) => `<vortex-timestamp data-epoch="${m[1]}" data-format="${m[2] ?? "f"}"></vortex-timestamp>`,
)

// ─── Unicode emoji → image replacement ──────────────────────────────────────

/** Convert a unicode emoji codepoint to a Twemoji CDN URL. */
function emojiToTwemojiUrl(emoji: string): string {
  const codePoints = [...emoji]
    .map((c) => c.codePointAt(0)!.toString(16))
    .filter((cp) => cp !== "fe0f") // remove variation selector
    .join("-")
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codePoints}.svg`
}

/** Regex matching common unicode emoji sequences. */
const RE_UNICODE_EMOJI = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})\uFE0F?(?:\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})\uFE0F?)*/gu

/** Remark plugin: unicode emojis → <img> tags with Twemoji SVGs for consistent cross-platform rendering. */
const remarkUnicodeEmoji: Plugin<[], Root> = () => (tree) => {
  visit(tree, "text", (node: Text, index, parent) => {
    if (!parent || index === undefined) return
    const value = node.value
    const parts: PhrasingContent[] = []
    let lastIdx = 0
    let match: RegExpExecArray | null
    RE_UNICODE_EMOJI.lastIndex = 0

    while ((match = RE_UNICODE_EMOJI.exec(value)) !== null) {
      // Skip single digit characters (0-9) that can match emoji regex
      if (match[0].length === 1 && /\d/.test(match[0])) continue

      if (match.index > lastIdx) {
        parts.push({ type: "text", value: value.slice(lastIdx, match.index) })
      }
      const url = emojiToTwemojiUrl(match[0])
      parts.push({
        type: "html",
        value: `<img src="${url}" alt="${match[0]}" class="inline-block align-middle" draggable="false" loading="lazy" style="width:1.25em;height:1.25em" />`,
      } as unknown as PhrasingContent)
      lastIdx = match.index + match[0].length
    }

    if (parts.length === 0) return
    if (lastIdx < value.length) {
      parts.push({ type: "text", value: value.slice(lastIdx) })
    }
    parent.children.splice(index, 1, ...parts)
  })
}

// ─── Timestamp component ────────────────────────────────────────────────────

const TIMESTAMP_FORMATS: Record<string, Intl.DateTimeFormatOptions> = {
  t: { hour: "numeric", minute: "numeric" },
  T: { hour: "numeric", minute: "numeric", second: "numeric" },
  d: { year: "numeric", month: "2-digit", day: "2-digit" },
  D: { year: "numeric", month: "long", day: "numeric" },
  f: { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric" },
  F: { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric" },
}

function TimestampDisplay({ epoch, format }: { epoch: number; format: string }) {
  const date = new Date(epoch * 1000)
  const [relative, setRelative] = useState("")

  useEffect(() => {
    if (format !== "R") return
    function updateRelative() {
      const diff = Math.floor((Date.now() - date.getTime()) / 1000)
      const absDiff = Math.abs(diff)
      const isFuture = diff < 0
      if (absDiff < 60) setRelative(isFuture ? "in a few seconds" : "just now")
      else if (absDiff < 3600) {
        const mins = Math.floor(absDiff / 60)
        setRelative(isFuture ? `in ${mins} minute${mins === 1 ? "" : "s"}` : `${mins} minute${mins === 1 ? "" : "s"} ago`)
      } else if (absDiff < 86400) {
        const hrs = Math.floor(absDiff / 3600)
        setRelative(isFuture ? `in ${hrs} hour${hrs === 1 ? "" : "s"}` : `${hrs} hour${hrs === 1 ? "" : "s"} ago`)
      } else {
        const days = Math.floor(absDiff / 86400)
        setRelative(isFuture ? `in ${days} day${days === 1 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"} ago`)
      }
    }
    updateRelative()
    const id = setInterval(updateRelative, 60_000)
    return () => clearInterval(id)
  }, [epoch, format, date])

  if (isNaN(date.getTime())) return <span>&lt;invalid date&gt;</span>

  const text = format === "R"
    ? relative
    : date.toLocaleString(undefined, TIMESTAMP_FORMATS[format] ?? TIMESTAMP_FORMATS.f)

  return (
    <span
      className="rounded px-1 py-0.5 text-xs"
      style={{ background: "rgba(88,101,242,0.1)", color: "var(--theme-accent)" }}
      title={date.toLocaleString()}
    >
      {text}
    </span>
  )
}

// ─── External link confirmation ─────────────────────────────────────────────

/** Domains considered safe (no confirmation needed). */
const TRUSTED_DOMAINS = new Set([
  "vortexchat.app", "www.vortexchat.app",
  "github.com", "www.github.com",
  "youtube.com", "www.youtube.com", "youtu.be",
  "klipy.com", "media.klipy.com",
  "giphy.com", "media.giphy.com",
  "wikipedia.org",
])

function isTrustedUrl(href: string): boolean {
  try {
    const url = new URL(href)
    const host = url.hostname.toLowerCase()
    if (TRUSTED_DOMAINS.has(host)) return true
    // Same origin
    if (typeof window !== "undefined" && url.origin === window.location.origin) return true
    return false
  } catch {
    return false
  }
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const [showConfirm, setShowConfirm] = useState(false)

  if (!href) return <>{children}</>

  function handleClick(e: React.MouseEvent) {
    if (isTrustedUrl(href)) return // let the native <a> navigate
    e.preventDefault()
    setShowConfirm(true)
  }

  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline"
        style={{ color: "var(--theme-link)" }}
        onClick={handleClick}
      >
        {children}
      </a>
      {showConfirm && (
        <span
          className="inline-flex items-center gap-2 ml-1 text-xs rounded px-2 py-0.5"
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-surface-elevated)" }}
        >
          <span style={{ color: "var(--theme-text-muted)" }}>Open external link?</span>
          <button
            type="button"
            className="font-medium hover:underline"
            style={{ color: "var(--theme-accent)" }}
            onClick={() => { window.open(href, "_blank", "noopener,noreferrer"); setShowConfirm(false) }}
          >
            Yes
          </button>
          <button
            type="button"
            className="font-medium hover:underline"
            style={{ color: "var(--theme-text-muted)" }}
            onClick={() => setShowConfirm(false)}
          >
            No
          </button>
        </span>
      )}
    </>
  )
}

// ─── Spoiler component ──────────────────────────────────────────────────────

function SpoilerSpan({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setRevealed((v) => !v)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setRevealed((v) => !v) }}
      className="rounded px-0.5 cursor-pointer transition-colors"
      style={{
        background: revealed ? "rgba(255,255,255,0.06)" : "var(--theme-text-primary)",
        color: revealed ? "inherit" : "transparent",
      }}
      aria-label={revealed ? "Hide spoiler" : "Reveal spoiler"}
    >
      {children}
    </span>
  )
}

// ─── Copy button for code blocks ────────────────────────────────────────────

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch { /* clipboard unavailable */ }
      }}
      className="flex items-center gap-1 text-xs opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100 transition-opacity motion-interactive"
      style={{ color: copied ? "var(--theme-success)" : "var(--theme-text-muted)" }}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  )
}

// ─── Component map ──────────────────────────────────────────────────────────

function buildComponents(currentUserId: string, serverId: string | null, bigEmoji = false): Components {
  const emojiSize = bigEmoji ? 48 : 22
  const members = serverId ? useAppStore.getState().members[serverId] ?? [] : []
  return {
    // Links — external open with confirmation for untrusted domains
    a({ href, children }) {
      return <ExternalLink href={href ?? ""}>{children}</ExternalLink>
    },

    // Code blocks with syntax highlighting
    pre({ children }) {
      return <>{children}</>
    },

    code({ className, children }) {
      const langMatch = className?.match(/language-(\w+)/)
      const lang = langMatch?.[1] ?? ""
      const codeStr = String(children).replace(/\n$/, "")

      // Inline code (no language class)
      if (!className) {
        return (
          <code
            className="px-1 py-0.5 rounded text-sm font-mono"
            style={{ background: "rgba(0,0,0,0.3)" }}
          >
            {children}
          </code>
        )
      }

      // Fenced code block
      const language = lang && SUPPORTED_PRISM_LANGUAGES.has(lang) ? lang : "text"
      return (
        <div className="relative my-1 group/code rounded overflow-hidden" style={{ border: "1px solid var(--theme-surface-elevated)" }}>
          <div
            className="flex items-center justify-between px-3 py-1"
            style={{ background: "var(--theme-bg-secondary)", borderBottom: "1px solid var(--theme-surface-elevated)" }}
          >
            {lang ? (
              <span className="text-xs font-mono" style={{ color: "var(--theme-accent)" }}>{lang}</span>
            ) : (
              <span />
            )}
            <CopyButton code={codeStr} />
          </div>
          <Suspense
            fallback={
              <pre className="overflow-x-auto text-sm p-3 font-mono" style={{ background: "#011627", color: "#d6deeb", margin: 0 }}>
                {codeStr}
              </pre>
            }
          >
            <HighlightedCode code={codeStr} language={language} />
          </Suspense>
        </div>
      )
    },

    // Blockquotes
    blockquote({ children }) {
      return (
        <blockquote
          className="pl-3 my-1"
          style={{ borderLeft: "4px solid var(--theme-text-faint)", color: "var(--theme-text-secondary)" }}
        >
          {children}
        </blockquote>
      )
    },

    // Paragraphs — use div to keep inline flow and avoid nesting issues
    p({ children }) {
      return <div className="mb-0.5 last:mb-0">{children}</div>
    },

    // Tables (from remark-gfm)
    table({ children }) {
      return (
        <div className="overflow-x-auto my-1">
          <table className="text-sm border-collapse" style={{ borderColor: "var(--theme-surface-elevated)" }}>
            {children}
          </table>
        </div>
      )
    },
    th({ children }) {
      return <th className="border px-2 py-1 text-left font-semibold" style={{ borderColor: "var(--theme-surface-elevated)", background: "var(--theme-bg-secondary)" }}>{children}</th>
    },
    td({ children }) {
      return <td className="border px-2 py-1" style={{ borderColor: "var(--theme-surface-elevated)" }}>{children}</td>
    },

    // Custom elements from our remark plugins (passed through rehype-raw)
    "vortex-emoji": ({ node, ...props }: { node?: { properties?: Record<string, string> }; [key: string]: unknown }) => {
      const name = (props.dataName ?? props["data-name"] ?? node?.properties?.dataName ?? "") as string
      return <ServerEmojiImage name={name} size={emojiSize} />
    },

    "vortex-mention": ({ node, ...props }: { node?: { properties?: Record<string, string> }; [key: string]: unknown }) => {
      const uid = (props.dataUid ?? props["data-uid"] ?? node?.properties?.dataUid ?? "") as string
      const isSelfMention = uid === currentUserId
      const member = members.find((m) => m.user_id === uid)
      const displayLabel = member?.nickname ?? member?.display_name ?? member?.username ?? uid
      return (
        <span
          className="px-0.5 rounded cursor-pointer"
          style={{
            color: isSelfMention ? "var(--theme-mention-self-color)" : "var(--theme-accent)",
            background: isSelfMention ? "var(--theme-mention-self-bg)" : "rgba(88,101,242,0.1)",
            border: isSelfMention ? "1px solid var(--theme-mention-self-border)" : undefined,
          }}
          title={member ? `${member.username}${member.display_name ? ` (${member.display_name})` : ""}` : uid}
        >
          @{displayLabel}
        </span>
      )
    },

    "vortex-role-mention": ({ node, ...props }: { node?: { properties?: Record<string, string> }; [key: string]: unknown }) => {
      const rid = (props.dataRid ?? props["data-rid"] ?? node?.properties?.dataRid ?? "") as string
      const roles = serverId ? useAppStore.getState().serverRoles[serverId] ?? [] : []
      const role = roles.find((r) => r.id === rid)
      const customColor = role?.color && role.color !== "#000000" ? role.color : null
      const roleColor = customColor ?? "var(--theme-accent)"
      const roleBackground = customColor ? `${customColor}1a` : "rgba(88,101,242,0.1)"
      return (
        <span
          className="px-0.5 rounded cursor-pointer"
          style={{
            color: roleColor,
            background: roleBackground,
          }}
          title={role ? `Role: ${role.name}` : rid}
        >
          @{role?.name ?? rid}
        </span>
      )
    },

    "vortex-persona-mention": ({ node, ...props }: { node?: { properties?: Record<string, string> }; [key: string]: unknown }) => {
      const pid = (props.dataPid ?? props["data-pid"] ?? node?.properties?.dataPid ?? "") as string
      const personas = serverId ? useAppStore.getState().personas[serverId] ?? [] : []
      const persona = personas.find((p) => p.id === pid)
      return (
        <span
          className="inline-flex items-center gap-0.5 px-1 rounded cursor-pointer font-medium"
          style={{
            color: "var(--theme-ai-badge-text, #5865f2)",
            background: "var(--theme-ai-badge-bg, rgba(88,101,242,0.15))",
          }}
          title={persona ? `AI Persona: ${persona.name}` : pid}
        >
          @{persona?.name ?? pid}
          <span className="text-[9px] font-bold uppercase ml-0.5 opacity-70">BOT</span>
        </span>
      )
    },

    "vortex-timestamp": ({ node, ...props }: { node?: { properties?: Record<string, string> }; [key: string]: unknown }) => {
      const epoch = parseInt((props.dataEpoch ?? props["data-epoch"] ?? node?.properties?.dataEpoch ?? "0") as string, 10)
      const format = (props.dataFormat ?? props["data-format"] ?? node?.properties?.dataFormat ?? "f") as string
      return <TimestampDisplay epoch={epoch} format={format} />
    },

    "vortex-spoiler": ({ children }: { children?: ReactNode }) => {
      return <SpoilerSpan>{children}</SpoilerSpan>
    },

    // Images — only Twemoji SVGs pass through rehype-sanitize
    img({ src, alt }) {
      if (typeof src !== "string") return null
      // Strict pattern: only allow Twemoji SVG files from the expected CDN path
      if (!/^https:\/\/cdn\.jsdelivr\.net\/gh\/twitter\/twemoji@[^/]+\/assets\/svg\/[a-f0-9-]+\.svg$/.test(src)) return null
      return <img src={src} alt={typeof alt === "string" ? alt : ""} className="inline-block h-5 w-5 align-text-bottom" draggable={false} loading="lazy" />
    },
  } as Components
}

// ─── Pre-process content before Markdown parsing ────────────────────────────

function preProcessContent(content: string): string {
  // Strip [POLL]...[/POLL] blocks (handled separately by MessageItem)
  let processed = content.replace(/\[POLL\][\s\S]*?\[\/POLL\]/gi, "")
  
  // Collect valid mention/role mention/timestamp patterns into a token array
  // to preserve exact original text, then replace with index tokens
  const tokens: string[] = []
  
  processed = processed.replace(/<@(\w+)>/g, (match) => {
    tokens.push(match)
    return `__TOKEN_${tokens.length - 1}__`
  })
  processed = processed.replace(/<@&([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi, (match) => {
    tokens.push(match)
    return `__TOKEN_${tokens.length - 1}__`
  })
  processed = processed.replace(/<@bot:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi, (match) => {
    tokens.push(match)
    return `__TOKEN_${tokens.length - 1}__`
  })
  processed = processed.replace(/<t:(\d+)(?::([tTdDfFR]))?>/g, (match) => {
    tokens.push(match)
    return `__TOKEN_${tokens.length - 1}__`
  })
  
  // Escape remaining angle brackets to prevent them from being interpreted as HTML tags
  processed = processed.replace(/</g, "&lt;").replace(/>/g, "&gt;")
  
  // Restore the valid patterns from the token array
  processed = processed.replace(/__TOKEN_(\d+)__/g, (match, index) => tokens[parseInt(index)] ?? match)
  
  return processed
}

// ─── Stable plugin arrays ───────────────────────────────────────────────────

const remarkPlugins = [remarkGfm, remarkBreaks, remarkCustomEmoji, remarkMentions, remarkRoleMentions, remarkPersonaMentions, remarkSpoiler, remarkTimestamps, remarkUnicodeEmoji]
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    // Custom elements produced by our remark plugins
    "vortex-emoji",
    "vortex-mention",
    "vortex-role-mention",
    "vortex-persona-mention",
    "vortex-spoiler",
    "vortex-timestamp",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "vortex-emoji": ["dataName"],
    "vortex-mention": ["dataUid"],
    "vortex-role-mention": ["dataRid"],
    "vortex-persona-mention": ["dataPid"],
    "vortex-timestamp": ["dataEpoch", "dataFormat"],
    // Allow only src and alt on img — className/draggable/loading are hardcoded
    // in the component handler, not parsed from HTML attributes
    img: ["src", "alt"],
    code: ["className"],
  },
  // Only allow Twemoji CDN images — block all other img src values
  protocols: {
    ...defaultSchema.protocols,
    src: ["https"],
  },
}

const rehypePlugins: Parameters<typeof ReactMarkdown>[0]["rehypePlugins"] = [rehypeRaw, [rehypeSanitize, sanitizeSchema]]

// ─── Exported renderer ──────────────────────────────────────────────────────

interface MessageMarkdownProps {
  content: string
  currentUserId: string
  serverId?: string | null
}

/** AST-based Markdown renderer for chat messages.
 *
 *  Uses react-markdown (unified/remark/rehype) with custom remark plugins for
 *  mentions, custom emojis, spoilers, and timestamps. rehype-raw passes our
 *  custom HTML elements through to be rendered by React component overrides.
 *
 *  Supports nested formatting (e.g. **bold _and italic_**) which the
 *  previous single-regex approach could not handle. */
export const MessageMarkdown = memo(function MessageMarkdown({ content, currentUserId, serverId }: MessageMarkdownProps) {
  const processed = preProcessContent(content)
  const bigEmoji = isOnlyEmoji(processed)
  const components = buildComponents(currentUserId, serverId ?? null, bigEmoji)

  return (
    <div className={bigEmoji ? "big-emoji" : undefined}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
})
