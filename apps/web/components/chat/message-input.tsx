"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { Send, X, Smile, Reply, FileUp, BarChart3, Plus, MessageSquare, Paperclip } from "lucide-react"
import type { MessageWithAuthor } from "@/types/database"
import { cn } from "@/lib/utils/cn"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import { useMentionAutocomplete } from "@/hooks/use-mention-autocomplete"
import { useEmojiAutocomplete } from "@/hooks/use-emoji-autocomplete"
import { useSlashCommandAutocomplete, type SlashCommand } from "@/hooks/use-slash-command-autocomplete"
import { BUILT_IN_SLASH_COMMANDS, getAvailableBuiltInCommands, getTextInsertionForBuiltIn, type BuiltInSlashCommand } from "@/lib/built-in-slash-commands"
import { MentionSuggestions } from "@/components/chat/mention-suggestions"
import { EmojiSuggestions } from "@/components/chat/emoji-suggestions"
import { SlashCommandSuggestions } from "@/components/chat/slash-command-suggestions"
import { resolveComposerKeybinding } from "@/lib/composer-keybindings"
import { useServerEmojis } from "@/components/chat/server-emoji-context"
import { CustomEmojiGrid } from "@/components/chat/custom-emoji-grid"
import { useLazyEmojiPicker } from "@/hooks/use-lazy-emoji-picker"
import { MAX_ATTACHMENT_BYTES, validateFileClient } from "@/lib/attachment-validation"
import { toast } from "@/components/ui/use-toast"
import { useGifMemeSticker } from "@/hooks/use-gif-meme-sticker"
import { usePollCreator } from "@/hooks/use-poll-creator"
import { useSlashModeration } from "@/hooks/use-slash-moderation"
import { useMobileLayout } from "@/hooks/use-mobile-layout"
import { SmartReplyTray } from "@/components/chat/smart-reply-tray"

/** Module-level cache for slash commands to avoid refetching on every server revisit. */
const SLASH_COMMAND_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const slashCommandCache = new Map<string, {
  commands: SlashCommand[]
  permissions: number
  isOwner: boolean
  fetchedAt: number
}>()

/** Reply context — accepts channel MessageWithAuthor or DM Message. */
export interface ReplyToContext {
  id: string
  content: string | null
}

interface Props {
  /** "channel" shows +menu (upload/poll/thread), "dm" shows paperclip directly. */
  variant?: "channel" | "dm"
  channelName: string
  draft: string
  replyTo: ReplyToContext | null
  onCancelReply: () => void
  onSend: (content: string, files?: File[], onUploadProgress?: (percent: number) => void, abortSignal?: AbortSignal) => Promise<void>
  onDraftChange: (value: string) => void
  onTyping?: () => void
  onSent?: () => void
  onCreateThread?: () => void
  /** When provided, slash command autocomplete is enabled for apps installed on this server. */
  serverId?: string
}

