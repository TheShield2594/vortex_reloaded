"use client"

import { memo, useCallback, useEffect, useId, useRef, useState, lazy, Suspense } from "react"
import { createPortal } from "react-dom"
import { format } from "date-fns"
import { Reply, Edit2, Trash2, Smile, Clipboard, Hash, MessageSquare, RefreshCcw, CheckSquare, Flag, Pin, PinOff, Share2, Paperclip, Clock, Loader2, AlertTriangle, Globe, Bot, BookOpen } from "lucide-react"
import { useLazyEmojiPicker } from "@/hooks/use-lazy-emoji-picker"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { OptimizedAvatarImage } from "@/components/ui/optimized-avatar-image"
import { UserProfilePopover } from "@/components/user-profile-popover"
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from "@/components/ui/context-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import type { MessageWithAuthor, AttachmentRow, ThreadRow } from "@/types/database"
import { cn } from "@/lib/utils/cn"
import { useAppStore } from "@/lib/stores/app-store"
import { useAppearanceStore } from "@/lib/stores/appearance-store"
import { useShallow } from "zustand/react/shallow"
import { LinkEmbed, extractFirstUrl, extractGiphyUrl, getEmbeddableGiphyUrl, stripUrlFromContent } from "@/components/chat/link-embed"
import { WorkspaceReferenceEmbed, extractWorkspaceReference } from "@/components/chat/workspace-reference-embed"
import { ServerEmojiImage, useServerEmojis, type ServerEmoji } from "@/components/chat/server-emoji-context"
import { CustomEmojiGrid } from "@/components/chat/custom-emoji-grid"
import { getReplyPreviewText } from "@/components/chat/reply-preview"
import { MessageMarkdown } from "@/components/chat/markdown-renderer"
const CreateThreadModal = lazy(() => import("@/components/modals/create-thread-modal").then((m) => ({ default: m.CreateThreadModal })))
const ReportModal = lazy(() => import("@/components/modals/report-modal").then((m) => ({ default: m.ReportModal })))
import { useParams } from "next/navigation"
import { MAX_POLL_OPTIONS } from "@/hooks/use-poll-creator"

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡"]
const POLL_NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣"].slice(0, MAX_POLL_OPTIONS)

interface Props {
  message: MessageWithAuthor
  containerId?: string
  highlighted?: boolean
  isGrouped: boolean
  currentUserId: string
  onReply: () => void
  onEdit: (content: string) => Promise<void>
  onDelete: () => Promise<void>
  onReaction: (emoji: string) => Promise<void>
  onReplyJump?: (messageId: string) => void
  onThreadCreated?: (thread: ThreadRow) => void
  onPinToggle?: (pinned: boolean) => void
  canManageMessages?: boolean
  sendState?: "queued" | "sending" | "failed"
  onRetry?: () => void
  recentlyActive?: boolean
  animateOnMount?: boolean
  onMountAnimationComplete?: () => void
}

function extractBibleEmbed(content: string | null): { color: string; reference: string; verseText: string; sanitizedContent: string | null } | null {
  if (!content) return null
  const match = content.match(/\[BIBLE_EMBED\]\n(.+)\n(.+)\n([\s\S]+?)\n\[\/BIBLE_EMBED\]/)
  if (!match) return null
  const rawColor = match[1]?.trim() || ""
  const color = /^#[0-9A-Fa-f]{6}$/.test(rawColor) ? rawColor : "#C4A747"
  const reference = match[2]?.trim() || ""
  const verseText = match[3]?.trim() || ""
  if (!reference || !verseText) return null
  const sanitized = content.replace(match[0], "").trim()
  return { color, reference, verseText, sanitizedContent: sanitized.length > 0 ? sanitized : null }
}

interface RssEmbedData {
  source: string
  title: string
  description: string
  link: string
  pubDate: string
  imageUrl: string
  sanitizedContent: string | null
}

function extractRssEmbed(content: string | null): RssEmbedData | null {
  if (!content) return null
  const match = content.match(/\[RSS_EMBED\]\n([\s\S]*?)\n\[\/RSS_EMBED\]/)
  if (!match) return null
  const lines = match[1].split("\n")
  if (lines.length < 6) return null
  const source = lines[0]?.trim() || ""
  const title = lines[1]?.trim() || ""
  const description = lines[2]?.trim() || ""
  const link = lines[3]?.trim() || ""
  const pubDate = lines[4]?.trim() || ""
  const imageUrl = lines[5]?.trim() || ""
  if (!title && !description) return null
  const sanitized = content.replace(match[0], "").trim()
  return { source, title, description, link, pubDate, imageUrl, sanitizedContent: sanitized.length > 0 ? sanitized : null }
}

function extractPoll(content: string | null): { question: string; options: string[]; sanitizedContent: string | null } | null {
  if (!content) return null
  const pollMatch = content.match(/\[POLL\]\s*([\s\S]*?)\s*\[\/POLL\]/i)
  if (!pollMatch) return null
  const pollBody = pollMatch[1] ?? ""
  const lines = pollBody.split("\n").map((line) => line.trim()).filter(Boolean)
  if (lines.length < 3) return null
  const question = lines[0]
  const options = lines.slice(1).map((line) => line.replace(/^-\s*/, "").trim()).filter(Boolean)
  if (!question || options.length < 2) return null
  const sanitized = content.replace(pollMatch[0], "").trim()
  return {
    question,
    options: options.slice(0, POLL_NUMBER_EMOJIS.length),
    sanitizedContent: sanitized.length > 0 ? sanitized : null,
  }
}


// Code block and syntax highlighting are now handled by MessageMarkdown
// (components/chat/markdown-renderer.tsx).

const EMOJI_RECENTS_KEY = "vortexchat:emoji-recents"
const EMOJI_RECENTS_MAX = 18

function getEmojiRecents(): string[] {
  if (typeof window === "undefined") return []
  try {
    return JSON.parse(localStorage.getItem(EMOJI_RECENTS_KEY) ?? "[]")
  } catch {
    return []
  }
}

function addEmojiRecent(emoji: string) {
  if (typeof window === "undefined") return
  try {
    const current = getEmojiRecents().filter((e) => e !== emoji)
    localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify([emoji, ...current].slice(0, EMOJI_RECENTS_MAX)))
  } catch {
    // localStorage unavailable — no-op
  }
}

