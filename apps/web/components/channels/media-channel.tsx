"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { ImageIcon, Users } from "lucide-react"
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
import { getDraft, setDraft } from "@/lib/chat-outbox"

interface Props {
  channel: ChannelRow
  initialMessages: MessageWithAuthor[]
  currentUserId: string
  serverId: string
  canSendMessages: boolean
  requireMediaAttachments: boolean
}

/** Media-focused channel view optimized for image and file sharing with gallery-style message display. */
export function MediaChannel({ channel, initialMessages, currentUserId, serverId, canSendMessages, requireMediaAttachments }: Props) {
  const isMobile = useMobileLayout()
  const { setActiveServer, setActiveChannel, memberListOpen, toggleMemberList } = useAppStore(
    useShallow((s) => ({ setActiveServer: s.setActiveServer, setActiveChannel: s.setActiveChannel, memberListOpen: s.memberListOpen, toggleMemberList: s.toggleMemberList }))
  )
  const [messages, setMessages] = useState<MessageWithAuthor[]>(initialMessages)
  const [replyTo, setReplyTo] = useState<MessageWithAuthor | null>(null)
  const [draft, setDraftState] = useState(() => getDraft(channel.id))
  const bottomRef = useRef<HTMLDivElement>(null)
  const pendingReactionsRef = useRef(new Set<string>())
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [])

  useEffect(() => {
    setDraftState(getDraft(channel.id))
  }, [channel.id])

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

  async function handleSendMessage(content: string, attachmentFiles?: File[]) {
    if (!canSendMessages) return
    if ((!attachmentFiles || attachmentFiles.length === 0) && requireMediaAttachments) return
    if (!content.trim() && (!attachmentFiles || attachmentFiles.length === 0)) return

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
        content: content.trim() || null,
        reply_to_id: replyTo?.id || null,
      })
      .select(`*, author:users!messages_author_id_fkey(*), attachments(*), reactions(*)`)
      .single()

    if (error) { console.error("Failed to send message:", error); return }

    if (attachments.length > 0 && message) {
      await supabase.from("attachments").insert(attachments.map((a) => ({ ...a, message_id: message.id })))
    }

    setReplyTo(null)
    setDraftState("")
    setDraft(channel.id, "")
  }

  // Separate media messages from text-only messages for a grid-first display
  const mediaMessages = messages.filter((m) => m.attachments.length > 0)

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Channel header — hidden on mobile where ServerMobileLayout provides it */}
      {!isMobile && <div
        className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--theme-bg-tertiary)' }}
      >
        <ImageIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--theme-text-muted)' }} />
        <span className="font-semibold text-white">{channel.name}</span>
        {channel.topic && (
          <>
            <span style={{ color: 'var(--theme-text-faint)' }}>|</span>
            <span className="text-sm truncate" style={{ color: 'var(--theme-text-muted)' }}>{channel.topic}</span>
          </>
        )}
        <div className="ml-auto flex items-center">
          <button
            onClick={toggleMemberList}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title={memberListOpen ? "Hide Member List" : "Show Member List"}
            aria-label={memberListOpen ? "Hide member list" : "Show member list"}
          >
            <Users className="w-5 h-5" style={{ color: memberListOpen ? 'var(--theme-text-primary)' : 'var(--theme-text-muted)' }} />
          </button>
        </div>
      </div>}

      <div className="px-4 py-2 text-xs border-b" style={{ borderColor: "var(--theme-bg-tertiary)", color: "var(--theme-text-muted)" }}>
        Media-first mode: attach at least one file to publish. Add optional captions for context.
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="px-4 py-8">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ background: 'var(--theme-text-faint)' }}
            >
              <ImageIcon className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Welcome to #{channel.name}!</h2>
            <p style={{ color: 'var(--theme-text-secondary)' }}>
              Share images, videos, and files in this media channel.
              {channel.topic && ` ${channel.topic}`}
            </p>
          </div>
        )}

        <div className="pb-4">
          {messages.map((message, i) => {
            const prevMessage = messages[i - 1]
            const isGrouped =
              prevMessage &&
              prevMessage.author_id === message.author_id &&
              new Date(message.created_at).getTime() - new Date(prevMessage.created_at).getTime() < 5 * 60 * 1000

            return (
              <MessageItem
                key={message.id}
                message={message}
                isGrouped={!!isGrouped}
                currentUserId={currentUserId}
                onReply={() => setReplyTo(message)}
                onEdit={async (content) => {
                  const { error } = await supabase.from("messages").update({ content, edited_at: new Date().toISOString() }).eq("id", message.id)
                  if (!error) setMessages((prev) => prev.map((m) => m.id === message.id ? { ...m, content, edited_at: new Date().toISOString() } : m))
                }}
                onDelete={async () => {
                  const { error } = await supabase.from("messages").delete().eq("id", message.id)
                  if (!error) setMessages((prev) => prev.filter((m) => m.id !== message.id))
                }}
                onReaction={async (emoji) => {
                  const mutationKey = `${message.id}:${emoji}:${currentUserId}`
                  if (pendingReactionsRef.current.has(mutationKey)) return

                  const previousMessages = messages
                  const currentMessage = previousMessages.find((m) => m.id === message.id)
                  const previousReactions = currentMessage?.reactions ?? message.reactions
                  const remove = Boolean(currentMessage?.reactions.some((r) => r.user_id === currentUserId && r.emoji === emoji))

                  pendingReactionsRef.current.add(mutationKey)
                  setMessages((prev) => prev.map((m) => {
                    if (m.id !== message.id) return m
                    const hasOwnReaction = m.reactions.some((r) => r.user_id === currentUserId && r.emoji === emoji)
                    return {
                      ...m,
                      reactions: remove
                        ? m.reactions.filter((r) => !(r.user_id === currentUserId && r.emoji === emoji))
                        : hasOwnReaction
                          ? m.reactions
                          : [...m.reactions, { message_id: message.id, user_id: currentUserId, emoji, created_at: new Date().toISOString() }],
                    }
                  }))

                  try {
                    await sendReactionMutation({ messageId: message.id, emoji, remove, nonce: crypto.randomUUID() })
                  } catch (error) {
                    console.error("Failed to update reaction", error)
                    setMessages((prev) =>
                      prev.map((m) => (m.id === message.id ? { ...m, reactions: previousReactions } : m))
                    )
                  } finally {
                    pendingReactionsRef.current.delete(mutationKey)
                  }
                }}
              />
            )
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      {!canSendMessages && (
        <div className="px-4 py-2 text-xs" style={{ color: "var(--theme-warning)" }}>You do not have permission to post in this media channel.</div>
      )}

      {/* Message input */}
      <MessageInput
        channelName={channel.name}
        draft={draft}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSend={handleSendMessage}
        onDraftChange={(newDraft) => {
          setDraftState(newDraft)
          setDraft(channel.id, newDraft)
        }}
      />
    </div>
  )
}