/** Composable message input with file attachments, emoji picker, @mention autocomplete, and reply-to indicator. */
export function MessageInput({ variant = "channel", channelName, draft, replyTo, onCancelReply, onSend, onDraftChange, onTyping, onSent, onCreateThread, serverId }: Props) {
  const isMobile = useMobileLayout()
  const [content, setContent] = useState(draft)
  const [cursorPosition, setCursorPosition] = useState(0)
  const composingRef = useRef(false)
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [sendError, setSendErrorRaw] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState<string | null>(null)

  /** Show error inline AND as a toast so mobile users don't miss it. */
  const setSendError = useCallback((msg: string | null): void => {
    setSendErrorRaw(msg)
    if (msg) {
      toast({ variant: "destructive", title: "Send failed", description: msg })
    }
  }, [])
  const [inputFocused, setInputFocused] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounterRef = useRef(0)
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
  const [emojiSearch, setEmojiSearch] = useState("")
  const emojiGridRef = useRef<HTMLDivElement>(null)
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const [pickerTab, setPickerTab] = useState<"emoji" | "gif" | "sticker">("emoji")
  const uploadAbortRef = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const pollCreatorRef = useRef<HTMLDivElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const plusButtonRef = useRef<HTMLButtonElement>(null)
  const fileUrlCache = useRef(new Map<File, string>())
  const draftTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  // --- Extracted hooks ---
  const media = useGifMemeSticker({ pickerOpen: showEmojiPicker, activeTab: pickerTab })
  const poll = usePollCreator({
    content,
    onContentChange: (next) => { setContent(next); onDraftChange(next) },
    onCursorChange: setCursorPosition,
    textareaRef,
  })


  // Lock body scroll on mobile when the picker bottom sheet is open
  useEffect(() => {
    if (!showEmojiPicker) return
    const mql = window.matchMedia("(min-width: 768px)")
    // Only lock on mobile (the picker is a fixed bottom sheet below md breakpoint)
    if (mql.matches) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    // If the device rotates to desktop width, unlock scroll
    const onChange = (e: MediaQueryListEvent): void => {
      if (e.matches) document.body.style.overflow = prev
      else document.body.style.overflow = "hidden"
    }
    mql.addEventListener("change", onChange)
    return () => {
      document.body.style.overflow = prev
      mql.removeEventListener("change", onChange)
    }
  }, [showEmojiPicker])

  // Debounced draft sync — keeps typing snappy, persists after 150ms idle
  const debouncedDraftChange = useCallback((value: string) => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(() => onDraftChange(value), 150)
  }, [onDraftChange])

  useEffect(() => {
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current) }
  }, [])

  // Mention autocomplete
  const { activeServerId, activeChannelId, members: membersByServer, serverRoles: rolesByServer, personas: personasByServer } = useAppStore(
    useShallow((s) => ({ activeServerId: s.activeServerId, activeChannelId: s.activeChannelId, members: s.members, serverRoles: s.serverRoles, personas: s.personas }))
  )
  const members = activeServerId ? membersByServer[activeServerId] ?? [] : []
  const roles = serverId ? rolesByServer[serverId] ?? [] : []
  const personas = serverId ? personasByServer[serverId] ?? [] : []
  const mention = useMentionAutocomplete({ content, cursorPosition, members, roles, personas })

  // Slash command state (needed by moderation hook below)
  const [appCommands, setAppCommands] = useState<SlashCommand[]>([])
  const [userPermissions, setUserPermissions] = useState(0)
  const [isServerOwner, setIsServerOwner] = useState(false)

  // Slash moderation commands (kick, ban, unban, timeout, mute)
  const clearInputForModeration = useCallback((): string => {
    const saved = content
    setContent("")
    onDraftChange("")
    if (textareaRef.current) textareaRef.current.style.height = "28px"
    return saved
  }, [content, onDraftChange])
  const restoreInputForModeration = useCallback((saved: string): void => {
    setContent(saved)
    onDraftChange(saved)
  }, [onDraftChange])
  const moderation = useSlashModeration({
    serverId,
    members,
    userPermissions,
    isServerOwner,
    setSending,
    setSendError,
    clearInput: clearInputForModeration,
    restoreInput: restoreInputForModeration,
    textareaRef,
  })

  // Emoji autocomplete (`:shortcode` trigger)
  const { emojis: serverEmojis } = useServerEmojis()
  const emoji = useEmojiAutocomplete({ content, cursorPosition, serverEmojis })

  // Slash command autocomplete (`/command` prefix trigger)
  // Cache responses per server to avoid refetching on every channel switch.
  useEffect(() => {
    // Reset immediately so stale commands from a previous server aren't shown
    setAppCommands([])
    setUserPermissions(0)
    setIsServerOwner(false)

    if (!serverId) return

    // Check in-memory cache first (5-minute TTL)
    const cached = slashCommandCache.get(serverId)
    if (cached && Date.now() - cached.fetchedAt < SLASH_COMMAND_CACHE_TTL) {
      setAppCommands(cached.commands)
      setUserPermissions(cached.permissions)
      setIsServerOwner(cached.isOwner)
      return
    }

    const controller = new AbortController()
    fetch(`/api/servers/${serverId}/apps/commands`, { signal: controller.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return
        // New format: { commands, permissions, isOwner }
        let commands: SlashCommand[] = []
        let permissions = 0
        let isOwner = false
        if (data.commands) {
          commands = Array.isArray(data.commands) ? data.commands : []
          permissions = data.permissions ?? 0
          isOwner = data.isOwner ?? false
        } else if (Array.isArray(data)) {
          // Backwards compat with old format
          commands = data
        }
        setAppCommands(commands)
        setUserPermissions(permissions)
        setIsServerOwner(isOwner)
        slashCommandCache.set(serverId!, { commands, permissions, isOwner, fetchedAt: Date.now() })
      })
      .catch(() => {/* non-fatal — includes AbortError */})
    return () => controller.abort()
  }, [serverId])
  // Merge permission-filtered built-in commands with app commands
  const slashCommands = useMemo(() => {
    const builtIns = getAvailableBuiltInCommands(userPermissions, isServerOwner, !!onCreateThread)
    return [...builtIns, ...appCommands]
  }, [appCommands, userPermissions, isServerOwner, onCreateThread])
  const slash = useSlashCommandAutocomplete({ content, cursorPosition, commands: slashCommands })

  function getPreviewUrl(file: File): string {
    let url = fileUrlCache.current.get(file)
    if (!url) {
      url = URL.createObjectURL(file)
      fileUrlCache.current.set(file, url)
    }
    return url
  }

  useEffect(() => {
    return () => {
      for (const url of fileUrlCache.current.values()) URL.revokeObjectURL(url)
    }
  }, [])

  useEffect(() => {
    if (!replyTo) return
    textareaRef.current?.focus()
  }, [replyTo?.id])

  // Only sync from external draft changes (e.g. channel switch), not our own edits
  useEffect(() => {
    if (draft === content) return
    setContent(draft)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = "28px"
      el.style.height = Math.min(el.scrollHeight, 200) + "px"
    })
  }, [draft])

  useEffect(() => {
    if (!showEmojiPicker) {
      setEmojiSearch("")
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      const clickedInsidePicker = emojiPickerRef.current?.contains(target)
      const clickedToggleButton = emojiButtonRef.current?.contains(target)
      if (!clickedInsidePicker && !clickedToggleButton) {
        setShowEmojiPicker(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [showEmojiPicker])

  useEffect(() => {
    if (!poll.showPollCreator) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      const clickedInsidePollCreator = pollCreatorRef.current?.contains(target)
      if (!clickedInsidePollCreator) {
        poll.setShowPollCreator(false)
        poll.resetPollDraftToBlank()
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [poll.showPollCreator, poll.setShowPollCreator, poll.resetPollDraftToBlank])

  useEffect(() => {
    if (!showPlusMenu) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      const clickedInsideMenu = plusMenuRef.current?.contains(target)
      const clickedButton = plusButtonRef.current?.contains(target)
      if (!clickedInsideMenu && !clickedButton) {
        setShowPlusMenu(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [showPlusMenu])

  async function handleSend() {
    if ((!content.trim() && files.length === 0) || sending) return

    // Detect slash command invocation: `/commandName [args]`
    if (content.startsWith("/")) {
      const [commandToken, ...argParts] = content.trim().split(/\s+/)
      const commandName = commandToken.slice(1).toLowerCase()
      const args = argParts.join(" ")

      // Check built-in commands first
      const matchedBuiltIn = BUILT_IN_SLASH_COMMANDS.find((cmd) => cmd.commandName.toLowerCase() === commandName)
      if (matchedBuiltIn) {
        // Text-insertion commands (shrug, tableflip, etc.) — send as regular message
        const textInsert = getTextInsertionForBuiltIn(commandName, args)
        if (textInsert !== null) {
          if (!textInsert.trim() && files.length === 0) return // e.g. /spoiler with no args
          setContent(textInsert)
          // Fall through to normal send below with replaced content
          const savedContent = textInsert
          setSending(true)
          setSendError(null)
          setContent("")
          onDraftChange("")
          if (textareaRef.current) textareaRef.current.style.height = "28px"
          onSent?.()
          try {
            await onSend(savedContent, files.length > 0 ? files : undefined)
            setFiles([])
            for (const url of fileUrlCache.current.values()) URL.revokeObjectURL(url)
            fileUrlCache.current.clear()
          } catch (error: unknown) {
            setContent(savedContent)
            onDraftChange(savedContent)
            setSendError(error instanceof Error ? error.message : "Message send failed. Try again.")
          } finally {
            setSending(false)
            textareaRef.current?.focus()
          }
          return
        }

        // UI-trigger commands — open the relevant picker/creator
        if (commandName === "giphy" || commandName === "gif") {
          setContent("")
          onDraftChange("")
          if (textareaRef.current) textareaRef.current.style.height = "28px"
          setPickerTab("gif")
          media.setGifQuery(args)
          setShowEmojiPicker(true)
          return
        }

        if (commandName === "sticker") {
          setContent("")
          onDraftChange("")
          if (textareaRef.current) textareaRef.current.style.height = "28px"
          setPickerTab("sticker")
          media.setStickerQuery(args)
          setShowEmojiPicker(true)
          return
        }
        if (commandName === "poll") {
          setContent("")
          onDraftChange("")
          if (textareaRef.current) textareaRef.current.style.height = "28px"
          poll.openPollCreator(args || undefined)
          return
        }
        if (commandName === "thread") {
          setContent("")
          onDraftChange("")
          if (textareaRef.current) textareaRef.current.style.height = "28px"
          onCreateThread?.()
          return
        }
        if (commandName === "nick") {
          if (!serverId || !args.trim()) {
            setSendError("/nick requires a nickname. Usage: /nick YourNewNick")
            return
          }
          setSending(true)
          setSendError(null)
          setSendSuccess(null)
          const savedContent = content
          setContent("")
          onDraftChange("")
          if (textareaRef.current) textareaRef.current.style.height = "28px"
          try {
            const res = await fetch(`/api/servers/${serverId}/members/me/nickname`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ nickname: args.trim() }),
            })
            if (!res.ok) {
              const payload = await res.json().catch(() => ({}))
              throw new Error(payload?.error ?? `Failed to update nickname (${res.status})`)
            }
            setSendError(null)
            setSendSuccess(`Nickname updated to "${args.trim()}"`)
            setTimeout(() => setSendSuccess(null), 3000)
          } catch (error: unknown) {
            setContent(savedContent)
            onDraftChange(savedContent)
            setSendError(error instanceof Error ? error.message : "Failed to update nickname.")
          } finally {
            setSending(false)
            textareaRef.current?.focus()
          }
          return
        }

        // --- Moderation commands (extracted to useSlashModeration hook) ---
        const handled = await moderation.handleModeration(commandName, args)
        if (handled) return

        // matchedBuiltIn is true but no handler matched — unknown built-in, don't send as message
        setSendError(`Unknown command "/${commandName}". Type / to see available commands.`)
        return
      }

      // App-installed commands (require serverId)
      if (serverId) {
        const matchedCommand = appCommands.find((cmd) => cmd.commandName.toLowerCase() === commandName)
        if (matchedCommand) {
          setSending(true)
          setSendError(null)
          const savedContent = content
          setContent("")
          onDraftChange("")
          if (textareaRef.current) textareaRef.current.style.height = "28px"
          onSent?.()
          try {
            const res = await fetch(`/api/servers/${serverId}/apps/commands/execute`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ commandId: matchedCommand.id, appId: matchedCommand.appId, args }),
            })
            if (!res.ok) {
              const payload = await res.json().catch(() => ({}))
              throw new Error(payload?.error ?? `Command failed (${res.status})`)
            }
          } catch (error: unknown) {
            setContent(savedContent)
            onDraftChange(savedContent)
            setSendError(error instanceof Error ? error.message : "Command failed. Try again.")
          } finally {
            setSending(false)
            textareaRef.current?.focus()
          }
          return
        }
      }
    }

    setSending(true)
    setSendError(null)
    setUploadProgress(files.length > 0 ? 0 : null)
    const abortController = new AbortController()
    uploadAbortRef.current = abortController
    onSent?.()

    // Cancel any pending debounced draft sync before clearing
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)

    // Clear input immediately for a snappy feel — restore on failure
    const savedContent = content
    const savedFiles = [...files]
    setContent("")
    onDraftChange("")
    setFiles([])
    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = "28px"

    try {
      await onSend(savedContent, savedFiles, (percent) => setUploadProgress(percent), abortController.signal)
      for (const url of fileUrlCache.current.values()) URL.revokeObjectURL(url)
      fileUrlCache.current.clear()
    } catch (error: unknown) {
      const isAbort = (error instanceof DOMException && error.name === "AbortError") || abortController.signal.aborted
      if (isAbort) {
        // Restore draft and attachments so the user can retry or edit
        setContent(savedContent)
        onDraftChange(savedContent)
        setFiles(savedFiles)
        setSendError(null)
      } else {
        // Restore content so the user can retry
        setContent(savedContent)
        onDraftChange(savedContent)
        setFiles(savedFiles)
        setSendError(error instanceof Error ? error.message : "Message send failed. Try again.")
      }
    } finally {
      setSending(false)
      setUploadProgress(null)
      uploadAbortRef.current = null
      textareaRef.current?.focus()
    }
  }

  function handleCancelUpload() {
    uploadAbortRef.current?.abort()
    uploadAbortRef.current = null
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // During IME composition (mobile predictive text, CJK input, etc.),
    // let the browser handle all keys — intervening here would break input.
    if (composingRef.current || e.nativeEvent.isComposing) return

    const mentionHandledNavigation = mention.handleKeyDown(e)
    const emojiHandledNavigation = emoji.handleKeyDown(e)
    const slashHandledNavigation = slash.handleKeyDown(e)
    const selectedMention = mention.filteredSuggestions[mention.selectedIndex]
    const selectedEmoji = emoji.matches[emoji.selectedIndex]
    const selectedSlash = slash.matches[slash.selectedIndex]
    const action = resolveComposerKeybinding(e.key, e.shiftKey, {
      isMentionOpen: mention.isOpen,
      hasMentionSelection: Boolean(selectedMention),
      isEmojiOpen: emoji.isOpen,
      hasEmojiSelection: Boolean(selectedEmoji),
      isSlashOpen: slash.isOpen,
      hasSlashSelection: Boolean(selectedSlash),
      hasDraftContent: content.length > 0,
      mentionHandledNavigation,
      emojiHandledNavigation,
      slashHandledNavigation,
      isMobile,
    })

    if (action.preventDefault) {
      e.preventDefault()
    }

    if (action.acceptMention && selectedMention) {
      insertMention(selectedMention)
      return
    }

    if (action.closeMention) {
      mention.close()
      return
    }

    if (action.acceptEmoji && selectedEmoji) {
      insertEmoji(selectedEmoji)
      return
    }

    if (action.closeEmoji) {
      emoji.close()
      return
    }

    if (action.acceptSlash && selectedSlash) {
      insertSlashCommand(selectedSlash)
      return
    }

    if (action.closeSlash) {
      slash.close()
      return
    }

    if (action.clearDraft) {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      setContent("")
      onDraftChange("")
      setCursorPosition(0)
      return
    }

    if (action.sendMessage) {
      handleSend()
    }
  }

  function insertMention(suggestion: Parameters<typeof mention.selectSuggestion>[0]) {
    const { newContent, newCursorPosition } = mention.selectSuggestion(suggestion)
    setContent(newContent)
    onDraftChange(newContent)
    setCursorPosition(newCursorPosition)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newCursorPosition
        textareaRef.current.selectionEnd = newCursorPosition
      }
    })
  }

  function insertSlashCommand(command: Parameters<typeof slash.selectCommand>[0]) {
    const { newContent, newCursorPosition } = slash.selectCommand(command)
    setContent(newContent)
    onDraftChange(newContent)
    setCursorPosition(newCursorPosition)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newCursorPosition
        textareaRef.current.selectionEnd = newCursorPosition
      }
    })
  }

  function insertEmoji(match: Parameters<typeof emoji.selectEmoji>[0]) {
    const { newContent, newCursorPosition } = emoji.selectEmoji(match)
    setContent(newContent)
    onDraftChange(newContent)
    setCursorPosition(newCursorPosition)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newCursorPosition
        textareaRef.current.selectionEnd = newCursorPosition
      }
    })
  }

  function validateAndFilterFiles(incoming: File[]): File[] {
    const MAX_FILE_COUNT = 10
    const currentCount = files.length
    const accepted: File[] = []
    const errors: string[] = []

    if (currentCount >= MAX_FILE_COUNT) {
      setSendError(`You can attach up to ${MAX_FILE_COUNT} files per message`)
      return []
    }

    const remaining = MAX_FILE_COUNT - currentCount
    for (const file of incoming) {
      if (accepted.length >= remaining) {
        errors.push(`Only ${MAX_FILE_COUNT} files allowed per message — ${incoming.length - accepted.length} skipped`)
        break
      }
      const error = validateFileClient(file)
      if (error) {
        errors.push(error)
      } else {
        accepted.push(file)
      }
    }
    if (errors.length > 0) {
      setSendError(errors.join("; "))
    } else {
      setSendError(null)
    }
    return accepted
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = validateAndFilterFiles(Array.from(e.target.files ?? []))
    if (selected.length > 0) setFiles((prev) => [...prev, ...selected])
    e.target.value = ""
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDraggingOver(false)
    if (e.dataTransfer.files.length === 0) return
    const dropped = validateAndFilterFiles(Array.from(e.dataTransfer.files))
    if (dropped.length > 0) setFiles((prev) => [...prev, ...dropped])
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter((item) => item.type.startsWith("image/"))
    if (imageItems.length > 0) {
      const imageFiles = validateAndFilterFiles(
        imageItems.map((item) => item.getAsFile()).filter(Boolean) as File[]
      )
      if (imageFiles.length > 0) setFiles((prev) => [...prev, ...imageFiles])
    }
  }

  // Auto-resize textarea
  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value)
    debouncedDraftChange(e.target.value)
    // During IME composition (common on mobile keyboards), selectionStart is
    // unreliable — defer the read until the browser finalises the cursor.
    if (composingRef.current) {
      const ta = e.target
      requestAnimationFrame(() => {
        if (ta) setCursorPosition(ta.selectionStart)
      })
    } else {
      setCursorPosition(e.target.selectionStart)
    }
    const el = e.target
    el.style.height = "28px"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
    if (e.target.value) onTyping?.()
  }

  function handleCompositionStart(): void {
    composingRef.current = true
  }

  function handleCompositionEnd(e: React.CompositionEvent<HTMLTextAreaElement>): void {
    composingRef.current = false
    // After composition finishes, sync the real cursor position so mention
    // detection picks up the newly committed text (e.g. "@" typed via IME).
    setCursorPosition(e.currentTarget.selectionStart)
  }

  function handleSelect(e: React.SyntheticEvent<HTMLTextAreaElement>): void {
    if (!composingRef.current) {
      setCursorPosition(e.currentTarget.selectionStart)
    }
  }

  function handleEmojiGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]
    if (!arrows.includes(e.key)) return
    const gridEl = emojiGridRef.current
    if (!gridEl) return
    const buttons = Array.from(gridEl.querySelectorAll<HTMLButtonElement>("[data-emoji-btn]"))
    if (buttons.length === 0) return
    const activeEl = document.activeElement as HTMLButtonElement
    let currentIdx = buttons.indexOf(activeEl)
    if (currentIdx === -1) {
      e.preventDefault()
      buttons[0].focus()
      return
    }
    e.preventDefault()
    // Derive column count from the nearest grid ancestor, falling back to bounding-rect measurement
    let gridContainer: Element | null = buttons[0].parentElement
    while (gridContainer) {
      const display = getComputedStyle(gridContainer).display
      if (display === "grid" || display === "inline-grid") break
      gridContainer = gridContainer.parentElement
    }
    const colsParsed = gridContainer ? getComputedStyle(gridContainer).gridTemplateColumns.split(/\s+/).filter(Boolean).length : 0
    let cols = colsParsed > 0 ? colsParsed : 9
    if (cols === 9 && buttons.length >= 2) {
      const r0 = buttons[0].getBoundingClientRect()
      let c = 1
      for (let i = 1; i < buttons.length; i++) {
        if (buttons[i].getBoundingClientRect().top > r0.bottom) break
        c++
      }
      if (c > 0) cols = c
    }
    let nextIdx = currentIdx
    if (e.key === "ArrowRight") nextIdx = Math.min(buttons.length - 1, currentIdx + 1)
    else if (e.key === "ArrowLeft") nextIdx = Math.max(0, currentIdx - 1)
    else if (e.key === "ArrowDown") nextIdx = Math.min(buttons.length - 1, currentIdx + cols)
    else if (e.key === "ArrowUp") nextIdx = Math.max(0, currentIdx - cols)
    if (nextIdx !== currentIdx) {
      buttons[nextIdx].focus()
      buttons[nextIdx].scrollIntoView({ block: "nearest" })
    }
  }

  function handleGifGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]
    if (!arrows.includes(e.key)) return
    e.preventDefault()
    const grid = e.currentTarget
    const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>("button"))
    if (buttons.length === 0) return
    const activeEl = document.activeElement as HTMLButtonElement
    const currentIdx = buttons.indexOf(activeEl)
    if (currentIdx === -1) return
    // Derive column count from CSS grid rather than hardcoding
    const colsParsed = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length
    const cols = colsParsed > 0 ? colsParsed : 3
    let nextIdx = currentIdx
    if (e.key === "ArrowRight") nextIdx = Math.min(buttons.length - 1, currentIdx + 1)
    else if (e.key === "ArrowLeft") nextIdx = Math.max(0, currentIdx - 1)
    else if (e.key === "ArrowDown") nextIdx = Math.min(buttons.length - 1, currentIdx + cols)
    else if (e.key === "ArrowUp") nextIdx = Math.max(0, currentIdx - cols)
    if (nextIdx !== currentIdx) {
      buttons[nextIdx].focus()
      buttons[nextIdx].scrollIntoView({ block: "nearest" })
    }
  }

  return (
    <div
      className="px-4 pb-2 md:pb-4 flex-shrink-0 relative message-input-container"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes("Files")) { dragCounterRef.current += 1; setIsDraggingOver(true) } }}
      onDragLeave={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes("Files")) { dragCounterRef.current -= 1; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDraggingOver(false) } } }}
    >
      {/* Drag-and-drop overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg pointer-events-none" style={{ background: "color-mix(in srgb, var(--theme-accent) 10%, transparent)", border: "2px dashed var(--theme-accent)" }}>
          <span className="text-sm font-medium" style={{ color: "var(--theme-accent)" }}>Drop files here</span>
        </div>
      )}

      {/* Smart reply suggestions */}
      {variant === "channel" && activeServerId && activeChannelId && (
        <SmartReplyTray
          serverId={activeServerId}
          channelId={activeChannelId}
          isTyping={content.length > 0 && content !== draft}
          hasContent={content.trim().length > 0}
          onSelect={(text) => {
            setContent(text)
            onDraftChange(text)
            textareaRef.current?.focus()
          }}
        />
      )}

      {/* Reply indicator */}
      {replyTo && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-t text-xs"
          style={{ background: "var(--theme-bg-secondary)", borderBottom: "1px solid var(--theme-bg-tertiary)" }}
        >
          <Reply className="w-3 h-3 -scale-x-100" style={{ color: "var(--theme-text-muted)" }} />
          <span style={{ color: "var(--theme-text-muted)" }}>Replying to</span>
          <span className="font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            {(() => {
              const r = replyTo as unknown as Record<string, unknown>
              const a = r.author as { display_name?: string | null; username?: string } | undefined
              const s = r.sender as { display_name?: string | null; username?: string } | undefined
              return a?.display_name || a?.username || s?.display_name || s?.username || "Unknown"
            })()}
          </span>
          <span className="truncate flex-1" style={{ color: "var(--theme-text-muted)" }}>
            {replyTo.content}
          </span>
          <button onClick={onCancelReply} aria-label="Cancel reply" className="focus-ring rounded" style={{ color: "var(--theme-text-muted)" }}>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* File previews */}
      {files.length > 0 && (
        <div
          className="flex gap-2 p-2 overflow-x-auto md:flex-wrap rounded-t no-scrollbar"
          style={{ background: "var(--theme-bg-secondary)", borderBottom: "1px solid var(--theme-bg-tertiary)" }}
        >
          {files.map((file, i) => (
            <div key={i} className="relative group w-28 md:w-24 flex-shrink-0">
              {file.type.startsWith("image/") ? (
                <img
                  src={getPreviewUrl(file)}
                  alt={file.name}
                  className="w-28 h-28 md:w-24 md:h-24 object-cover rounded-md border"
                  style={{ borderColor: "var(--theme-bg-tertiary)" }}
                />
              ) : (
                <div
                  className="w-28 h-28 md:w-24 md:h-24 rounded-md border flex items-center justify-center text-xs text-center p-2"
                  style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-secondary)", borderColor: "var(--theme-bg-tertiary)" }}
                >
                  {file.name}
                </div>
              )}
              <div className="mt-1 text-[10px] truncate" style={{ color: "var(--theme-text-muted)" }} title={file.name}>
                {file.name}
              </div>
              <button
                type="button"
                onClick={() => {
                  const url = fileUrlCache.current.get(files[i])
                  if (url) { URL.revokeObjectURL(url); fileUrlCache.current.delete(files[i]) }
                  setFiles((prev) => prev.filter((_, j) => j !== i))
                }}
                className="motion-interactive absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 touch-visible"
                style={{ background: "var(--theme-danger)" }}
                aria-label={`Remove ${file.name}`}
              >
                <X className="w-3 h-3" style={{ color: "var(--theme-text-bright)" }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {(uploadProgress !== null || sendError || sendSuccess) && (
        <div className={cn("px-3 py-2", files.length > 0 ? "rounded-none" : "rounded-t")} style={{ background: "var(--theme-bg-secondary)", borderBottom: "1px solid var(--theme-bg-tertiary)" }}>
          {uploadProgress !== null && (
            <div>
              <div className="h-1.5 rounded" style={{ background: "var(--theme-bg-tertiary)" }} role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(uploadProgress)}>
                <div className="h-1.5 rounded upload-progress-bar" style={{ width: `${uploadProgress}%`, background: "var(--theme-accent)" }} />
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px]" style={{ color: "var(--theme-text-muted)" }}>Uploading attachments… {Math.round(uploadProgress)}%</p>
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] surface-hover-md"
                  style={{ color: "var(--theme-danger)" }}
                  title="Cancel upload"
                  aria-label="Cancel upload"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </div>
          )}
          {sendSuccess && (
            <p className="text-[11px]" style={{ color: "var(--theme-success, #43b581)" }}>{sendSuccess}</p>
          )}
          {sendError && (
            <p className="text-[11px]" style={{ color: "var(--theme-danger)" }}>{sendError}</p>
          )}
        </div>
      )}

      {poll.showPollCreator && (
        <div
          ref={pollCreatorRef}
          className="mb-2 rounded-lg p-3 space-y-2"
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold" style={{ color: "var(--theme-text-primary)" }}>Create poll</p>
            <button type="button" aria-label="Close poll creator" className="focus-ring rounded" onClick={() => {
              poll.setShowPollCreator(false)
              poll.resetPollDraftToBlank()
            }} style={{ color: "var(--theme-text-muted)" }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            value={poll.pollQuestion}
            onChange={(event) => poll.setPollQuestion(event.target.value)}
            onKeyDown={poll.handlePollInputKeyDown}
            placeholder="Poll question"
            aria-label="Poll question"
            className="w-full px-2 py-1.5 rounded text-sm focus:outline-none"
            style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-normal)" }}
          />
          <div className="space-y-1.5">
            {poll.pollOptions.map((option, index) => (
              <div key={`poll-option-${index}`} className="flex items-center gap-1.5">
                <input
                  value={option}
                  onChange={(event) => {
                    const next = [...poll.pollOptions]
                    next[index] = event.target.value
                    poll.setPollOptions(next)
                  }}
                  onKeyDown={poll.handlePollInputKeyDown}
                  placeholder={`Option ${index + 1}`}
                  aria-label={`Poll option ${index + 1}`}
                  className="w-full px-2 py-1.5 rounded text-sm focus:outline-none"
                  style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-normal)" }}
                />
                <button
                  type="button"
                  onClick={() => poll.removePollOption(index)}
                  disabled={poll.pollOptions.length <= 2}
                  className="px-2 py-1 rounded text-xs disabled:opacity-50 focus-ring"
                  style={{ color: "var(--theme-text-muted)", border: "1px solid var(--theme-bg-tertiary)" }}
                  aria-label={`Remove option ${index + 1}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => poll.addPollOption()}
              disabled={poll.pollOptions.length >= poll.maxPollOptions}
              className="text-xs disabled:opacity-50"
              style={{ color: "var(--theme-link)" }}
            >
              Add option
            </button>
            <button
              type="button"
              onClick={poll.handleCreatePoll}
              disabled={!poll.canInsertPoll}
              className="px-2 py-1 rounded text-xs font-medium disabled:opacity-50"
              style={{ background: "var(--theme-accent)", color: "white" }}
            >
              Insert poll
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div
        className={cn(
          "relative flex items-center gap-2 rounded-lg px-3 py-2",
          replyTo || files.length > 0 || uploadProgress !== null || Boolean(sendError) || Boolean(sendSuccess) ? "rounded-t-none" : ""
        )}
        style={{
          background: "var(--theme-surface-input)",
          boxShadow: inputFocused ? '0 0 0 2px color-mix(in srgb, var(--theme-accent) 55%, transparent)' : '0 0 0 2px transparent',
          transition: 'box-shadow var(--motion-duration-fast) var(--motion-ease-standard)',
        }}
      >
        {/* Left-side action button(s) */}
        {variant === "dm" ? (
          /* DM mode: simple paperclip button for file attachment */
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="motion-interactive motion-press flex-shrink-0 w-7 h-7 flex items-center justify-center focus-ring rounded-full"
            style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-secondary)" }}
            title="Attach file"
            aria-label="Attach file"
          >
            <Paperclip className="w-4 h-4" />
          </button>
        ) : (
          /* Channel mode: + dropdown with Upload, Poll, Thread */
          <div className="relative flex-shrink-0">
            <button
              type="button"
              ref={plusButtonRef}
              onClick={() => setShowPlusMenu((v) => !v)}
              className="motion-interactive motion-press flex-shrink-0 w-7 h-7 flex items-center justify-center focus-ring rounded-full"
              style={{
                background: showPlusMenu ? "var(--theme-accent)" : "var(--theme-bg-tertiary)",
                color: showPlusMenu ? "white" : "var(--theme-text-secondary)",
              }}
              title="More options"
              aria-label="More options"
              aria-expanded={showPlusMenu}
            >
              <Plus className="w-4 h-4" />
            </button>

            {showPlusMenu && (
              <div
                ref={plusMenuRef}
                role="menu"
                aria-label="More options"
                className="absolute bottom-full mb-2 left-0 z-50 rounded-lg shadow-xl overflow-hidden"
                style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)", minWidth: "200px" }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setShowPlusMenu(false); fileRef.current?.click() }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left surface-hover motion-interactive"
                  style={{ color: "var(--theme-text-primary)" }}
                >
                  <FileUp className="w-4 h-4 flex-shrink-0" style={{ color: "var(--theme-accent)" }} />
                  Upload a File
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowPlusMenu(false)
                    poll.openPollCreator()
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left surface-hover motion-interactive"
                  style={{ color: "var(--theme-text-primary)" }}
                >
                  <BarChart3 className="w-4 h-4 flex-shrink-0" style={{ color: "var(--theme-accent)" }} />
                  Create Poll
                </button>
                {onCreateThread && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setShowPlusMenu(false); onCreateThread() }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left surface-hover motion-interactive"
                    style={{ color: "var(--theme-text-primary)" }}
                  >
                    <MessageSquare className="w-4 h-4 flex-shrink-0" style={{ color: "var(--theme-accent)" }} />
                    Create Thread
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Text input */}
        <div className="flex-1 relative">
          {/* Emoji autocomplete dropdown */}
          {emoji.isOpen && !mention.isOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 z-50">
              <EmojiSuggestions
                matches={emoji.matches}
                selectedIndex={emoji.selectedIndex}
                onSelect={(match) => {
                  insertEmoji(match)
                  textareaRef.current?.focus()
                }}
              />
            </div>
          )}

          {/* Mention autocomplete dropdown */}
          {mention.isOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 z-50">
              <MentionSuggestions
                suggestions={mention.filteredSuggestions}
                selectedIndex={mention.selectedIndex}
                query={mention.query ?? ""}
                onSelect={(suggestion) => {
                  insertMention(suggestion)
                  textareaRef.current?.focus()
                }}
              />
            </div>
          )}

          {/* Slash command autocomplete dropdown */}
          {slash.isOpen && !mention.isOpen && !emoji.isOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 z-50">
              <SlashCommandSuggestions
                commands={slash.matches}
                selectedIndex={slash.selectedIndex}
                onSelect={(command) => {
                  insertSlashCommand(command)
                  textareaRef.current?.focus()
                }}
              />
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onSelect={handleSelect}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onTouchEnd={(e) => {
              // Mobile browsers don't always fire onSelect after a tap —
              // read the cursor position on touchEnd so mention detection stays in sync.
              // Capture currentTarget synchronously — React nullifies it after the handler returns.
              const ta = e.currentTarget
              requestAnimationFrame(() => {
                if (ta) setCursorPosition(ta.selectionStart)
              })
            }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            aria-label={
              variant === "dm"
                ? (replyTo ? `Reply to ${channelName}` : `Message ${channelName}`)
                : (replyTo ? `Reply in #${channelName}` : `Message #${channelName}`)
            }
            placeholder={
              variant === "dm"
                ? (replyTo
                    ? (isMobile ? `Reply to ${channelName}` : `Reply to ${channelName} — press Enter to send, Shift+Enter for newline`)
                    : (isMobile ? `Message ${channelName}` : `Message ${channelName} — press Enter to send, Shift+Enter for newline`))
                : (replyTo
                    ? (isMobile ? `Reply in #${channelName}` : `Reply in #${channelName} — press Enter to send, Shift+Enter for newline`)
                    : (isMobile ? `Message #${channelName}` : `Message #${channelName} — @ mention, : emoji, / command`))
            }
            rows={1}
            className="w-full resize-none bg-transparent text-sm focus:outline-none block"
            style={{ color: "var(--theme-text-normal)", maxHeight: "200px", lineHeight: "28px", height: "28px", padding: 0, margin: 0, border: "none" }}
          />
        </div>

        {showEmojiPicker && EmojiPicker && (
          <div
            ref={emojiPickerRef}
            data-state="open"
            className="panel-surface-motion fixed inset-x-0 bottom-0 z-overlay flex flex-col rounded-t-2xl border-t p-2 shadow-xl md:absolute md:inset-x-auto md:bottom-14 md:right-4 md:w-[420px] md:rounded-lg md:border"
            style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-bg-tertiary)", maxHeight: "min(75vh, 520px)", overflow: "hidden" }}
            onTouchStart={(e) => {
              const el = e.currentTarget
              const startY = e.touches[0].clientY
              let moved = false
              const onMove = (ev: TouchEvent) => {
                const dy = ev.touches[0].clientY - startY
                // Only dismiss if scrollable content is at the top
                const scrollable = el.querySelector("[data-frimousse-scroll], [style*='overflow']") as HTMLElement | null
                const atTop = !scrollable || scrollable.scrollTop <= 0
                if (dy > 60 && atTop) { moved = true; setShowEmojiPicker(false) }
              }
              const onEnd = () => { el.removeEventListener("touchmove", onMove); el.removeEventListener("touchend", onEnd) }
              el.addEventListener("touchmove", onMove, { passive: true })
              el.addEventListener("touchend", onEnd, { once: true })
            }}
          >
              {/* Drag handle + close button — visible on mobile only */}
              <div className="flex items-center justify-between pt-1 pb-1 md:hidden">
                <div className="w-8" />
                <div className="w-10 h-1 rounded-full" style={{ background: "var(--theme-bg-tertiary)" }} aria-hidden />
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(false)}
                  aria-label="Close picker"
                  className="w-8 h-8 flex items-center justify-center rounded-full focus-ring"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mb-2 flex items-center gap-1 shrink-0" role="tablist" aria-label="Picker type">
                {([
                  { key: "emoji" as const, label: "Emoji", panel: "emoji-tab-panel" },
                  { key: "gif" as const, label: "GIFs", panel: "gif-tab-panel" },
                  { key: "sticker" as const, label: "Stickers", panel: "sticker-tab-panel" },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    role="tab"
                    aria-selected={pickerTab === tab.key}
                    aria-controls={tab.panel}
                    onClick={() => setPickerTab(tab.key)}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold focus-ring transition-colors"
                    style={{ background: pickerTab === tab.key ? "color-mix(in srgb, var(--theme-accent) 20%, transparent)" : "transparent", color: pickerTab === tab.key ? "var(--theme-accent)" : "var(--theme-text-secondary)", borderBottom: pickerTab === tab.key ? "2px solid var(--theme-accent)" : "2px solid transparent" }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {pickerTab === "emoji" && (
                <div
                  id="emoji-tab-panel"
                  role="tabpanel"
                  ref={emojiGridRef}
                  onKeyDown={handleEmojiGridKeyDown}
                  style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}
                >
                  <EmojiPicker.Root
                    onEmojiSelect={({ emoji }) => {
                      const textarea = textareaRef.current
                      const start = textarea ? textarea.selectionStart ?? content.length : content.length
                      const end = textarea ? textarea.selectionEnd ?? start : start
                      const next = content.slice(0, start) + emoji + content.slice(end)
                      setContent(next)
                      setCursorPosition(start + emoji.length)
                      onDraftChange(next)
                      setShowEmojiPicker(false)
                      requestAnimationFrame(() => {
                        if (textarea) {
                          textarea.focus()
                          textarea.setSelectionRange(start + emoji.length, start + emoji.length)
                        }
                      })
                    }}
                    style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}
                  >
                    <div style={{ padding: "6px 6px 4px" }}>
                      <EmojiPicker.Search
                        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--theme-accent)]"
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "5px 10px",
                          borderRadius: "6px",
                          fontSize: "13px",
                          boxSizing: "border-box",
                          background: "var(--theme-bg-tertiary)",
                          color: "var(--theme-text-normal)",
                          border: "none",
                          outline: "none",
                        }}
                        placeholder="Search emoji…"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmojiSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.key === "Tab" && !e.shiftKey) || e.key === "ArrowDown") {
                            const firstBtn = emojiGridRef.current?.querySelector<HTMLButtonElement>("[data-emoji-btn]")
                            if (firstBtn) {
                              e.preventDefault()
                              firstBtn.focus()
                            }
                          }
                        }}
                      />
                    </div>
                    <EmojiPicker.Viewport style={{ flex: 1, overflow: "hidden auto" }}>
                      {serverEmojis.length > 0 && (
                        <CustomEmojiGrid
                          emojis={serverEmojis}
                          search={emojiSearch}
                          onSelect={(emoji) => {
                            const textarea = textareaRef.current
                            const start = textarea ? textarea.selectionStart ?? content.length : content.length
                            const end = textarea ? textarea.selectionEnd ?? start : start
                            const insertion = `:${emoji.name}: `
                            const next = content.slice(0, start) + insertion + content.slice(end)
                            setContent(next)
                            setCursorPosition(start + insertion.length)
                            onDraftChange(next)
                            setShowEmojiPicker(false)
                            requestAnimationFrame(() => {
                              if (textarea) {
                                textarea.focus()
                                textarea.setSelectionRange(start + insertion.length, start + insertion.length)
                              }
                            })
                          }}
                        />
                      )}
                      <EmojiPicker.Loading>
                        <div style={{ padding: "12px", color: "var(--theme-text-muted)", fontSize: "12px" }}>Loading…</div>
                      </EmojiPicker.Loading>
                      <EmojiPicker.Empty>
                        {({ search }) => (
                          <div style={{ padding: "12px", color: "var(--theme-text-muted)", fontSize: "12px" }}>
                            No emoji found for &ldquo;{search}&rdquo;
                          </div>
                        )}
                      </EmojiPicker.Empty>
                      <EmojiPicker.List
                        components={{
                          CategoryHeader: ({ category, ...props }) => (
                            <div
                              {...props}
                              style={{
                                padding: "3px 8px",
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
                              data-emoji-btn=""
                              tabIndex={-1}
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
                    <div style={{ padding: "4px 8px 6px", display: "flex", alignItems: "center", justifyContent: "flex-end", borderTop: "1px solid var(--theme-bg-tertiary)" }}>
                      <EmojiPicker.SkinToneSelector
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          fontSize: "16px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          border: "1px solid var(--theme-bg-tertiary)",
                          background: "var(--theme-bg-tertiary)",
                        }}
                        aria-label="Change skin tone"
                      />
                    </div>
                  </EmojiPicker.Root>
                </div>
              )}
              {pickerTab === "gif" && (
                <div id="gif-tab-panel" role="tabpanel" className="flex flex-col gap-2 min-h-0 flex-1 overflow-hidden">
                  <input
                    value={media.gifQuery}
                    onChange={(e) => media.setGifQuery(e.target.value)}
                    placeholder="Search GIFs"
                    aria-label="Search GIFs"
                    className="w-full px-2 py-1.5 rounded text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--theme-accent)] shrink-0"
                    style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-normal)" }}
                  />
                  {/* Search autocomplete suggestions */}
                  {media.gifSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1 shrink-0">
                      {media.gifSuggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => media.setGifQuery(s)}
                          className="px-2 py-0.5 rounded-full text-[11px] hover:opacity-80 transition-opacity"
                          style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-secondary)" }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Section header */}
                  {!media.gifQuery.trim() && !media.gifLoading && media.gifResults.length > 0 && (
                    <p className="text-[11px] font-semibold uppercase tracking-wider shrink-0" style={{ color: "var(--theme-text-muted)" }}>
                      Trending
                    </p>
                  )}
                  {media.gifLoading ? (
                    <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Loading GIFs…</p>
                  ) : (
                    <>
                      <div
                        className="grid grid-cols-2 md:grid-cols-3 gap-1.5 overflow-y-auto flex-1 min-h-0 p-0.5"
                        onKeyDown={handleGifGridKeyDown}
                      >
                        {media.gifResults.map((gif) => (
                          <button
                            key={gif.id}
                            onClick={async () => {
                              if (sending) return
                              const gifUrl = gif.url || gif.gifUrl
                              if (!gifUrl?.trim()) {
                                setSendError("Cannot send empty GIF.")
                                return
                              }
                              setShowEmojiPicker(false)
                              setSending(true)
                              setSendError(null)
                              onSent?.()
                              try {
                                await onSend(gifUrl)
                              } catch (error: unknown) {
                                setSendError(error instanceof Error ? error.message : "Failed to send GIF. Try again.")
                              } finally {
                                setSending(false)
                                textareaRef.current?.focus()
                              }
                            }}
                            className="rounded-md overflow-hidden hover:scale-[1.03] transition-transform focus-ring relative group"
                            title={gif.title}
                            aria-label={gif.title}
                          >
                            <img src={gif.previewUrl} alt={gif.title} className="w-full aspect-square object-cover" />
                            <span className="absolute inset-x-0 bottom-0 px-1.5 py-1 text-[10px] truncate text-left opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "#fff", background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }}>{gif.title || "GIF"}</span>
                          </button>
                        ))}
                      </div>
                      {media.gifResults.length === 0 && (
                        <p className="text-xs text-center py-4" style={{ color: "var(--theme-text-muted)" }}>
                          {media.gifQuery.trim() ? "No GIFs found for your search." : "GIFs are currently unavailable."}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
              {pickerTab === "sticker" && (
                <div id="sticker-tab-panel" role="tabpanel" className="flex flex-col gap-2 min-h-0 flex-1 overflow-hidden">
                  <input
                    value={media.stickerQuery}
                    onChange={(e) => media.setStickerQuery(e.target.value)}
                    placeholder="Search stickers"
                    aria-label="Search stickers"
                    className="w-full px-2 py-1.5 rounded text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--theme-accent)] shrink-0"
                    style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-normal)" }}
                  />
                  {!media.stickerQuery.trim() && !media.stickerLoading && media.stickerResults.length > 0 && (
                    <p className="text-[11px] font-semibold uppercase tracking-wider shrink-0" style={{ color: "var(--theme-text-muted)" }}>
                      Trending
                    </p>
                  )}
                  {media.stickerLoading ? (
                    <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Loading stickers…</p>
                  ) : (
                    <>
                      <div
                        className="grid grid-cols-3 gap-2 overflow-y-auto flex-1 min-h-0 p-0.5"
                        onKeyDown={handleGifGridKeyDown}
                      >
                        {media.stickerResults.map((sticker) => (
                          <button
                            key={sticker.id}
                            onClick={async () => {
                              if (sending) return
                              const stickerUrl = sticker.url || sticker.gifUrl
                              if (!stickerUrl?.trim()) {
                                setSendError("Cannot send empty sticker.")
                                return
                              }
                              setShowEmojiPicker(false)
                              setSending(true)
                              setSendError(null)
                              onSent?.()
                              try {
                                await onSend(stickerUrl)
                              } catch (error: unknown) {
                                setSendError(error instanceof Error ? error.message : "Failed to send sticker. Try again.")
                              } finally {
                                setSending(false)
                                textareaRef.current?.focus()
                              }
                            }}
                            className="rounded-lg overflow-hidden hover:scale-105 transition-transform focus-ring aspect-square"
                            style={{ background: "var(--theme-bg-tertiary)", padding: "6px" }}
                            title={sticker.title}
                            aria-label={sticker.title}
                          >
                            <img src={sticker.previewUrl} alt={sticker.title} className="w-full h-full object-contain" />
                          </button>
                        ))}
                      </div>
                      {media.stickerResults.length === 0 && (
                        <p className="text-xs text-center py-4" style={{ color: "var(--theme-text-muted)" }}>
                          {media.stickerQuery.trim() ? "No stickers found for your search." : "Stickers are currently unavailable."}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
          </div>
        )}

        {/* Emoji picker button (opens tabbed Emoji/GIF/Sticker picker) */}
        <button
          type="button"
          ref={emojiButtonRef}
          onClick={() => {
            setShowEmojiPicker((prev) => !prev)
          }}
          className="motion-interactive motion-press flex-shrink-0 focus-ring rounded"
          style={{ color: showEmojiPicker ? "var(--theme-accent)" : "var(--theme-text-secondary)" }}
          title="Emoji, GIFs & Stickers"
          aria-label="Open emoji, GIF and sticker picker"
          aria-pressed={showEmojiPicker}
        >
          <Smile className="w-5 h-5" />
        </button>

        {/* Send button */}
        {(content.trim() || files.length > 0) && (
          <button
            onClick={() => { navigator.vibrate?.(8); handleSend() }}
            disabled={sending}
            aria-label="Send message"
            className="motion-interactive motion-press flex-shrink-0 focus-ring rounded p-1"
            style={{ color: "var(--theme-accent)" }}
            title="Send Message"
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </div>
      <div
        className="mt-1 px-1 hidden md:flex items-center justify-between text-[11px]"
        style={{ color: "var(--theme-text-muted)" }}
      >
        <span>Enter send · Shift+Enter newline</span>
        {mention.isOpen && <span>↑↓ navigate · Tab/Enter accept · Esc dismiss</span>}
      </div>
    </div>
  )
}
