"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { MessageSquare, Plus, ArrowLeft, Users } from "lucide-react"
import { useMobileLayout } from "@/hooks/use-mobile-layout"
import { useMarkChannelRead } from "@/hooks/use-mark-channel-read"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { sendReactionMutation } from "@/lib/reactions-client"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import type { ChannelRow, MessageWithAuthor } from "@/types/database"
import { MessageItem } from "@/components/chat/message-item"
import { MessageInput } from "@/components/chat/message-input"
import { useGatewayMessages } from "@/hooks/use-gateway-messages"

interface Props {
  channel: ChannelRow
  initialMessages: MessageWithAuthor[]
  currentUserId: string
  serverId: string
  canSendMessages: boolean
}

type ForumView = "list" | "thread"

/** Forum-style channel with a post list view and per-thread conversation drill-down. */
export function ForumChannel({ channel, initialMessages, currentUserId, serverId, canSendMessages }: Props) {
  const isMobile = useMobileLayout()
  const { setActiveServer, setActiveChannel, memberListOpen, toggleMemberList } = useAppStore(
    useShallow((s) => ({ setActiveServer: s.setActiveServer, setActiveChannel: s.setActiveChannel, memberListOpen: s.memberListOpen, toggleMemberList: s.toggleMemberList }))
  )
  const [messages, setMessages] = useState<MessageWithAuthor[]>(initialMessages)
  const [view, setView] = useState<ForumView>("list")
  const [activeThread, setActiveThread] = useState<MessageWithAuthor | null>(null)
  const [newPostTitle, setNewPostTitle] = useState("")
  const [showNewPost, setShowNewPost] = useState(false)
  const [replyTo, setReplyTo] = useState<MessageWithAuthor | null>(null)
  const [threadReplyDraft, setThreadReplyDraft] = useState("")
  const [newPostDraft, setNewPostDraft] = useState("")
  const [sortMode, setSortMode] = useState<"recent" | "popular" | "unanswered">("recent")
  const bottomRef = useRef<HTMLDivElement>(null)
  const supabase = useMemo(() => createClientSupabaseClient(), [])

  useEffect(() => {
    setActiveServer(serverId)
    setActiveChannel(channel.id)
    return () => {
      setActiveServer(null)
      setActiveChannel(null)
    }
  }, [serverId, channel.id, setActiveServer, setActiveChannel])

  useMarkChannelRead(channel.id)

  useEffect(() => {
    if (view === "thread") bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length, view])

  useEffect(() => {
    setThreadReplyDraft("")
  }, [activeThread?.id])

  useGatewayMessages(
    channel.id,
    (newMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMessage.id)) return prev
        return [...prev, newMessage]
      })
    },
    (updatedMessage) => {
      setMessages((prev) => {
        if (updatedMessage.deleted_at) {
          return prev.filter((m) => m.id !== updatedMessage.id)
        }
        return prev.map((m) => m.id === updatedMessage.id ? { ...m, ...updatedMessage } : m)
      })
    },
    (reaction) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== reaction.message_id) return m
          if (m.reactions.some((r) => r.emoji === reaction.emoji && r.user_id === reaction.user_id)) return m
          return { ...m, reactions: [...m.reactions, reaction] }
        })
      )
    },
    (reaction) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== reaction.message_id) return m
          return { ...m, reactions: m.reactions.filter((r) => !(r.emoji === reaction.emoji && r.user_id === reaction.user_id)) }
        })
      )
    }
  )

  async function handleCreatePost(content: string, attachmentFiles?: File[]) {
    if (!canSendMessages) return
    if (!content.trim()) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const attachments: { url: string; filename: string; size: number; content_type: string }[] = []
    if (attachmentFiles?.length) {
      for (const file of attachmentFiles) {
        const path = `${channel.id}/${Date.now()}-${file.name}`
        const { error } = await supabase.storage.from("attachments").upload(path, file)
        if (!error) {
          const { data: signed } = await supabase.storage.from("attachments").createSignedUrl(path, 3600 * 24 * 7)
          if (signed) {
            attachments.push({ url: signed.signedUrl, filename: file.name, size: file.size, content_type: file.type })
          }
        }
      }
    }

    const postContent = newPostTitle.trim()
      ? `**${newPostTitle.trim()}**\n\n${content.trim()}`
      : content.trim()

    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        channel_id: channel.id,
        author_id: user.id,
        content: postContent,
        reply_to_id: replyTo?.id || null,
      })
      .select(`*, author:users!messages_author_id_fkey(*), attachments(*), reactions(*)`)
      .single()

    if (error) { console.error("Failed to create forum post:", error); return }

    if (attachments.length > 0 && message) {
      await supabase.from("attachments").insert(attachments.map((a) => ({ ...a, message_id: message.id })))
    }

    setNewPostTitle("")
    setShowNewPost(false)
    setReplyTo(null)
    setNewPostDraft("")

    // Update last_post_at for the forum channel
    await supabase.from("channels").update({ last_post_at: new Date().toISOString() }).eq("id", channel.id)
  }

  async function handleThreadReply(content: string, attachmentFiles?: File[]) {
    if (!canSendMessages) return
    if (!content.trim()) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const attachments: { url: string; filename: string; size: number; content_type: string }[] = []
    if (attachmentFiles?.length) {
      for (const file of attachmentFiles) {
        const path = `${channel.id}/${Date.now()}-${file.name}`
        const { error } = await supabase.storage.from("attachments").upload(path, file)
        if (!error) {
          const { data: signed } = await supabase.storage.from("attachments").createSignedUrl(path, 3600 * 24 * 7)
          if (signed) {
            attachments.push({ url: signed.signedUrl, filename: file.name, size: file.size, content_type: file.type })
          }
        }
      }
    }

    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        channel_id: channel.id,
        author_id: user.id,
        content: content.trim(),
        reply_to_id: activeThread?.id || null,
      })
      .select(`*, author:users!messages_author_id_fkey(*), attachments(*), reactions(*)`)
      .single()

    if (error) { console.error("Failed to reply:", error); return }

    if (attachments.length > 0 && message) {
      await supabase.from("attachments").insert(attachments.map((a) => ({ ...a, message_id: message.id })))
    }

    setReplyTo(null)

    // Update last_post_at
    await supabase.from("channels").update({ last_post_at: new Date().toISOString() }).eq("id", channel.id)
  }

  // Pre-compute reply counts once (avoids O(n²) in sort comparator)
  const replyCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of messages) {
      if (m.reply_to_id) {
        map.set(m.reply_to_id, (map.get(m.reply_to_id) ?? 0) + 1)
      }
    }
    return map
  }, [messages])

  // Top-level posts: messages not replying to another message
  const sortedPosts = useMemo(() => {
    const topLevelPosts = messages.filter((m) => !m.reply_to_id)
    return [...topLevelPosts].sort((a, b) => {
      if (sortMode === "popular") return (replyCountMap.get(b.id) ?? 0) - (replyCountMap.get(a.id) ?? 0)
      if (sortMode === "unanswered") {
        const aReplies = replyCountMap.get(a.id) ?? 0
        const bReplies = replyCountMap.get(b.id) ?? 0
        if ((aReplies === 0) !== (bReplies === 0)) return aReplies === 0 ? -1 : 1
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [messages, sortMode, replyCountMap])

  // Replies to the active thread post
  const threadReplies = useMemo(
    () => activeThread ? messages.filter((m) => m.reply_to_id === activeThread.id) : [],
    [messages, activeThread]
  )

  // Stable handlers for MessageItem callbacks (avoids recreating logic per render)
  const handleMessageEdit = useCallback(async (messageId: string, content: string) => {
    const { error } = await supabase.from("messages").update({ content, edited_at: new Date().toISOString() }).eq("id", messageId)
    if (!error) setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content, edited_at: new Date().toISOString() } : m))
  }, [supabase])

  const handleMessageDelete = useCallback(async (messageId: string) => {
    const { error } = await supabase.from("messages").delete().eq("id", messageId)
    if (!error) setMessages((prev) => prev.filter((m) => m.id !== messageId))
  }, [supabase])

  const handleMessageReaction = useCallback(async (messageId: string, emoji: string) => {
    let previousReactions: MessageWithAuthor["reactions"] = []
    let remove = false

    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId) return m
      previousReactions = m.reactions
      const hasOwn = m.reactions.some((r) => r.user_id === currentUserId && r.emoji === emoji)
      remove = hasOwn
      return {
        ...m,
        reactions: hasOwn
          ? m.reactions.filter((r) => !(r.user_id === currentUserId && r.emoji === emoji))
          : [...m.reactions, { message_id: messageId, user_id: currentUserId, emoji, created_at: new Date().toISOString() }],
      }
    }))

    try {
      await sendReactionMutation({ messageId, emoji, remove, nonce: crypto.randomUUID() })
    } catch (error) {
      console.error("Failed to update reaction", error)
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions: previousReactions } : m))
    }
  }, [currentUserId])

  if (view === "thread" && activeThread) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden" style={{ background: 'var(--theme-bg-primary)' }}>
        {/* Thread header — full version on desktop, compact back-to-list on mobile */}
        {!isMobile ? (
          <div
            className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
            style={{ borderColor: 'var(--theme-bg-tertiary)' }}
          >
            <button
              type="button"
              onClick={() => { setView("list"); setActiveThread(null) }}
              className="p-1 rounded hover:bg-white/10 transition-colors"
              aria-label="Back to forum posts"
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <MessageSquare className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--theme-text-muted)' }} />
            <span className="font-semibold text-white truncate">
              {activeThread.content?.split("\n")[0].replace(/\*\*/g, "") ?? "Thread"}
            </span>
            <div className="ml-auto flex items-center">
              <button type="button" onClick={toggleMemberList} className="p-1.5 rounded hover:bg-white/10 transition-colors" aria-label={memberListOpen ? "Hide member list" : "Show member list"}>
                <Users className="w-5 h-5" style={{ color: memberListOpen ? 'var(--theme-text-primary)' : 'var(--theme-text-muted)' }} />
              </button>
            </div>
          </div>
        ) : (
          <div
            className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0"
            style={{ borderColor: 'var(--theme-bg-tertiary)' }}
          >
            <button
              type="button"
              onClick={() => { setView("list"); setActiveThread(null) }}
              className="p-1 rounded hover:bg-white/10 transition-colors"
              aria-label="Back to forum posts"
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <MessageSquare className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--theme-text-muted)' }} />
            <span className="text-sm font-semibold text-white truncate">
              {activeThread.content?.split("\n")[0].replace(/\*\*/g, "") ?? "Thread"}
            </span>
          </div>
        )}

        {/* Original post */}
        <div className="overflow-y-auto flex-1">
          <div className="border-b pb-2" style={{ borderColor: 'var(--theme-bg-tertiary)' }}>
            <MessageItem
              message={activeThread}
              isGrouped={false}
              currentUserId={currentUserId}
              onReply={() => {}}
              onEdit={(content) => handleMessageEdit(activeThread.id, content)}
              onDelete={async () => {
                await handleMessageDelete(activeThread.id)
                setView("list")
                setActiveThread(null)
              }}
              onReaction={(emoji) => handleMessageReaction(activeThread.id, emoji)}
            />
          </div>

          {/* Thread replies */}
          <div className="pb-4">
            {threadReplies.length === 0 && (
              <p className="px-4 py-4 text-sm" style={{ color: 'var(--theme-text-muted)' }}>No replies yet. Be the first to reply!</p>
            )}
            {threadReplies.map((reply, i) => {
              const prev = threadReplies[i - 1]
              const isGrouped = prev && prev.author_id === reply.author_id &&
                new Date(reply.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000
              return (
                <MessageItem
                  key={reply.id}
                  message={reply}
                  isGrouped={!!isGrouped}
                  currentUserId={currentUserId}
                  onReply={() => setReplyTo(reply)}
                  onEdit={(content) => handleMessageEdit(reply.id, content)}
                  onDelete={() => handleMessageDelete(reply.id)}
                  onReaction={(emoji) => handleMessageReaction(reply.id, emoji)}
                />
              )
            })}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Reply input */}
        <MessageInput
          channelName={`Reply in thread`}
          draft={threadReplyDraft}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={handleThreadReply}
          onDraftChange={setThreadReplyDraft}
        />
      </div>
    )
  }

  // Forum post list view
  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Forum header — hidden on mobile where ServerMobileLayout provides it */}
      {!isMobile && <div
        className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--theme-bg-tertiary)' }}
      >
        <MessageSquare className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--theme-text-muted)' }} />
        <span className="font-semibold text-white">{channel.name}</span>
        {channel.topic && (
          <>
            <span style={{ color: 'var(--theme-text-faint)' }}>|</span>
            <span className="text-sm truncate" style={{ color: 'var(--theme-text-muted)' }}>{channel.topic}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            disabled={!canSendMessages}
            onClick={() => setShowNewPost(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--theme-accent)', color: 'white' }}
          >
            <Plus className="w-4 h-4" />
            New Post
          </button>
          <button onClick={toggleMemberList} className="p-1.5 rounded hover:bg-white/10 transition-colors" aria-label={memberListOpen ? "Hide member list" : "Show member list"}>
            <Users className="w-5 h-5" style={{ color: memberListOpen ? 'var(--theme-text-primary)' : 'var(--theme-text-muted)' }} />
          </button>
        </div>
      </div>}

      {/* Mobile-only New Post button — desktop version is inside the header above */}
      {isMobile && (
        <div className="flex items-center justify-end px-4 pt-2">
          <button
            type="button"
            disabled={!canSendMessages}
            onClick={() => setShowNewPost(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--theme-accent)', color: 'white' }}
          >
            <Plus className="w-4 h-4" />
            New Post
          </button>
        </div>
      )}

      {/* Guidelines banner */}
      <div
        className="mx-4 mt-3 px-3 py-2 rounded text-sm"
        style={{ background: 'rgba(88,101,242,0.1)', border: '1px solid rgba(88,101,242,0.3)', color: 'var(--theme-text-secondary)' }}
      >
        <strong className="text-white">Guidelines: </strong>{channel.forum_guidelines || "Use clear titles, add context, and mark solved replies."}
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {['Question', 'Help', 'Discussion'].map((tag) => (
            <span key={tag} className="px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>#{tag}</span>
          ))}
          <span style={{ color: 'var(--theme-text-muted)' }}>Template: Problem · Steps Tried · Expected Outcome</span>
        </div>
      </div>

      <div className="mx-4 mt-3 flex items-center gap-2 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
        <span>Browse:</span>
        {([
          ["recent", "Recent"],
          ["popular", "Popular"],
          ["unanswered", "Unanswered"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setSortMode(value)}
            className="px-2 py-1 rounded"
            style={{ background: sortMode === value ? 'var(--theme-bg-tertiary)' : 'transparent', color: sortMode === value ? 'var(--theme-text-primary)' : 'var(--theme-text-muted)' }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* New post form */}
      {showNewPost && canSendMessages && (
        <div
          className="mx-4 mt-3 p-3 rounded border"
          style={{ background: 'var(--theme-bg-secondary)', borderColor: 'var(--theme-bg-tertiary)' }}
        >
          <input
            value={newPostTitle}
            onChange={(e) => setNewPostTitle(e.target.value)}
            placeholder="Post title (optional, recommended)"
            className="w-full px-3 py-2 mb-2 rounded text-sm text-white focus:outline-none"
            style={{ background: 'var(--theme-bg-tertiary)' }}
          />
          <MessageInput
            channelName="new post content"
            draft={newPostDraft}
            replyTo={null}
            onCancelReply={() => {
              setNewPostDraft("")
            }}
            onSend={handleCreatePost}
            onDraftChange={setNewPostDraft}
          />
          <button
            onClick={() => { setShowNewPost(false); setNewPostTitle(""); setNewPostDraft("") }}
            className="mt-1 text-xs"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Post list */}
      <div className="flex-1 overflow-y-auto py-4 px-4 space-y-2">
        {sortedPosts.length === 0 && !showNewPost && (
          <div className="text-center py-12">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-4 mx-auto"
              style={{ background: 'var(--theme-text-faint)' }}
            >
              <MessageSquare className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">No posts yet</h2>
            <p className="mb-4" style={{ color: 'var(--theme-text-secondary)' }}>
              {channel.forum_guidelines || "Be the first to start a discussion!"}
            </p>
            <button
              disabled={!canSendMessages}
              onClick={() => setShowNewPost(true)}
              className="px-4 py-2 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--theme-accent)', color: 'white' }}
            >
              <Plus className="w-4 h-4 inline mr-1" />
              Create First Post
            </button>
          </div>
        )}

        {sortedPosts.map((post) => {
          const replyCount = replyCountMap.get(post.id) ?? 0
          const firstLine = post.content?.split("\n")[0] ?? ""
          const isTitle = firstLine.startsWith("**") && firstLine.endsWith("**")
          const title = isTitle ? firstLine.replace(/\*\*/g, "") : null
          const body = isTitle ? post.content?.slice(firstLine.length).trim() : post.content

          return (
            <button
              key={post.id}
              onClick={() => { setActiveThread(post); setView("thread") }}
              className="w-full text-left p-3 rounded border transition-colors hover:bg-white/5"
              style={{ background: 'var(--theme-bg-secondary)', borderColor: 'var(--theme-bg-tertiary)' }}
            >
              <div className="flex items-start gap-3">
                <MessageSquare className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--theme-text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-white text-sm truncate">
                      {title ?? (post.content?.slice(0, 80) ?? "Untitled post")}
                      {!title && (post.content?.length ?? 0) > 80 ? "…" : ""}
                    </span>
                  </div>
                  {title && body && (
                    <p className="text-xs truncate" style={{ color: 'var(--theme-text-muted)' }}>
                      {body.slice(0, 120)}{body.length > 120 ? "…" : ""}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                    <span>{post.author.display_name ?? post.author.username}</span>
                    <span>·</span>
                    <span>{new Date(post.created_at).toLocaleDateString()}</span>
                    <span>·</span>
                    <span>{replyCount} {replyCount === 1 ? "reply" : "replies"}</span>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