function EmojiPickerPopup({ onSelect, onClose, maxHeight, serverEmojis, EmojiPicker }: { onSelect: (emoji: string) => void | Promise<void>; onClose: () => void; maxHeight?: string; serverEmojis?: ServerEmoji[]; EmojiPicker: NonNullable<ReturnType<typeof import("@/hooks/use-lazy-emoji-picker").useLazyEmojiPicker>["EmojiPicker"]> }) {
  const [recents, setRecents] = useState<string[]>([])
  const [searchActive, setSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const hasServerEmojiMatch =
    normalizedSearch.length > 0 &&
    (serverEmojis ?? []).some((e) => e.name.toLowerCase().includes(normalizedSearch))

  useEffect(() => {
    setRecents(getEmojiRecents())
  }, [])

  function handleSelect(emoji: string) {
    addEmojiRecent(emoji)
    setRecents(getEmojiRecents())
    onSelect(emoji)
    onClose()
  }

  return (
    <EmojiPicker.Root
      onEmojiSelect={({ emoji }) => handleSelect(emoji)}
      style={{ display: "flex", flexDirection: "column", width: "min(320px, 90vw)", height: maxHeight ?? "400px", maxHeight: maxHeight ?? "400px", overflow: "hidden" }}
    >
      <div style={{ padding: "8px 8px 4px" }}>
        <EmojiPicker.Search
          aria-label="Search emoji"
          style={{
            all: "unset",
            display: "block",
            width: "100%",
            padding: "6px 10px",
            borderRadius: "6px",
            fontSize: "13px",
            boxSizing: "border-box",
            background: "var(--theme-bg-tertiary)",
            color: "var(--theme-text-normal)",
          }}
          placeholder="Search emoji…"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearchActive(e.target.value.length > 0); setSearchQuery(e.target.value) }}
        />
      </div>

      {/* Recently used row — hidden while the search field has input */}
      {recents.length > 0 && !searchActive && (
        <div style={{ padding: "4px 8px 0" }}>
          <div
            style={{
              padding: "4px 0 2px",
              fontSize: "10px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--theme-text-muted)",
            }}
          >
            Recently used
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px" }}>
            {recents.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleSelect(emoji)}
                title={emoji}
                style={{
                  fontSize: "20px",
                  width: "34px",
                  height: "34px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "4px",
                  border: "none",
                  cursor: "pointer",
                  background: "transparent",
                  fontFamily: "var(--frimousse-emoji-font)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--theme-surface-elevated)" }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
              >
                {/^:.+:$/.test(emoji) ? (
                  <ServerEmojiImage name={emoji.slice(1, -1)} size={20} />
                ) : (
                  emoji
                )}
              </button>
            ))}
          </div>
          <div style={{ height: "1px", background: "var(--theme-bg-tertiary)", margin: "6px 0 2px" }} />
        </div>
      )}

      <EmojiPicker.Viewport style={{ flex: 1, overflow: "hidden auto" }}>
        {serverEmojis && serverEmojis.length > 0 && (
          <CustomEmojiGrid
            emojis={serverEmojis}
            search={searchQuery}
            onSelect={(emoji) => {
              handleSelect(`:${emoji.name}:`)
            }}
          />
        )}
        <EmojiPicker.Loading>
          <div style={{ padding: "16px", color: "var(--theme-text-muted)", fontSize: "13px" }}>Loading…</div>
        </EmojiPicker.Loading>
        {!hasServerEmojiMatch && (
        <EmojiPicker.Empty>
          {({ search }) => (
            <div style={{ padding: "16px", color: "var(--theme-text-muted)", fontSize: "13px" }}>
              No emoji found for &ldquo;{search}&rdquo;
            </div>
          )}
        </EmojiPicker.Empty>
        )}
        <EmojiPicker.List
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div
                {...props}
                style={{
                  padding: "4px 8px",
                  fontSize: "10px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--theme-text-muted)",
                  background: "var(--theme-bg-secondary)",
                  position: "sticky",
                  top: 0,
                }}
              >
                {category.label}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button
                type="button"
                {...props}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "18px",
                  width: "100%",
                  aspectRatio: "1",
                  borderRadius: "4px",
                  cursor: "pointer",
                  border: "none",
                  background: emoji.isActive ? "var(--theme-surface-elevated)" : "transparent",
                  fontFamily: "var(--frimousse-emoji-font)",
                }}
              >
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </EmojiPicker.Viewport>
      <div style={{ padding: "4px 8px 8px", display: "flex", justifyContent: "flex-end" }}>
        <EmojiPicker.SkinToneSelector
          style={{
            all: "unset",
            cursor: "pointer",
            fontSize: "16px",
            padding: "2px 4px",
            borderRadius: "4px",
            border: "1px solid var(--theme-bg-tertiary)",
            background: "var(--theme-bg-tertiary)",
          }}
          aria-label="Change skin tone"
        />
      </div>
    </EmojiPicker.Root>
  )
}

