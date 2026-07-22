"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import type { DirectMessageRow, UserRow } from "@/types/database"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Send, AtSign } from "lucide-react"
import { format } from "date-fns"

interface Props {
  partner: UserRow
  currentUserId: string
  initialMessages: DirectMessageRow[]
}

/** Legacy 1-on-1 DM view with real-time message subscription. Superseded by DMChannelArea for channel-based DMs. */
export function DMArea({ partner, currentUserId, initialMessages }: Props) {
  const [messages, setMessages] = useState<DirectMessageRow[]>(initialMessages)
  const [content, setContent] = useState("")
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const subIdRef = useRef(0)

  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [messages.length])

  useEffect(() => {
    // Subscribe to new DMs
    const subId = ++subIdRef.current
    const channel = supabase
      .channel(`dm:${currentUserId}:${partner.id}:${subId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
          filter: `receiver_id=eq.${currentUserId}`,
        },
        (payload) => {
          const msg = payload.new as DirectMessageRow
          if (msg.sender_id === partner.id) {
            setMessages((prev) => [...prev, msg])
          }
        }
      )
      .subscribe()

    // Mark messages as read
    supabase
      .from("direct_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("receiver_id", currentUserId)
      .eq("sender_id", partner.id)
      .is("read_at", null)
      .then()

    return () => { supabase.removeChannel(channel) }
  }, [currentUserId, partner.id])

  async function handleSend() {
    if (!content.trim() || sending) return
    setSending(true)
    try {
      const { data, error } = await supabase
        .from("direct_messages")
        .insert({
          sender_id: currentUserId,
          receiver_id: partner.id,
          content: content.trim(),
        })
        .select()
        .single()

      if (error) throw error
      setMessages((prev) => [...prev, data])
      setContent("")
    } catch (e) {
      console.error("Failed to send DM:", e)
    } finally {
      setSending(false)
    }
  }

  const partnerName = partner.display_name || partner.username
  const partnerInitials = partnerName.slice(0, 2).toUpperCase()

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: "var(--app-bg-primary)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--theme-bg-tertiary)" }}
      >
        <Avatar className="w-8 h-8">
          {partner.avatar_url && <AvatarImage src={partner.avatar_url} />}
          <AvatarFallback style={{ background: "var(--theme-accent)", color: "white", fontSize: "12px" }}>
            {partnerInitials}
          </AvatarFallback>
        </Avatar>
        <div>
          <span className="font-semibold text-white">{partnerName}</span>
          {partner.status_message && (
            <div className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{partner.status_message}</div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1" role="log" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && (
          <div className="text-center py-16">
            <Avatar className="w-20 h-20 mx-auto mb-4">
              {partner.avatar_url && <AvatarImage src={partner.avatar_url} />}
              <AvatarFallback style={{ background: "var(--theme-accent)", color: "white", fontSize: "28px" }}>
                {partnerInitials}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-2xl font-bold text-white mb-1">{partnerName}</h2>
            <p style={{ color: "var(--theme-text-secondary)" }} className="text-sm">
              This is the beginning of your direct message history with <strong>{partnerName}</strong>.
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          const isOwn = msg.sender_id === currentUserId
          const prev = messages[i - 1]
          const isGrouped = prev && prev.sender_id === msg.sender_id &&
            new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000

          return (
            <div key={msg.id} className={`flex items-start gap-3 ${isGrouped ? "pl-11" : ""}`}>
              {!isGrouped && (
                <Avatar className="w-8 h-8 flex-shrink-0 mt-0.5">
                  {isOwn ? null : (partner.avatar_url && <AvatarImage src={partner.avatar_url} />)}
                  <AvatarFallback style={{ background: isOwn ? "var(--theme-accent)" : "var(--theme-bg-secondary)", color: "var(--theme-text-bright)", fontSize: "12px" }}>
                    {isOwn ? "ME" : partnerInitials}
                  </AvatarFallback>
                </Avatar>
              )}
              <div className="min-w-0">
                {!isGrouped && (
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-white">
                      {isOwn ? "You" : partnerName}
                    </span>
                    <span className="text-xs" style={{ color: "var(--theme-text-faint)" }}>
                      {format(new Date(msg.created_at), "h:mm a")}
                    </span>
                  </div>
                )}
                <p className="text-sm break-words" style={{ color: "var(--theme-text-normal)" }}>
                  {msg.content}
                </p>
                {msg.edited_at && (
                  <span className="text-xs" style={{ color: "var(--theme-text-faint)" }}> (edited)</span>
                )}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 flex-shrink-0">
        <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--theme-surface-input)" }}>
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={`Message @${partnerName}`}
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: "var(--theme-text-normal)" }}
          />
          {content.trim() && (
            <button
              onClick={handleSend}
              disabled={sending}
              style={{ color: "var(--theme-accent)" }}
              aria-label="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