/** Memoized message bubble with author info, attachments, reactions, inline editing, thread creation, and context menu actions. */
export const MessageItem = memo(function MessageItem({
  message,
  containerId,
  highlighted = false,
  isGrouped,
  currentUserId,
  onReply,
  onEdit,
  onDelete,
  onReaction,
  onReplyJump,
  onThreadCreated,
  onPinToggle,
  canManageMessages = false,
  sendState,
  onRetry,
  recentlyActive = false,
  animateOnMount = false,
  onMountAnimationComplete,
}: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content ?? "")
  const [showActions, setShowActions] = useState(false)
  const [showEmojiPicker, setShowEmojiPickerRaw] = useState(false)
  const { EmojiPicker, loadEmojiPicker } = useLazyEmojiPicker()
  const setShowEmojiPicker = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === "function" ? v : () => v
    setShowEmojiPickerRaw((prev) => {
      const val = next(prev)
      if (val) loadEmojiPicker()
      return val
    })
  }, [loadEmojiPicker])
  const [showCreateThread, setShowCreateThread] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const [translatedText, setTranslatedText] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const { toast } = useToast()
  const timestampFormat = useAppearanceStore((s) => s.timestampFormat)
  const { emojis: serverEmojis } = useServerEmojis()
  const containerRef = useRef<HTMLDivElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ top: number; left: number } | null>(null)

  // Swipe-to-reply gesture state (mobile)
  const [swipeX, setSwipeX] = useState(0)
  const swipeStartRef = useRef<{ x: number; y: number; active: boolean } | null>(null)
  const SWIPE_REPLY_THRESHOLD = 60
  const reactionCountsRef = useRef<Record<string, number>>({})
  const [poppingReactions, setPoppingReactions] = useState<Record<string, number>>({})
  const popReactionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())


  useEffect(() => {
    if (!showActions && !showEmojiPicker) return

    function handleClickOutside(e: PointerEvent) {
      const target = e.target as Node
      // Ignore clicks inside the message container or the portaled emoji picker
      if (containerRef.current?.contains(target)) return
      if ((target as HTMLElement).closest?.("[data-emoji-picker-portal]")) return
      setShowActions(false)
      setShowEmojiPicker(false)
      setEmojiPickerPos(null)
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowActions(false)
        setShowEmojiPicker(false)
        setEmojiPickerPos(null)
      }
    }

    document.addEventListener("pointerdown", handleClickOutside)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [showActions, showEmojiPicker])
  const isOwn = message.author_id === currentUserId

  useEffect(() => {
    const nextCounts: Record<string, number> = {}
    for (const reaction of message.reactions) {
      nextCounts[reaction.emoji] = (nextCounts[reaction.emoji] ?? 0) + 1
    }

    const previous = reactionCountsRef.current
    const changed = Object.keys(nextCounts).filter((emoji) => previous[emoji] !== undefined && previous[emoji] !== nextCounts[emoji])
    if (changed.length > 0) {
      setPoppingReactions((prev) => {
        const next = { ...prev }
        for (const emoji of changed) {
          next[emoji] = (next[emoji] ?? 0) + 1

          const existingTimer = popReactionTimersRef.current.get(emoji)
          if (existingTimer) clearTimeout(existingTimer)
          const timer = setTimeout(() => {
            setPoppingReactions((current) => {
              if (!(emoji in current)) return current
              const updated = { ...current }
              delete updated[emoji]
              return updated
            })
            popReactionTimersRef.current.delete(emoji)
          }, 180)
          popReactionTimersRef.current.set(emoji, timer)
        }
        return next
      })
    }

    reactionCountsRef.current = nextCounts

    return () => {
      for (const timer of popReactionTimersRef.current.values()) {
        clearTimeout(timer)
      }
      popReactionTimersRef.current.clear()
    }
  }, [message.reactions])

  const { activeServerId, activeChannelId, membersByServer } = useAppStore(
    useShallow((s) => ({ activeServerId: s.activeServerId, activeChannelId: s.activeChannelId, membersByServer: s.members }))
  )
  const memberLookup = activeServerId ? membersByServer[activeServerId] ?? [] : []

  async function handleTranslate(): Promise<void> {
    if (translating || !activeServerId || !activeChannelId || !message.content) return
    if (translatedText) { setTranslatedText(null); return } // Toggle off
    setTranslating(true)
    try {
      const userLang = navigator.language?.split("-")[0] || "en"
      const res = await fetch(
        `/api/servers/${activeServerId}/channels/${activeChannelId}/messages/${message.id}/translate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetLanguage: userLang === "en" ? "English" : new Intl.DisplayNames(["en"], { type: "language" }).of(userLang) || "English" }),
        }
      )
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Translation failed") }
      const data = await res.json()
      setTranslatedText(data.translatedText ?? null)
    } catch {
      toast({ variant: "destructive", title: "Translation failed", description: "Could not translate this message" })
    } finally {
      setTranslating(false)
    }
  }

  async function confirmDelete() {
    try {
      await onDelete()
      setShowDeleteDialog(false)
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to delete message", description: error instanceof Error ? error.message : "Please try again." })
    }
  }

  // AI Persona detection — persona replies use webhook_display_name ending with " [AI]"
  const isPersonaMessage = !!message.webhook_display_name?.endsWith(" [AI]")
  const personaDisplayName = isPersonaMessage
    ? message.webhook_display_name!.replace(/ \[AI\]$/, "")
    : null

  const displayName = isPersonaMessage
    ? personaDisplayName ?? "Bot"
    : message.webhook_display_name
      ? message.webhook_display_name
      : message.author?.display_name || message.author?.username || "Unknown"
  const initials = displayName.slice(0, 2).toUpperCase()
  const timestamp = new Date(message.created_at)
  const messageMetaId = useId()
  const giphyUrl = message.content ? extractGiphyUrl(message.content) : null
  const embeddableGiphyUrl = giphyUrl ? getEmbeddableGiphyUrl(giphyUrl) : null
  const renderedContent = message.content && giphyUrl && embeddableGiphyUrl
    ? stripUrlFromContent(message.content, giphyUrl)
    : message.content
  const parsedPoll = extractPoll(renderedContent)
  const parsedBibleEmbed = extractBibleEmbed(renderedContent)
  const parsedRssEmbed = extractRssEmbed(renderedContent)
  let messageBodyContent: string | null = renderedContent
  if (parsedPoll) {
    messageBodyContent = parsedPoll.sanitizedContent
  }
  if (parsedBibleEmbed && messageBodyContent) {
    messageBodyContent = messageBodyContent.replace(/\[BIBLE_EMBED\][\s\S]*?\[\/BIBLE_EMBED\]/g, "").trim() || null
  }
  if (parsedRssEmbed && messageBodyContent) {
    messageBodyContent = messageBodyContent.replace(/\[RSS_EMBED\][\s\S]*?\[\/RSS_EMBED\]/g, "").trim() || null
  }

  const sendStateLabel = sendState === "queued" ? "Queued" : sendState === "sending" ? "Sending" : sendState === "failed" ? "Failed" : null
  const SendStateIcon = sendState === "queued" ? Clock : sendState === "sending" ? Loader2 : sendState === "failed" ? AlertTriangle : null


  // Group reactions by emoji
  const reactionGroups = message.reactions.reduce(
    (acc, r) => {
      if (!acc[r.emoji]) acc[r.emoji] = { count: 0, users: [], hasOwn: false }
      acc[r.emoji].count++
      acc[r.emoji].users.push(r.user_id)
      if (r.user_id === currentUserId) acc[r.emoji].hasOwn = true
      return acc
    },
    {} as Record<string, { count: number; users: string[]; hasOwn: boolean }>
  )
  const pollEmojiSet = parsedPoll ? new Set(parsedPoll.options.map((_, index) => POLL_NUMBER_EMOJIS[index])) : null
  const genericReactionEntries = Object.entries(reactionGroups).filter(([emoji]) => !pollEmojiSet?.has(emoji))

  async function handleEditSubmit() {
    if (editContent.trim() && editContent !== message.content) {
      try {
        await onEdit(editContent.trim())
      } catch (error: unknown) {
        toast({ variant: "destructive", title: "Failed to edit message", description: error instanceof Error ? error.message : "Please try again." })
        return
      }
    }
    setIsEditing(false)
  }

  // Message content rendering is now handled by <MessageMarkdown /> component
  // in components/chat/markdown-renderer.tsx (AST-based unified/remark pipeline).

  return (
    <>
    {/* Swipe-to-reply wrapper — shows reply icon behind the message during swipe */}
    <div
      className="relative"
      onTouchStart={(e) => {
        const touch = e.touches[0]
        swipeStartRef.current = { x: touch.clientX, y: touch.clientY, active: false }
      }}
      onTouchMove={(e) => {
        const start = swipeStartRef.current
        if (!start) return
        const dx = e.touches[0].clientX - start.x
        const dy = e.touches[0].clientY - start.y
        if (!start.active && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          start.active = true
        }
        if (!start.active) return
        const clamped = Math.max(0, Math.min(dx, SWIPE_REPLY_THRESHOLD * 1.5))
        setSwipeX(clamped)
      }}
      onTouchEnd={(e) => {
        const start = swipeStartRef.current
        if (start?.active && e.changedTouches.length > 0) {
          const dx = e.changedTouches[0].clientX - start.x
          if (dx >= SWIPE_REPLY_THRESHOLD) {
            navigator.vibrate?.(10)
            onReply()
          }
        }
        swipeStartRef.current = null
        setSwipeX(0)
      }}
      onTouchCancel={() => {
        swipeStartRef.current = null
        setSwipeX(0)
      }}
    >
      {swipeX > 0 && (
        <div
          className="absolute left-0 inset-y-0 flex items-center justify-center pointer-events-none"
          style={{ width: `${swipeX}px` }}
        >
          <Reply
            className="w-5 h-5"
            style={{
              color: swipeX >= SWIPE_REPLY_THRESHOLD ? "var(--theme-accent)" : "var(--theme-text-muted)",
              opacity: Math.min(swipeX / SWIPE_REPLY_THRESHOLD, 1),
              transform: `scale(${Math.min(swipeX / SWIPE_REPLY_THRESHOLD, 1)})`,
            }}
          />
        </div>
      )}
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          id={containerId}
          tabIndex={0}
          role="article"
          aria-label={`Message from ${message.author?.display_name ?? message.author?.username ?? "unknown"}`}
          className={cn(
            "relative group px-4 message-hover motion-interactive message-group-spacer focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-accent)]",
            highlighted && "mention-highlight",
            animateOnMount && "message-arrival",
            isGrouped ? "py-0.5" : "pt-2.5 pb-0.5",
            sendState === "sending" && "opacity-50"
          )}
          style={{
            transform: swipeX > 0 ? `translateX(${swipeX}px)` : undefined,
            transition: swipeStartRef.current?.active ? "none" : "transform 0.2s ease-out",
          }}
          onAnimationEnd={() => {
            if (animateOnMount) onMountAnimationComplete?.()
          }}
          onMouseEnter={() => {
            setShowActions(true)
          }}
          onMouseLeave={() => { setShowActions(false) }}
          onClick={(e) => {
            // On touch devices, tap a message to toggle the action bar.
            // Ignore clicks on interactive elements (buttons, links, inputs).
            const target = e.target as HTMLElement
            if (target.closest("button, a, input, textarea, select, video, audio, [role='menuitem'], [data-emoji-picker-portal]")) return
            if (window.matchMedia("(pointer: coarse)").matches) {
              setShowActions((v) => !v)
            }
          }}
          onFocus={() => setShowActions(true)}
          onBlur={(e) => {
            const relatedTarget = e.relatedTarget as HTMLElement | null
            const focusMovedIntoEmojiPortal = Boolean(relatedTarget?.closest?.("[data-emoji-picker-portal]"))
            if (!e.currentTarget.contains(relatedTarget) && !focusMovedIntoEmojiPortal) {
              setShowActions(false)
              setShowEmojiPicker(false)
              setEmojiPickerPos(null)
            }
          }}
        >
          {/* Reply reference */}
          {message.reply_to_id && (
            onReplyJump ? (
              <button
                type="button"
                onClick={() => onReplyJump(message.reply_to_id!)}
                className="w-[calc(100%-2.5rem)] min-w-0 text-left flex items-center gap-2 mb-1 ml-10 text-xs tertiary-metadata rounded px-1 py-0.5 surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-accent)]"
                aria-label={message.reply_to ? "Jump to replied message" : "Jump to original message"}
              >
                <Reply className="w-3 h-3 -scale-x-100" />
                <span className="font-medium shrink-0" style={{ color: 'var(--theme-text-secondary)' }}>
                  {message.reply_to?.author?.display_name || message.reply_to?.author?.username || "Original message"}
                </span>
                <span className="truncate min-w-0">{getReplyPreviewText(message.reply_to?.content ?? null)}</span>
              </button>
            ) : (
              <div
                className="w-[calc(100%-2.5rem)] min-w-0 text-left flex items-center gap-2 mb-1 ml-10 text-xs tertiary-metadata rounded px-1 py-0.5"
              >
                <Reply className="w-3 h-3 -scale-x-100" />
                <span className="font-medium shrink-0" style={{ color: 'var(--theme-text-secondary)' }}>
                  {message.reply_to?.author?.display_name || message.reply_to?.author?.username || "Original message"}
                </span>
                <span className="truncate min-w-0">{getReplyPreviewText(message.reply_to?.content ?? null)}</span>
              </div>
            )
          )}

          <div className={cn("flex gap-3 message-row", isOwn && "message-own")}>
            {/* Avatar or timestamp gutter */}
            <div className="w-10 flex-shrink-0 message-cozy-avatar">
              {!isGrouped ? (
                <UserProfilePopover
                  user={message.author}
                  userId={message.author?.id}
                  currentUserId={currentUserId}
                  displayName={displayName}
                  status={message.author?.status}
                  side="right"
                  align="start"
                >
                  <div className="cursor-pointer">
                    <Avatar className={cn("w-10 h-10", recentlyActive && "recent-activity-halo")}>
                      {(message.webhook_id && message.webhook_avatar_url ? message.webhook_avatar_url : message.author?.avatar_url) && (
                        <OptimizedAvatarImage src={(message.webhook_id && message.webhook_avatar_url) ? message.webhook_avatar_url : message.author?.avatar_url ?? ""} size={40} />
                      )}
                      <AvatarFallback
                        style={{ background: "var(--theme-accent)", color: "white", fontSize: "14px" }}
                      >
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </UserProfilePopover>
              ) : (
                <div className="pt-1 pr-1 flex items-center justify-end gap-1">
                  <span
                    id={messageMetaId}
                    className="text-xs opacity-0 group-hover:opacity-100 touch-visible motion-interactive block text-right tertiary-metadata"
                    style={{ fontSize: "10px" }}
                  >
                    {format(timestamp, timestampFormat === "24h" ? "HH:mm" : "h:mm a")}
                  </span>
                  {sendStateLabel && SendStateIcon && (
                    <span className={cn("message-state-morph text-[10px] inline-flex items-center gap-0.5", sendState && `is-${sendState}`)}>
                      <SendStateIcon className={cn("w-3 h-3", sendState === "sending" && "animate-spin")} />
                      {sendStateLabel}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 message-bubble">
              {!isGrouped && (
                <div className="flex items-baseline gap-2 mb-0.5 message-header">
                  <span className="message-compact-timestamp text-xs tertiary-metadata hidden" style={{ fontSize: "10px" }}>
                    {format(timestamp, timestampFormat === "24h" ? "HH:mm" : "h:mm a")}
                  </span>
                  <UserProfilePopover
                    user={message.author}
                    userId={message.author?.id}
                    currentUserId={currentUserId}
                    displayName={displayName}
                    status={message.author?.status}
                    side="right"
                    align="start"
                  >
                    <span className="font-semibold hover:underline cursor-pointer" style={{ color: "var(--theme-text-bright)" }}>
                      {displayName}
                    </span>
                  </UserProfilePopover>
                  {(message.webhook_id || message.webhook_display_name) && (
                    <span
                      className="inline-flex items-center px-1 py-px rounded text-[10px] font-bold uppercase leading-none"
                      style={{ background: "var(--theme-accent)", color: "var(--theme-bg-primary)" }}
                      aria-label="Bot message"
                    >
                      APP
                    </span>
                  )}
                  {isPersonaMessage && (
                    <span
                      className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-bold uppercase leading-none"
                      style={{ background: "var(--theme-ai-badge-bg)", color: "var(--theme-ai-badge-text)" }}
                      aria-label="AI persona"
                    >
                      <Bot className="w-2.5 h-2.5" /> BOT
                    </span>
                  )}
                  <span id={messageMetaId} className="text-xs tertiary-metadata message-cozy-timestamp">
                    {format(timestamp, timestampFormat === "24h" ? "MM/dd/yyyy HH:mm" : "MM/dd/yyyy h:mm a")}
                  </span>
                  {sendStateLabel && SendStateIcon && (
                    <span className={cn("message-state-morph inline-flex items-center gap-1", sendState && `is-${sendState}`)}>
                      <SendStateIcon className={cn("w-3 h-3", sendState === "sending" && "animate-spin")} />
                      {sendStateLabel}
                    </span>
                  )}
                  {message.edited_at && (
                    <span className="text-xs tertiary-metadata">
                      (edited)
                    </span>
                  )}
                  {message.pinned && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "var(--theme-danger)" }}>
                      <Pin className="w-3 h-3" /> Pinned
                    </span>
                  )}
                </div>
              )}

              {isGrouped && (
                <span className="message-compact-timestamp text-xs tertiary-metadata hidden" style={{ fontSize: "10px" }}>
                  {format(timestamp, timestampFormat === "24h" ? "HH:mm" : "h:mm a")}
                </span>
              )}

              {isGrouped && message.pinned && (
                <div className="flex items-center gap-1 text-xs font-medium mb-0.5" style={{ color: "var(--theme-danger)" }}>
                  <Pin className="w-3 h-3" /> Pinned
                </div>
              )}

              {isEditing ? (
                <div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleEditSubmit()
                      }
                      if (e.key === "Escape") {
                        setIsEditing(false)
                        setEditContent(message.content ?? "")
                      }
                    }}
                    className="w-full rounded px-3 py-2 text-sm resize-none focus:outline-none"
                    style={{
                      background: "var(--theme-bg-tertiary)",
                      color: "var(--theme-text-primary)",
                      border: "1px solid var(--theme-accent)",
                    }}
                    rows={3}
                    autoFocus
                  />
                  <div className="flex gap-2 mt-1 text-xs tertiary-metadata">
                    {/* Desktop: keyboard hints. Mobile: tappable buttons. */}
                    <span className="hidden md:inline">ESC to cancel</span>
                    <button
                      type="button"
                      onClick={() => { setIsEditing(false); setEditContent(message.content ?? "") }}
                      className="md:hidden focus-ring rounded px-2 py-1"
                      style={{ color: "var(--theme-text-secondary)", background: "var(--theme-bg-tertiary)", borderRadius: "6px" }}
                    >
                      Cancel
                    </button>
                    <span className="hidden md:inline">·</span>
                    <button
                      type="button"
                      onClick={handleEditSubmit}
                      className="focus-ring rounded px-2 py-1 md:px-0 md:py-0 md:bg-transparent"
                      style={{ color: "var(--theme-link)", borderRadius: "6px" }}
                    >
                      <span className="hidden md:inline">Enter to save</span>
                      <span className="md:hidden">Save</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {parsedPoll && (
                    <div className="mt-1 rounded-lg p-3 space-y-2" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--theme-text-muted)" }}>Poll</p>
                      <p className="text-sm font-semibold" style={{ color: "var(--theme-text-primary)" }}>{parsedPoll.question}</p>
                      <div className="space-y-1.5">
                        {parsedPoll.options.map((option, index) => {
                          const emoji = POLL_NUMBER_EMOJIS[index]
                          const votes = reactionGroups[emoji]?.count ?? 0
                          return (
                            <button
                              type="button"
                              key={`poll-option-${message.id}-${index}`}
                              onClick={() => onReaction(emoji)}
                              className="w-full flex items-center justify-between rounded px-2 py-1.5 text-sm surface-hover"
                              style={{ border: "1px solid var(--theme-bg-tertiary)", color: "var(--theme-text-normal)" }}
                            >
                              <span className="truncate text-left">{emoji} {option}</span>
                              <span className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{votes}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {parsedBibleEmbed && (
                    <div
                      className="mt-1 rounded overflow-hidden max-w-md"
                      style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
                    >
                      <div className="flex">
                        <div className="w-1 flex-shrink-0 rounded-l" style={{ background: parsedBibleEmbed.color }} />
                        <div className="px-3 py-2.5 space-y-1.5 min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1" style={{ color: parsedBibleEmbed.color }}>
                            <BookOpen className="w-3 h-3" />
                            Daily Verse
                          </p>
                          <blockquote
                            className="text-sm leading-relaxed italic pl-2"
                            style={{ color: "var(--theme-text-normal)", borderLeft: `2px solid ${parsedBibleEmbed.color}30` }}
                          >
                            {parsedBibleEmbed.verseText}
                          </blockquote>
                          <p className="text-xs font-semibold" style={{ color: "var(--theme-text-secondary)" }}>
                            — {parsedBibleEmbed.reference}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {parsedRssEmbed && (
                    <div
                      className="mt-1 rounded overflow-hidden max-w-lg"
                      style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
                    >
                      <div className="flex">
                        <div className="w-1 flex-shrink-0 rounded-l" style={{ background: "#f97316" }} />
                        <div className="px-3 py-2.5 space-y-2 min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "#f97316" }}>
                            <Globe className="w-3 h-3" />
                            {parsedRssEmbed.source}
                          </p>
                          {parsedRssEmbed.title && (
                            parsedRssEmbed.link && /^https?:\/\//i.test(parsedRssEmbed.link) ? (
                              <a
                                href={parsedRssEmbed.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-semibold leading-snug hover:underline block"
                                style={{ color: "var(--theme-accent, #5865f2)" }}
                              >
                                {parsedRssEmbed.title}
                              </a>
                            ) : (
                              <p className="text-sm font-semibold leading-snug" style={{ color: "var(--theme-text-bright)" }}>
                                {parsedRssEmbed.title}
                              </p>
                            )
                          )}
                          {parsedRssEmbed.description && (
                            <p className="text-xs leading-relaxed" style={{ color: "var(--theme-text-normal)" }}>
                              {parsedRssEmbed.description}
                            </p>
                          )}
                          {parsedRssEmbed.imageUrl && /^https?:\/\//i.test(parsedRssEmbed.imageUrl) && (
                            <img
                              src={parsedRssEmbed.imageUrl}
                              alt={parsedRssEmbed.title || "RSS feed image"}
                              className="rounded mt-1 max-h-48 w-auto object-cover"
                              style={{ maxWidth: "100%" }}
                              loading="lazy"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                            />
                          )}
                          {parsedRssEmbed.pubDate && (
                            <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                              {parsedRssEmbed.pubDate}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {messageBodyContent && (
                    <div
                      className="text-sm leading-relaxed message-content break-words"
                      style={{ color: "var(--theme-text-normal)" }}
                    >
                      <MessageMarkdown content={messageBodyContent} currentUserId={currentUserId} serverId={activeServerId} />
                    </div>
                  )}

                  {/* Inline translation block */}
                  {translatedText && (
                    <div
                      className="mt-1.5 rounded-md px-3 py-2 text-sm leading-relaxed"
                      style={{ background: "var(--theme-ai-surface)", border: "1px solid var(--theme-ai-border)" }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Globe className="w-3 h-3" style={{ color: "var(--theme-ai-badge-text)" }} />
                        <span className="text-xs font-medium" style={{ color: "var(--theme-ai-badge-text)" }}>Translated</span>
                      </div>
                      <div style={{ color: "var(--theme-text-normal)" }}>{translatedText}</div>
                    </div>
                  )}

                  {embeddableGiphyUrl && (
                    <img
                      src={embeddableGiphyUrl}
                      alt="GIF"
                      className="mt-2 max-w-sm w-full rounded-md border"
                      style={{ borderColor: "var(--theme-bg-tertiary)", background: "var(--theme-bg-tertiary)" }}
                    />
                  )}

                  {/* Link embed — shown for messages with a URL and no image attachments */}
                  {message.content && (!message.attachments?.length) && !embeddableGiphyUrl && (() => {
                    const url = extractFirstUrl(message.content)
                    return url ? <LinkEmbed url={url} /> : null
                  })()}

                  {message.content && (() => {
                    const reference = extractWorkspaceReference(message.content)
                    return reference ? <WorkspaceReferenceEmbed type={reference.type} id={reference.id} /> : null
                  })()}

                  {/* Attachments */}
                  {message.attachments?.length > 0 && (
                    <div className="mt-2 space-y-2">
                      <AttachmentGallery attachments={message.attachments} canManageMessages={canManageMessages} />
                    </div>
                  )}

                  {/* Reactions */}
                  {genericReactionEntries.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {genericReactionEntries.map(([emoji, { count, hasOwn, users }]) => (
                        <button
                          key={`${emoji}-${poppingReactions[emoji] ?? 0}`}
                          onClick={async () => { navigator.vibrate?.(6); try { await onReaction(emoji) } catch { /* handled upstream */ } }}
                          title={users
                            .map((id) => {
                              if (id === currentUserId) return "You"
                              const member = memberLookup.find((m) => m.user_id === id)
                              return member?.nickname || member?.display_name || member?.username || "Unknown user"
                            })
                            .join(", ")}
                          className={cn("motion-interactive motion-press flex items-center gap-1 px-2.5 py-1.5 rounded-full text-sm hover:-translate-y-px min-h-[44px]", poppingReactions[emoji] && "reaction-chip-pop")}
                          aria-label={`Toggle ${emoji} reaction`}
                          style={{
                            background: hasOwn
                              ? "rgba(88,101,242,0.3)"
                              : "rgba(255,255,255,0.06)",
                            border: `1px solid ${hasOwn ? "var(--theme-accent)" : "transparent"}`,
                            color: "var(--theme-text-normal)",
                          }}
                        >
                          {/^:.+:$/.test(emoji) ? (
                            <ServerEmojiImage name={emoji.slice(1, -1)} size={20} />
                          ) : (
                            <span>{emoji}</span>
                          )} {count}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Emoji picker — portaled to body so it escapes scroll overflow clipping */}
          {/* Desktop: positioned emoji picker */}
          {showEmojiPicker && EmojiPicker && emojiPickerPos && createPortal(
            <div
              data-emoji-picker-portal
              onClick={(e) => { if (e.target === e.currentTarget) { setShowEmojiPicker(false); setEmojiPickerPos(null) } }}
              className="hidden md:block fixed z-[9999]"
              style={{ top: emojiPickerPos.top, left: emojiPickerPos.left }}
            >
              <div
                className="rounded-lg shadow-xl overflow-hidden"
                style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
              >
                <EmojiPickerPopup
                  onSelect={async (emoji) => { try { await onReaction(emoji) } catch { /* handled upstream */ } }}
                  onClose={() => { setShowEmojiPicker(false); setEmojiPickerPos(null) }}
                  serverEmojis={serverEmojis}
                  EmojiPicker={EmojiPicker}
                />
              </div>
            </div>,
            document.body,
          )}
          {/* Mobile: emoji picker as a bottom sheet (only when desktop positioned picker is not active) */}
          {showEmojiPicker && EmojiPicker && !emojiPickerPos && createPortal(
            <div
              data-emoji-picker-portal
              className="md:hidden fixed inset-0 z-[9999] flex flex-col justify-end"
              onClick={(e) => { if (e.target === e.currentTarget) { setShowEmojiPicker(false); setEmojiPickerPos(null) } }}
            >
              <div className="absolute inset-0 bg-black/50" aria-hidden />
              <div
                className="relative rounded-t-2xl shadow-xl overflow-hidden animate-in slide-in-from-bottom duration-200"
                style={{
                  background: "var(--theme-bg-secondary)",
                  borderTop: "1px solid var(--theme-bg-tertiary)",
                  maxHeight: "70vh",
                  paddingBottom: "env(safe-area-inset-bottom)",
                }}
              >
                {/* Drag handle */}
                <div className="flex justify-center py-2" aria-hidden>
                  <div className="w-10 h-1 rounded-full" style={{ background: "var(--theme-bg-tertiary)" }} />
                </div>
                {/* Quick reactions row */}
                <div className="flex justify-center gap-2 px-4 pb-2">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={async () => { try { await onReaction(emoji) } catch { /* handled upstream */ } setShowEmojiPicker(false); setEmojiPickerPos(null) }}
                      className="w-11 h-11 flex items-center justify-center rounded-full text-xl active:scale-90 transition-transform"
                      style={{ background: "var(--theme-bg-tertiary)" }}
                      aria-label={`React with ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <EmojiPickerPopup
                  onSelect={async (emoji) => { try { await onReaction(emoji) } catch { /* handled upstream */ } }}
                  onClose={() => { setShowEmojiPicker(false); setEmojiPickerPos(null) }}
                  maxHeight="calc(70vh - 100px)"
                  serverEmojis={serverEmojis}
                  EmojiPicker={EmojiPicker}
                />
              </div>
            </div>,
            document.body,
          )}

          {/* Action buttons */}
          {!isEditing && (
            <div
              aria-hidden={!showActions}
              inert={!showActions}
              className={cn(
                "action-rail-motion absolute right-4 -top-4 flex items-center rounded shadow-lg overflow-hidden",
                showActions
                  ? "opacity-100 translate-y-0"
                  : "pointer-events-none opacity-0 -translate-y-1"
              )}
              style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
            >
              <button
                ref={emojiButtonRef}
                onClick={() => {
                  if (showEmojiPicker) {
                    setShowEmojiPicker(false)
                    setEmojiPickerPos(null)
                  } else if (window.matchMedia("(pointer: coarse)").matches) {
                    // Mobile: open bottom sheet directly (no position needed)
                    setEmojiPickerPos(null)
                    setShowEmojiPicker(true)
                    navigator.vibrate?.(10)
                  } else if (emojiButtonRef.current) {
                    const rect = emojiButtonRef.current.getBoundingClientRect()
                    const pickerW = 320
                    const pickerH = 400 // matches EmojiPickerPopup height
                    const gap = 4
                    // Position: right-aligned with the button, prefer above; flip below if clipped
                    let top = rect.top - pickerH - gap
                    if (top < 8) top = rect.bottom + gap
                    // Also clamp bottom so picker stays on screen
                    if (top + pickerH > window.innerHeight - 8) {
                      top = window.innerHeight - pickerH - 8
                    }
                    let left = rect.right - pickerW
                    if (left < 8) left = 8
                    if (left + pickerW > window.innerWidth - 8) {
                      left = window.innerWidth - pickerW - 8
                    }
                    setEmojiPickerPos({ top, left })
                    setShowEmojiPicker(true)
                  }
                }}
                className="motion-interactive motion-press w-8 h-8 flex items-center justify-center surface-hover-md focus-ring"
                style={{ color: showEmojiPicker ? "var(--theme-accent)" : "var(--theme-text-secondary)" }}
                title="Add Reaction"
                aria-label="Add reaction"
                aria-describedby={messageMetaId}
                tabIndex={showActions ? 0 : -1}
              >
                <Smile className="w-4 h-4" />
              </button>

              <button
                onClick={onReply}
                className="motion-interactive motion-press w-8 h-8 flex items-center justify-center surface-hover-md focus-ring"
                style={{ color: "var(--theme-text-secondary)" }}
                title="Reply"
                aria-label="Reply to message"
                aria-describedby={messageMetaId}
                tabIndex={showActions ? 0 : -1}
              >
                <Reply className="w-4 h-4" />
              </button>

              {messageBodyContent && activeServerId && activeChannelId && (
                <button
                  onClick={handleTranslate}
                  className="motion-interactive motion-press w-8 h-8 flex items-center justify-center surface-hover-md focus-ring"
                  style={{ color: translatedText ? "var(--theme-accent)" : "var(--theme-text-secondary)" }}
                  title={translatedText ? "Hide translation" : "Translate"}
                  aria-label={translatedText ? "Hide translation" : "Translate message"}
                  aria-describedby={messageMetaId}
                  tabIndex={showActions ? 0 : -1}
                >
                  {translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                </button>
              )}

              {onThreadCreated && (
                <button
                  onClick={() => setShowCreateThread(true)}
                  className="motion-interactive motion-press w-8 h-8 flex items-center justify-center surface-hover-md focus-ring"
                  style={{ color: "var(--theme-text-secondary)" }}
                  title="Create Thread"
                  aria-label="Create thread from message"
                  aria-describedby={messageMetaId}
                  tabIndex={showActions ? 0 : -1}
                >
                  <MessageSquare className="w-4 h-4" />
                </button>
              )}

              {isOwn && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="motion-interactive motion-press w-8 h-8 flex items-center justify-center surface-hover-md focus-ring"
                  style={{ color: "var(--theme-text-secondary)" }}
                  title="Edit"
                  aria-label="Edit message"
                  aria-describedby={messageMetaId}
                  tabIndex={showActions ? 0 : -1}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              )}

              {sendState === "failed" && onRetry && (
                <button
                  onClick={onRetry}
                  className="motion-interactive motion-press w-8 h-8 flex items-center justify-center surface-hover-md focus-ring"
                  style={{ color: "var(--theme-warning)" }}
                  title="Retry send"
                  aria-label="Retry sending message"
                  aria-describedby={messageMetaId}
                  tabIndex={showActions ? 0 : -1}
                >
                  <RefreshCcw className="w-4 h-4" />
                </button>
              )}

              {canManageMessages && onPinToggle && (
                <button
                  onClick={async () => {
                    const pinned = !message.pinned
                    onPinToggle(pinned)
                    const res = await fetch(`/api/messages/${message.id}/pin`, { method: pinned ? "PUT" : "DELETE" })
                    if (!res.ok) {
                      onPinToggle(!pinned)
                      const data = await res.json().catch(() => ({}))
                      toast({ variant: "destructive", title: pinned ? "Failed to pin message" : "Failed to unpin message", description: data.error })
                    }
                  }}
                  className="motion-interactive motion-press w-8 h-8 flex items-center justify-center surface-hover-md focus-ring"
                  style={{ color: message.pinned ? "var(--theme-accent)" : "var(--theme-text-secondary)" }}
                  title={message.pinned ? "Unpin Message" : "Pin Message"}
                  aria-label={message.pinned ? "Unpin message" : "Pin message"}
                  aria-describedby={messageMetaId}
                  tabIndex={showActions ? 0 : -1}
                >
                  {message.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                </button>
              )}

              {(isOwn || canManageMessages) && (
                <button
                  onClick={() => setShowDeleteDialog(true)}
                  className="motion-interactive motion-press w-8 h-8 flex items-center justify-center hover:bg-red-500/20 focus-ring"
                  style={{ color: "var(--theme-danger)" }}
                  title="Delete"
                  aria-label="Delete message"
                  aria-describedby={messageMetaId}
                  tabIndex={showActions ? 0 : -1}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52" aria-label={`Message actions for ${displayName}`}>
        <ContextMenuItem onClick={onReply}>
          <Reply className="w-4 h-4 mr-2" /> Reply
          <ContextMenuShortcut>R</ContextMenuShortcut>
        </ContextMenuItem>
        {onThreadCreated && (
          <ContextMenuItem onClick={() => setShowCreateThread(true)}>
            <MessageSquare className="w-4 h-4 mr-2" /> Create Thread
            <ContextMenuShortcut>T</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        {isOwn && (
          <ContextMenuItem onClick={() => setIsEditing(true)}>
            <Edit2 className="w-4 h-4 mr-2" /> Edit Message
            <ContextMenuShortcut>E</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={async () => {
          const res = await fetch(`/api/messages/${message.id}/task`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
          if (res.ok) {
            const data = await res.json()
            toast({ title: "Task created", description: `Reference: ${data.reference}` })
          } else {
            toast({ variant: "destructive", title: "Unable to convert message to task" })
          }
        }}>
          <CheckSquare className="w-4 h-4 mr-2" /> Convert to Task
        </ContextMenuItem>
        {message.content && (
          <ContextMenuItem onClick={async () => {
            try {
              await navigator.clipboard.writeText(message.content!)
              toast({ title: "Text copied!" })
            } catch { /* clipboard unavailable */ }
          }}>
            <Clipboard className="w-4 h-4 mr-2" /> Copy Text
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={async () => {
          try {
            await navigator.clipboard.writeText(message.id)
            toast({ title: "Message ID copied!" })
          } catch { /* clipboard unavailable */ }
        }}>
          <Hash className="w-4 h-4 mr-2" /> Copy Message ID
        </ContextMenuItem>
        {typeof navigator !== "undefined" && "share" in navigator && message.content && (
          <ContextMenuItem onClick={async () => {
            try {
              await navigator.share({ text: message.content! })
            } catch {
              // User cancelled or share failed — ignore
            }
          }}>
            <Share2 className="w-4 h-4 mr-2" /> Share
          </ContextMenuItem>
        )}
        {canManageMessages && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={async () => {
              const pinned = !message.pinned
              onPinToggle?.(pinned)
              const res = await fetch(`/api/messages/${message.id}/pin`, { method: pinned ? "PUT" : "DELETE" })
              if (!res.ok) {
                onPinToggle?.(!pinned)
                const data = await res.json().catch(() => ({}))
                toast({ variant: "destructive", title: pinned ? "Failed to pin message" : "Failed to unpin message", description: data.error })
              }
            }}>
              {message.pinned
                ? <><PinOff className="w-4 h-4 mr-2" /> Unpin Message</>
                : <><Pin className="w-4 h-4 mr-2" /> Pin Message</>
              }
              <ContextMenuShortcut>P</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
        {!isOwn && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => setShowReportModal(true)}>
              <Flag className="w-4 h-4 mr-2" /> Report Message
              <ContextMenuShortcut>⇧R</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
        {(isOwn || canManageMessages) && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => setShowDeleteDialog(true)}>
              <Trash2 className="w-4 h-4 mr-2" /> Delete Message
              <ContextMenuShortcut>Del</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
    </div>{/* end swipe-to-reply wrapper */}

    {!isOwn && showReportModal && (
      <Suspense fallback={null}>
        <ReportModal
          open={showReportModal}
          onClose={() => setShowReportModal(false)}
          reportedUserId={message.author_id}
          reportedUsername={displayName}
          reportedMessageId={message.id}
          serverId={activeServerId ?? undefined}
        />
      </Suspense>
    )}

    {onThreadCreated && showCreateThread && (
      <Suspense fallback={null}>
        <CreateThreadModal
          open={showCreateThread}
          onClose={() => setShowCreateThread(false)}
          messageId={message.id}
          onCreated={(thread) => {
            setShowCreateThread(false)
            onThreadCreated(thread)
          }}
        />
      </Suspense>
    )}

    <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
      <DialogContent style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}>
        <DialogHeader>
          <DialogTitle>Delete message?</DialogTitle>
          <DialogDescription style={{ color: "var(--theme-text-secondary)" }}>
            This action is irreversible. This message will be permanently removed for everyone in this channel.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setShowDeleteDialog(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDelete}>
            Delete message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
})

function AttachmentGallery({ attachments, canManageMessages }: { attachments: AttachmentRow[]; canManageMessages: boolean }) {
  const params = useParams<{ serverId?: string }>()
  const serverId = params?.serverId
  const imageIndexes = attachments
    .map((attachment, index) => ({ attachment, index }))
    .filter((entry) => entry.attachment.content_type?.startsWith("image/"))
    .map((entry) => entry.index)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [panOrigin, setPanOrigin] = useState({ x: 50, y: 50 })
  const imageContainerRef = useRef<HTMLDivElement>(null)

  const openImage = (index: number) => { setLightboxIndex(index); setZoom(1); setPanOrigin({ x: 50, y: 50 }) }
  const closeImage = () => { setLightboxIndex(null); setZoom(1) }

  const currentImageListIndex = lightboxIndex === null ? -1 : imageIndexes.indexOf(lightboxIndex)
  const currentAttachment = lightboxIndex === null ? null : attachments[lightboxIndex]

  const move = useCallback((direction: 1 | -1) => {
    if (currentImageListIndex < 0) return
    const nextIndex = (currentImageListIndex + direction + imageIndexes.length) % imageIndexes.length
    setLightboxIndex(imageIndexes[nextIndex])
    setZoom(1)
    setPanOrigin({ x: 50, y: 50 })
  }, [currentImageListIndex, imageIndexes])

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
    if (zoom === 1) {
      if ("clientX" in e && typeof e.clientX === "number") {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * 100
        const y = ((e.clientY - rect.top) / rect.height) * 100
        setPanOrigin({ x, y })
      } else {
        setPanOrigin({ x: 50, y: 50 })
      }
      setZoom(2)
    } else {
      setZoom(1)
      setPanOrigin({ x: 50, y: 50 })
    }
  }, [zoom])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (zoom <= 1) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setPanOrigin({ x, y })
  }, [zoom])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    setZoom((prev) => {
      const next = prev + (e.deltaY < 0 ? 0.5 : -0.5)
      return Math.max(1, Math.min(5, next))
    })
  }, [])

  return (
    <>
      {attachments.map((attachment, index) => (
        <AttachmentDisplay key={attachment.id} attachment={attachment} onOpenImage={() => openImage(index)} canManageMessages={canManageMessages} serverId={serverId} />
      ))}

      <Dialog open={lightboxIndex !== null} onOpenChange={(open) => { if (!open) closeImage() }}>
        <DialogContent
          className="max-w-5xl border"
          style={{ background: "var(--theme-bg-tertiary)", borderColor: "var(--theme-bg-secondary)", color: "var(--theme-text-primary)" }}
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault()
              move(1)
            } else if (event.key === "ArrowLeft") {
              event.preventDefault()
              move(-1)
            } else if (event.key === "+" || event.key === "=") {
              event.preventDefault()
              setZoom((prev) => Math.min(5, prev + 0.5))
            } else if (event.key === "-") {
              event.preventDefault()
              setZoom((prev) => Math.max(1, prev - 0.5))
            } else if (event.key === "0") {
              event.preventDefault()
              setZoom(1)
              setPanOrigin({ x: 50, y: 50 })
            }
          }}
        >
          <DialogTitle className="sr-only">Image viewer</DialogTitle>
          {currentAttachment && (
            <div className="space-y-3">
              <div
                ref={imageContainerRef}
                className="overflow-hidden rounded"
                role="button"
                tabIndex={0}
                aria-label={zoom > 1 ? "Zoom out" : "Zoom in"}
                style={{ cursor: zoom > 1 ? "zoom-out" : "zoom-in" }}
                onClick={handleImageClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    handleImageClick(e as unknown as React.MouseEvent<HTMLDivElement>)
                  }
                }}
                onMouseMove={handleMouseMove}
                onWheel={handleWheel}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentAttachment.id.startsWith("local-") ? currentAttachment.url : `/api/attachments/${currentAttachment.id}/download`}
                  alt={currentAttachment.filename}
                  className="object-contain"
                  draggable={false}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "75vh",
                    transform: `scale(${zoom})`,
                    transformOrigin: `${panOrigin.x}% ${panOrigin.y}%`,
                    transition: zoom === 1 ? "transform 0.2s ease-out" : "none",
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--theme-text-secondary)" }}>
                <span>{currentAttachment.filename}</span>
                <div className="flex items-center gap-2">
                  {zoom > 1 && (
                    <span className="px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.1)" }}>
                      {Math.round(zoom * 100)}%
                    </span>
                  )}
                  {imageIndexes.length > 1 && (
                    <span>
                      <button type="button" className="px-2 py-1 rounded surface-hover-md" onClick={() => move(-1)} aria-label="Previous image">← Prev</button>
                      <button type="button" className="px-2 py-1 rounded surface-hover-md ml-2" onClick={() => move(1)} aria-label="Next image">Next →</button>
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}


function AttachmentDisplay({ attachment, onOpenImage, canManageMessages, serverId }: { attachment: AttachmentRow; onOpenImage?: () => void; canManageMessages: boolean; serverId?: string }) {
  const isImage = attachment.content_type?.startsWith("image/")
  const isVideo = attachment.content_type?.startsWith("video/")
  const isAudio = attachment.content_type?.startsWith("audio/")
  // Optimistic attachments have local-* IDs and no server-side record yet;
  // use their direct signed URL instead of the download API endpoint.
  const isOptimistic = attachment.id.startsWith("local-")
  const downloadUrl = isOptimistic ? attachment.url : `/api/attachments/${attachment.id}/download`

  if (isImage) {
    // Use optimized variant URL when available, fall back to original
    const variants = (attachment as Record<string, unknown>).variants as Record<string, { path: string; width: number; height: number }> | null | undefined
    const blurHash = (attachment as Record<string, unknown>).blur_hash as string | null | undefined
    const hasStandard = !!variants?.standard?.path
    const imgSrc = isOptimistic
      ? downloadUrl
      : hasStandard
        ? `/api/attachments/${attachment.id}/download?variant=standard`
        : downloadUrl

    // Compute aspect ratio for layout stability (prevents CLS)
    const imgWidth = attachment.width ?? variants?.standard?.width ?? variants?.thumbnail?.width
    const imgHeight = attachment.height ?? variants?.standard?.height ?? variants?.thumbnail?.height
    const aspectStyle = imgWidth && imgHeight
      ? { aspectRatio: `${imgWidth} / ${imgHeight}` }
      : {}

    return (
      <div className="max-w-sm" data-img-wrapper>
        <button type="button" className="block relative overflow-hidden rounded" onClick={onOpenImage}>
          {/* Blur placeholder — shown while the full image loads */}
          {blurHash && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={blurHash}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover rounded"
              style={{ filter: "blur(8px)", transform: "scale(1.1)" }}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc}
            alt={attachment.filename}
            loading="lazy"
            className="rounded object-contain relative"
            style={{ maxWidth: "100%", maxHeight: "20rem", background: blurHash ? "transparent" : "var(--theme-bg-tertiary)", ...aspectStyle }}
            onLoad={(e) => {
              // Hide blur placeholder once full image loads
              const blur = (e.target as HTMLElement).previousElementSibling
              if (blur && blur.getAttribute("aria-hidden")) {
                (blur as HTMLElement).style.display = "none"
              }
            }}
            onError={(e) => {
              const el = e.target as HTMLImageElement
              el.style.display = "none"
              // Also hide blur placeholder on error
              const blur = el.previousElementSibling
              if (blur && blur.getAttribute("aria-hidden")) {
                (blur as HTMLElement).style.display = "none"
              }
              const fallback = el.closest("[data-img-wrapper]")?.querySelector("[data-fallback]")
              if (fallback) (fallback as HTMLElement).style.display = "flex"
            }}
          />
        </button>
        <div
          data-fallback
          className="hidden items-center gap-2 px-3 py-2 rounded border text-sm"
          style={{ borderColor: "var(--theme-bg-tertiary)", background: "var(--theme-bg-secondary)", color: "var(--theme-text-secondary)" }}
        >
          <Paperclip className="w-4 h-4 flex-shrink-0" />
          <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">
            {attachment.filename}
          </a>
          <span className="text-xs flex-shrink-0" style={{ color: "var(--theme-text-muted)" }}>
            {(attachment.size / 1024).toFixed(1)} KB
          </span>
        </div>
      </div>
    )
  }

  if (isVideo) {
    return (
      <div className="max-w-lg rounded overflow-hidden" style={{ background: "var(--theme-bg-tertiary)" }}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- no caption tracks available for user-uploaded video */}
        <video
          src={downloadUrl}
          controls
          preload="metadata"
          className="rounded max-h-80 w-full"
          aria-label={attachment.filename}
        />
        <div className="flex items-center gap-2 px-3 py-1.5">
          <span className="text-xs truncate" style={{ color: "var(--theme-text-muted)" }}>{attachment.filename}</span>
          <span className="text-xs flex-shrink-0" style={{ color: "var(--theme-text-muted)" }}>{(attachment.size / 1024).toFixed(1)} KB</span>
        </div>
      </div>
    )
  }

  if (isAudio) {
    return (
      <div className="max-w-sm rounded p-3 space-y-2" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: "var(--theme-accent)" }}>
            <span className="text-[10px] font-bold" style={{ color: "var(--theme-text-bright)" }}>
              {attachment.filename.split(".").pop()?.toUpperCase().slice(0, 4)}
            </span>
          </div>
          <span className="text-sm font-medium truncate" style={{ color: "var(--theme-text-bright)" }}>{attachment.filename}</span>
          <span className="text-xs flex-shrink-0" style={{ color: "var(--theme-text-muted)" }}>{(attachment.size / 1024).toFixed(1)} KB</span>
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- no caption tracks available for user-uploaded audio */}
        <audio src={downloadUrl} controls preload="metadata" className="w-full h-8" aria-label={attachment.filename} />
      </div>
    )
  }

  return (
    <a
      href={downloadUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="motion-interactive flex items-center gap-3 p-3 rounded max-w-sm surface-hover"
      style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
    >
      <div
        className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0"
        style={{ background: "var(--theme-accent)" }}
      >
        <span className="text-xs font-bold" style={{ color: "var(--theme-text-bright)" }}>
          {attachment.filename.split(".").pop()?.toUpperCase().slice(0, 4)}
        </span>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium truncate" style={{ color: "var(--theme-text-bright)" }}>
          {attachment.filename}
        </div>
        <div className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          {(attachment.size / 1024).toFixed(1)} KB
        </div>
      </div>
    </a>
  )
}

