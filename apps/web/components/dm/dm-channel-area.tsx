"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, lazy, Suspense, type MutableRefObject } from "react"
import { createPortal } from "react-dom"
import { useRouter, useSearchParams } from "next/navigation"
import { Room, RoomEvent, createLocalAudioTrack, createLocalVideoTrack, type LocalAudioTrack, type LocalVideoTrack, type RemoteParticipant, type RemoteTrack } from "livekit-client"
import { createEqTrackProcessor, type EqTrackProcessor } from "@/lib/voice/eq-track-processor"
import { buildSpatialAudioGraph, type SpatialAudioGraph } from "@/lib/voice/spatial-audio-graph"
import { useVoiceAudioStore } from "@/lib/stores/voice-audio-store"
import { EqSettingsPanel } from "@/components/dm/eq-settings-panel"
import { setActiveDmChannel } from "@/lib/notification-manager"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Phone, Video, Users, Paperclip, Pencil, Trash2, PhoneOff, Mic, MicOff, VideoOff, Search, Pin, Smile, Reply, X, ArrowLeft, Settings, ShieldCheck } from "lucide-react"
import { useLazyEmojiPicker } from "@/hooks/use-lazy-emoji-picker"
import { CustomEmojiGrid } from "@/components/chat/custom-emoji-grid"
import { format } from "date-fns"
import { formatDaySeparator, extractGifUrl, groupReactionsByEmoji } from "@/lib/utils/message-helpers"
import { DaySeparator } from "@/components/chat/day-separator"
import { cn } from "@/lib/utils/cn"
import { useCallMediaToggles } from "@/lib/webrtc/use-call-media-toggles"
import { useDMCall, IncomingCallToast, CallerRingingOverlay } from "@/components/dm/dm-call"
import { ConversationThemePicker } from "@/components/dm/conversation-theme-picker"
import type { DmThemePreset } from "@/lib/dm-theme"
import { useToast } from "@/components/ui/use-toast"
import { useGatewayTyping } from "@/hooks/use-gateway-typing"
import { useGatewayContext } from "@/hooks/use-gateway-context"
import type { VortexEvent } from "@vortex/shared"
import { useAppStore } from "@/lib/stores/app-store"
import { TypingIndicator } from "@/components/chat/typing-indicator"
import { useChatScroll } from "@/components/chat/hooks/use-chat-scroll"
import { MessageInput } from "@/components/chat/message-input"
import { useShallow } from "zustand/react/shallow"
import { decryptDmContent, encryptDmContent, exportPublicKey, fingerprintFromPublicKey, generateConversationKey, generateDeviceKeyPair, importPublicKey, parseEncryptedEnvelope, unwrapConversationKey, wrapConversationKey } from "@/lib/dm-encryption"
import { isValidOlmCiphertext, parseOlmEnvelope, type OlmKeyBundle } from "@/lib/olm-protocol"
import {
  ensureOutboundSession,
  ensureOlmIdentity,
  encryptTo as olmEncryptTo,
  decryptFrom as olmDecryptFrom,
  hasSessionWith,
  saveOwnPlaintext,
  loadOwnPlaintext,
} from "@/lib/olm-protocol-store"
import { useNotificationSound } from "@/hooks/use-notification-sound"
import { useLocalSearch } from "@/hooks/use-local-search"
const DmLocalSearchModal = lazy(() => import("@/components/modals/dm-local-search-modal").then((m) => ({ default: m.DmLocalSearchModal })))
const SearchModal = lazy(() => import("@/components/modals/search-modal").then((m) => ({ default: m.SearchModal })))
const GroupTrustModal = lazy(() => import("@/components/dm/group-trust-modal").then((m) => ({ default: m.GroupTrustModal })))
import type { IndexedDocument } from "@/lib/local-search-index"
import { ChannelRowSkeleton, MessageListSkeleton } from "@/components/ui/skeleton"
import { useMobileLayout } from "@/hooks/use-mobile-layout"
import { useKeyboardAvoidance } from "@/hooks/use-keyboard-avoidance"

interface User {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  status: string
}

interface ReplyToMessage {
  id: string
  content: string | null
  sender_id: string
  sender: User
}

interface DmAttachment {
  id: string
  filename: string
  size: number
  content_type: string
  url?: string
}

interface DmReaction {
  dm_id: string
  user_id: string
  emoji: string
  created_at: string
}

interface Message {
  id: string
  content: string
  created_at: string
  edited_at: string | null
  sender_id: string
  sender: User
  dm_attachments?: DmAttachment[]
  reactions: DmReaction[]
  reply_to_id: string | null
  reply_to: ReplyToMessage | null
}

interface Channel {
  id: string
  name: string | null
  is_group: boolean
  owner_id: string | null
  is_encrypted?: boolean
  encryption_key_version?: number
  encryption_scheme?: "legacy-ecdh" | "olm"
  theme_preset?: string | null
  members: User[]
  partner: User | null
}

interface Props {
  channelId: string
  currentUserId: string
}


// GIF/sticker requests go through the server-side proxy (caching + no client-side API key exposure)

const DM_QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡"]

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

function addEmojiRecent(emoji: string): void {
  if (typeof window === "undefined") return
  try {
    const current = getEmojiRecents().filter((e) => e !== emoji)
    localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify([emoji, ...current].slice(0, EMOJI_RECENTS_MAX)))
  } catch {
    // localStorage unavailable — no-op
  }
}

/** Reusable reaction picker content with recent emojis, search, categories, and skin tone selector. */
function DmReactionPickerContent({ onReaction, onClose, maxHeight, EmojiPicker }: { onReaction: (emoji: string) => void; onClose: () => void; maxHeight?: string; EmojiPicker: NonNullable<ReturnType<typeof import("@/hooks/use-lazy-emoji-picker").useLazyEmojiPicker>["EmojiPicker"]> }) {
  const [recents, setRecents] = useState<string[]>([])
  const [searchActive, setSearchActive] = useState(false)

  useEffect(() => {
    setRecents(getEmojiRecents())
  }, [])

  function handleSelect(emoji: string) {
    addEmojiRecent(emoji)
    setRecents(getEmojiRecents())
    onReaction(emoji)
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
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchActive(e.target.value.length > 0)}
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
                {emoji}
              </button>
            ))}
          </div>
          <div style={{ height: "1px", background: "var(--theme-bg-tertiary)", margin: "6px 0 2px" }} />
        </div>
      )}

      <EmojiPicker.Viewport style={{ flex: 1, overflow: "hidden auto" }}>
        <EmojiPicker.Loading>
          <div style={{ padding: "16px", color: "var(--theme-text-muted)", fontSize: "13px" }}>Loading…</div>
        </EmojiPicker.Loading>
        <EmojiPicker.Empty>
          {({ search }) => (
            <div style={{ padding: "16px", color: "var(--theme-text-muted)", fontSize: "13px" }}>
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

// formatDaySeparator, extractGifUrl, and groupReactionsByEmoji are imported
// from @/lib/utils/message-helpers to share logic with chat-area.tsx

const DEVICE_STORAGE_KEY = "dm-device-key-v1"
const DEVICE_KEY_DB = "vortexchat-e2ee"
const DEVICE_KEY_STORE = "device-private-keys"
const CONVERSATION_KEY_STORE = "conversation-keys"
const registeredDeviceKeys = new Set<string>()

function openDeviceKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DEVICE_KEY_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DEVICE_KEY_STORE)) {
        db.createObjectStore(DEVICE_KEY_STORE)
      }
      if (!db.objectStoreNames.contains(CONVERSATION_KEY_STORE)) {
        db.createObjectStore(CONVERSATION_KEY_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function putDevicePrivateKey(deviceId: string, privateKey: CryptoKey) {
  const db = await openDeviceKeyDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DEVICE_KEY_STORE, "readwrite")
    tx.objectStore(DEVICE_KEY_STORE).put(privateKey, deviceId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function getDevicePrivateKey(deviceId: string): Promise<CryptoKey | null> {
  const db = await openDeviceKeyDb()
  const key = await new Promise<CryptoKey | null>((resolve, reject) => {
    const tx = db.transaction(DEVICE_KEY_STORE, "readonly")
    const req = tx.objectStore(DEVICE_KEY_STORE).get(deviceId)
    req.onsuccess = () => resolve((req.result as CryptoKey | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return key
}

async function putConversationKey(cacheKey: string, keyBytes: Uint8Array) {
  const db = await openDeviceKeyDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CONVERSATION_KEY_STORE, "readwrite")
    tx.objectStore(CONVERSATION_KEY_STORE).put(keyBytes, cacheKey)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function getConversationKey(cacheKey: string): Promise<Uint8Array | null> {
  const db = await openDeviceKeyDb()
  const value = await new Promise<Uint8Array | null>((resolve, reject) => {
    const tx = db.transaction(CONVERSATION_KEY_STORE, "readonly")
    const req = tx.objectStore(CONVERSATION_KEY_STORE).get(cacheKey)
    req.onsuccess = () => {
      const result = req.result
      if (result instanceof Uint8Array) return resolve(result)
      if (result instanceof ArrayBuffer) return resolve(new Uint8Array(result))
      resolve(null)
    }
    req.onerror = () => reject(req.error)
  })
  db.close()
  return value
}

/** Channel-based DM view with message history, file uploads, voice/video calling, typing indicators, and real-time updates. */
export function DMChannelArea({ channelId, currentUserId }: Props) {
  const router = useRouter()
  const [channel, setChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const channelRef = useRef<Channel | null>(null)
  const conversationKeyRef = useRef<Uint8Array | null>(null)
  const [decryptedContent, setDecryptedContent] = useState<Record<string, { text: string; failed: boolean }>>({})
  const decryptedRef = useRef<Record<string, { text: string; failed: boolean }>>({})
  const [conversationKey, setConversationKey] = useState<Uint8Array | null>(null)
  const [deviceFingerprint, setDeviceFingerprint] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [olmDeviceId, setOlmDeviceId] = useState<string | null>(null)
  const [pendingNewMessageCount, setPendingNewMessageCount] = useState(0)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState("")
  const [reactionPickerMsgId, setReactionPickerMsgIdRaw] = useState<string | null>(null)
  const [reactionPickerLoading, setReactionPickerLoading] = useState(false)
  const { EmojiPicker, loadEmojiPicker } = useLazyEmojiPicker()
  const setReactionPickerMsgId = useCallback((v: string | null): void => {
    if (v) {
      setReactionPickerLoading(true)
      void loadEmojiPicker().finally(() => setReactionPickerLoading(false))
    } else {
      setReactionPickerLoading(false)
    }
    setReactionPickerMsgIdRaw(v)
  }, [loadEmojiPicker])
  const [reactionPickerPos, setReactionPickerPos] = useState<{ top: number; left: number } | null>(null)
  const [poppingReactions, setPoppingReactions] = useState<Record<string, Record<string, number>>>({})
  const popTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const reactionCountsRef = useRef<Record<string, Record<string, number>>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const paginationRequestRef = useRef<Promise<unknown> | null>(null) as MutableRefObject<Promise<unknown> | null>
  const isMobileDm = useMobileLayout()
  useKeyboardAvoidance(scrollerRef, isMobileDm, true)

  const prevLastMsgIdRef = useRef<string | null>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const gateway = useGatewayContext()

  // Keep refs in sync so the realtime subscription can read latest values
  // without needing them in its dependency array.
  channelRef.current = channel
  conversationKeyRef.current = conversationKey

  const { toast } = useToast()
  const { currentUser } = useAppStore(
    useShallow((s) => ({ currentUser: s.currentUser }))
  )

  const { playNotification } = useNotificationSound()
  const { indexMessages, addMessage: addMessageToIndex, removeMessage: removeMessageFromIndex, search: searchLocal, clearChannel: clearLocalChannel } = useLocalSearch()
  const [showLocalSearch, setShowLocalSearch] = useState(false)
  // Issue #40 ("Group trust model") — the group's signed membership log +
  // safety-number verification, opened from the header shield button or
  // deep-linked from a "verify_prompt" notification (see
  // notification-bell.tsx's handleClick, which navigates here with
  // ?verify=<otherUserId>).
  const [trustModalOpen, setTrustModalOpen] = useState(false)
  const [trustModalTab, setTrustModalTab] = useState<"log" | "safety">("log")
  const [trustModalOtherUserId, setTrustModalOtherUserId] = useState<string | null>(null)
  const searchParams = useSearchParams()

  useEffect(() => {
    const verifyUserId = searchParams.get("verify")
    if (!verifyUserId) return
    setTrustModalOtherUserId(verifyUserId)
    setTrustModalTab("safety")
    setTrustModalOpen(true)
    router.replace(`/channels/me/${channelId}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  // Track which message IDs have already been fed into the local index so the
  // indexing effect only processes newly-decrypted messages, not the full set.
  const indexedIdsRef = useRef<Set<string>>(new Set())

  const currentDisplayName = currentUser?.display_name || currentUser?.username || "Unknown"

  const { incomingCall, activeCall, ringing, startCall, cancelCall, acceptCall, declineCall, endCall } =
    useDMCall(channelId, currentUserId, currentDisplayName)

  const sendDmPayload = useCallback(async (payload: { content: string; reply_to_id?: string }): Promise<Message | null> => {
    const res = await fetch(`/api/dm/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    const data = await res.json()
    return { ...data, reactions: data.reactions ?? [] }
  }, [channelId])

  const syncDeviceRegistration = useCallback(async (deviceId: string, publicKey: string) => {
    const registrationKey = `${currentUserId}:${deviceId}:${publicKey}`
    if (registeredDeviceKeys.has(registrationKey)) return

    const res = await fetch("/api/dm/keys/device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, publicKey }),
    })
    if (!res.ok) {
      throw new Error("Failed to register device key")
    }

    registeredDeviceKeys.add(registrationKey)
  }, [currentUserId])

  const ensureDeviceIdentity = useCallback(async () => {
    const existing = localStorage.getItem(DEVICE_STORAGE_KEY)
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as { deviceId?: string; publicKey?: string }
        if (typeof parsed.deviceId === "string" && parsed.deviceId && typeof parsed.publicKey === "string" && parsed.publicKey) {
          const privateKey = await getDevicePrivateKey(parsed.deviceId)
          if (privateKey) {
            await syncDeviceRegistration(parsed.deviceId, parsed.publicKey)
            setDeviceId(parsed.deviceId)
            setDeviceFingerprint(await fingerprintFromPublicKey(parsed.publicKey))
            return { deviceId: parsed.deviceId, publicKey: parsed.publicKey, privateKey }
          }
        }
        localStorage.removeItem(DEVICE_STORAGE_KEY)
      } catch {
        localStorage.removeItem(DEVICE_STORAGE_KEY)
      }
    }

    const pair = await generateDeviceKeyPair()
    const publicKey = await exportPublicKey(pair.publicKey)
    const privateKey = pair.privateKey
    const newDeviceId = crypto.randomUUID()

    await putDevicePrivateKey(newDeviceId, privateKey)
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ deviceId: newDeviceId, publicKey }))

    setDeviceId(newDeviceId)
    setDeviceFingerprint(await fingerprintFromPublicKey(publicKey))

    await syncDeviceRegistration(newDeviceId, publicKey)

    return { deviceId: newDeviceId, publicKey, privateKey }
  }, [syncDeviceRegistration])

  const ensureConversationKey = useCallback(async (channelInfo: Channel) => {
    if (!channelInfo?.is_encrypted) {
      setConversationKey(null)
      return null
    }

    const identity = await ensureDeviceIdentity()
    const version = channelInfo.encryption_key_version ?? 1
    const cacheKey = `dm-conversation-key:${channelInfo.id}:${version}`
    const cached = await getConversationKey(cacheKey)
    if (cached) {
      setConversationKey(cached)
      return cached
    }

    const legacyCached = localStorage.getItem(cacheKey)
    if (legacyCached) localStorage.removeItem(cacheKey)

    const keyRes = await fetch(`/api/dm/channels/${channelInfo.id}/keys`)
    if (!keyRes.ok) return null
    const payload = await keyRes.json()
    const privateKey = identity.privateKey

    const existingWrapped = (payload.wrappedKeys ?? []).find((row: { key_version: number; target_device_id: string; sender_public_key: string; wrapped_key: string }) => row.key_version === version && row.target_device_id === identity.deviceId)
    if (existingWrapped) {
      const senderPublic = await importPublicKey(existingWrapped.sender_public_key)
      const unwrapped = await unwrapConversationKey(existingWrapped.wrapped_key, privateKey, senderPublic)
      await putConversationKey(cacheKey, unwrapped)
      setConversationKey(unwrapped)
      return unwrapped
    }

    if (channelInfo.owner_id !== currentUserId) return null

    const nextKey = generateConversationKey()
    const wrappedKeys = await Promise.all((payload.memberDeviceKeys ?? []).map(async (row: { user_id: string; device_id: string; public_key: string }) => ({
      targetUserId: row.user_id,
      targetDeviceId: row.device_id,
      wrappedKey: await wrapConversationKey(nextKey, privateKey, await importPublicKey(row.public_key)),
      wrappedByDeviceId: identity.deviceId,
      senderPublicKey: identity.publicKey,
    })))

    const uploadRes = await fetch(`/api/dm/channels/${channelInfo.id}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyVersion: version, wrappedKeys }),
    })

    if (!uploadRes.ok) {
      throw new Error("Failed to upload wrapped conversation keys")
    }

    await putConversationKey(cacheKey, nextKey)
    setConversationKey(nextKey)
    return nextKey
  }, [currentUserId, ensureDeviceIdentity])

  // Olm identity setup — independent of the legacy-ecdh device
  // above (different keypair, different purpose). Registers this device's
  // Olm identity + prekey bundle with the server the first time it's ever
  // seen; a no-op on every later call.
  const ensureOlmReady = useCallback(async () => {
    const { identity, publish } = await ensureOlmIdentity(currentUserId)
    if (publish) {
      const res = await fetch("/api/dm/olm/keys/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publish),
      })
      if (!res.ok) throw new Error("Failed to register Olm device")
    }
    setOlmDeviceId(identity.deviceId)
    return identity
  }, [currentUserId])

  // Encrypts plaintext for every *other* device across every member of the
  // channel (including the sender's own other devices, so sent messages
  // stay readable from them) — one pairwise Olm session/ciphertext per
  // device, no group ratchet (see issue #3). Devices with no reachable
  // session are skipped rather than failing the whole send, matching how
  // multi-device Signal messaging degrades when one of a user's devices is offline.
  const encryptOlmText = useCallback(async (channelInfo: Channel, plaintext: string): Promise<string> => {
    const identity = await ensureOlmReady()

    const memberIds = channelInfo.members.map((m) => m.id)
    const rosters = await Promise.all(memberIds.map(async (userId) => {
      const res = await fetch(`/api/dm/olm/keys/devices/${userId}`)
      if (!res.ok) return { userId, devices: [] as Array<{ device_id: string }> }
      const data = await res.json()
      return { userId, devices: (data.devices ?? []) as Array<{ device_id: string }> }
    }))

    const targets = rosters.flatMap((r) =>
      r.devices
        .filter((d) => !(r.userId === currentUserId && d.device_id === identity.deviceId))
        .map((d) => ({ userId: r.userId, deviceId: d.device_id }))
    )

    const ciphertexts: Record<string, { type: 0 | 1; body: string }> = {}
    for (const target of targets) {
      try {
        if (!(await hasSessionWith(target))) {
          const claimRes = await fetch("/api/dm/olm/keys/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetUserId: target.userId, targetDeviceId: target.deviceId }),
          })
          if (!claimRes.ok) continue
          const claimed = await claimRes.json()
          const bundle: OlmKeyBundle = {
            curve25519IdentityKey: claimed.curve25519_identity_key,
            ed25519IdentityKey: claimed.ed25519_identity_key,
            keyId: claimed.key_id,
            publicKey: claimed.public_key,
            signature: claimed.signature,
            isFallback: claimed.is_fallback,
          }
          await ensureOutboundSession(target.userId, target.deviceId, bundle)
        }
        const ciphertext = await olmEncryptTo(target.userId, target.deviceId, plaintext)
        ciphertexts[`${target.userId}:${target.deviceId}`] = ciphertext
      } catch (err) {
        // Best-effort per device — one unreachable/untrusted device
        // shouldn't block delivery to the rest.
        console.error(`[olm-protocol] failed to encrypt for ${target.userId}:${target.deviceId}`, err)
      }
    }

    if (Object.keys(ciphertexts).length === 0) {
      throw new Error("No reachable devices to encrypt this message for")
    }

    return JSON.stringify({ kind: "dm-olm", v: 1, senderDeviceId: identity.deviceId, ciphertexts })
  }, [currentUserId, ensureOlmReady])

  const { typingUsers, onKeystroke, onSent } = useGatewayTyping(channelId, currentUserId, currentDisplayName)

  const loadMessages = useCallback(async (before?: string) => {
    if (!before) setLoadError(false)
    const url = `/api/dm/channels/${channelId}` + (before ? `?before=${encodeURIComponent(before)}` : "")
    try {
      const res = await fetch(url)
      if (!res.ok) {
        if (!before) setLoadError(true)
        return
      }
      const data = await res.json()
      setChannel(data.channel)
      if (data.channel?.is_encrypted) {
        if (data.channel.encryption_scheme === "olm") {
          await ensureOlmReady()
        } else {
          await ensureConversationKey(data.channel)
        }
      }
      if (before) {
        setMessages((prev) => [...(data.messages ?? []), ...prev])
      } else {
        setMessages(data.messages ?? [])
      }
      setHasMore(data.has_more)
    } catch {
      if (!before) setLoadError(true)
    }
  }, [channelId, ensureConversationKey, ensureOlmReady])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  // Load older messages — used by both the manual button and the useChatScroll hook
  const loadMore = useCallback(async (): Promise<void> => {
    if (!messages.length || paginationRequestRef.current) return
    setLoadingMore(true)
    const request = loadMessages(messages[0].created_at)
    paginationRequestRef.current = request
    try {
      await request
    } finally {
      paginationRequestRef.current = null
      setLoadingMore(false)
    }
  }, [messages, loadMessages])

  // ── Shared scroll hook (same as channel chat-area.tsx) ───────────────
  const onReachedBottom = useCallback(() => {
    setPendingNewMessageCount(0)
  }, [])

  const { isAtBottom, scrollToBottom } = useChatScroll({
    hasMoreHistory: hasMore,
    loadOlderMessages: loadMore,
    messageScrollerRef: scrollerRef,
    paginationRequestRef,
    onReachedBottom,
  })

  // Scroll to bottom on channel switch.
  // column-reverse: scrollTop=0 is naturally the bottom, so we just
  // ensure scrollTop is 0 when switching channels.
  const shouldScrollToBottomRef = useRef(true)
  const prevChannelIdScrollRef = useRef(channelId)
  useLayoutEffect(() => {
    if (prevChannelIdScrollRef.current !== channelId) {
      shouldScrollToBottomRef.current = true
      prevChannelIdScrollRef.current = channelId
      setPendingNewMessageCount(0)
      prevLastMsgIdRef.current = null
      setReplyTo(null)
    }

    if (!shouldScrollToBottomRef.current) return
    if (messages.length === 0) return
    shouldScrollToBottomRef.current = false

    scrollToBottom()
    prevLastMsgIdRef.current = messages[messages.length - 1]?.id ?? null
  }, [channelId, messages.length, scrollToBottom])

  // Track active DM channel for notification suppression
  useEffect(() => {
    setActiveDmChannel(channelId)
    return () => { setActiveDmChannel(null) }
  }, [channelId])

  // Resync messages when the browser tab regains focus — browsers throttle
  // WebSockets in background tabs so Supabase Realtime can silently drop.
  // Without this, messages received while backgrounded disappear until
  // navigating away and back (#627).
  useEffect(() => {
    const controller = new AbortController()
    let active = true

    const onVisibility = async (): Promise<void> => {
      if (document.hidden) return
      // Kick realtime so it reconnects immediately
      window.dispatchEvent(new CustomEvent("vortex:realtime-retry"))
      try {
        const res = await fetch(`/api/dm/channels/${channelId}`, {
          signal: controller.signal,
        })
        if (!res.ok) return
        const data = await res.json()
        const latest = (data.messages ?? []) as Message[]
        if (latest.length === 0 || !active) return
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id))
          const fresh = latest.filter((m: Message) => !known.has(m.id))
          if (fresh.length === 0) return prev
          // Merge and keep chronological order
          const merged = [...prev, ...fresh].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          )
          return merged
        })
      } catch (e) {
        if (!active || (e instanceof DOMException && e.name === "AbortError")) return
        if (process.env.NODE_ENV !== "production") {
          console.error("DM visibilitychange resync failed", {
            channelId,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      active = false
      controller.abort()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [channelId])

  // Auto-scroll or count new messages from others (same pattern as chat-area.tsx)
  useEffect(() => {
    const newestMsg = messages[messages.length - 1]
    if (!newestMsg) return
    if (prevLastMsgIdRef.current === null || newestMsg.id === prevLastMsgIdRef.current) return
    prevLastMsgIdRef.current = newestMsg.id
    // column-reverse: if at bottom, new messages appear naturally — no scroll needed.
    // Only scroll when the current user sent a message while scrolled up.
    if (newestMsg.sender_id === currentUserId && !isAtBottom) {
      scrollToBottom("smooth")
      setPendingNewMessageCount(0)
    } else if (isAtBottom) {
      setPendingNewMessageCount(0)
    } else {
      setPendingNewMessageCount((c) => c + 1)
    }
  }, [messages, isAtBottom, currentUserId, scrollToBottom])

  // Clears stale decrypted content when the active channel isn't encrypted
  // at all — plaintext channels render msg.content directly and never
  // consult decryptedContent, but a prior encrypted channel may have left
  // entries behind. Both decrypt-path effects below only ever run (and
  // populate this) when channel.is_encrypted is true, so they can't race
  // this reset.
  useEffect(() => {
    if (channel?.is_encrypted) return
    decryptedRef.current = {}
    setDecryptedContent({})
  }, [channel?.id, channel?.is_encrypted])

  // Realtime subscription — legacy-ecdh decrypt path (shared per-channel
  // conversation key; see the Olm effect below for the newer
  // pairwise-per-device scheme).
  useEffect(() => {
    if (!channel?.is_encrypted || channel.encryption_scheme === "olm") return
    if (!conversationKey) {
      decryptedRef.current = {}
      setDecryptedContent({})
      return
    }

    let cancelled = false
    ;(async () => {
      const next = { ...decryptedRef.current }
      let changed = false

      for (const msg of messages) {
        const cached = next[msg.id]
        if (cached && !cached.failed) continue

        const envelope = parseEncryptedEnvelope(msg.content)
        if (!envelope) {
          next[msg.id] = { text: "Unable to decrypt this message", failed: true }
          changed = true
          continue
        }

        try {
          const versionKey = await getConversationKey(`dm-conversation-key:${channel.id}:${envelope.keyVersion}`)
          if (!versionKey) {
            next[msg.id] = { text: "Unable to decrypt this message", failed: true }
          } else {
            next[msg.id] = { text: await decryptDmContent(envelope, versionKey), failed: false }
          }
        } catch {
          next[msg.id] = { text: "Unable to decrypt this message", failed: true }
        }
        changed = true
      }

      if (!changed || cancelled) return
      decryptedRef.current = next
      setDecryptedContent(next)
    })()

    return () => { cancelled = true }
  }, [channel?.id, channel?.is_encrypted, channel?.encryption_scheme, conversationKey, messages])

  // Olm decrypt path — one pairwise Olm session per sender
  // device (see issue #3: no group sender-key ratchet). A message this
  // device itself just sent has no entry for itself in the envelope by
  // design (see encryptOlmText) — handleDmSend seeds decryptedContent
  // for those optimistically, so this effect only ever needs to decrypt
  // messages that actually came from someone else's session.
  useEffect(() => {
    if (!channel?.is_encrypted || channel.encryption_scheme !== "olm") return

    let cancelled = false
    ;(async () => {
      const identity = await ensureOlmReady()
      const next = { ...decryptedRef.current }
      let changed = false

      for (const msg of messages) {
        const cached = next[msg.id]
        if (cached && !cached.failed) continue

        const envelope = parseOlmEnvelope(msg.content)
        if (!envelope) {
          next[msg.id] = { text: "Unable to decrypt this message", failed: true }
          changed = true
          continue
        }

        const mine = envelope.ciphertexts[`${currentUserId}:${identity.deviceId}`]
        if (!mine || !isValidOlmCiphertext(mine)) {
          // Our own sent messages never carry a ciphertext for our own
          // device (see encryptOlmText) — recover the plaintext from the
          // local cache saveOwnPlaintext wrote when we sent it, instead of
          // reporting it as undecryptable.
          const ownPlaintext = msg.sender_id === currentUserId ? await loadOwnPlaintext(msg.id) : null
          next[msg.id] = ownPlaintext !== null
            ? { text: ownPlaintext, failed: false }
            : { text: "Not available on this device", failed: true }
          changed = true
          continue
        }

        try {
          const senderTarget = { userId: msg.sender_id, deviceId: envelope.senderDeviceId }
          let identityHint: { curve25519IdentityKey: string; ed25519IdentityKey: string } | undefined
          if (!(await hasSessionWith(senderTarget))) {
            // Establishing a session with this sender device for the first
            // time — resolve its claimed identity from the directory so
            // it's pinned/verified the same way an outbound contact would
            // be (see olmDecryptFrom's create_inbound_from check), instead
            // of blindly trusting whatever identity the PreKey message
            // itself embeds.
            const dirRes = await fetch(`/api/dm/olm/keys/devices/${msg.sender_id}`)
            if (dirRes.ok) {
              const dir = await dirRes.json()
              const entry = (dir.devices ?? []).find((d: { device_id: string }) => d.device_id === envelope.senderDeviceId)
              if (entry) {
                identityHint = { curve25519IdentityKey: entry.curve25519_identity_key, ed25519IdentityKey: entry.ed25519_identity_key }
              }
            }
          }
          next[msg.id] = { text: await olmDecryptFrom(msg.sender_id, envelope.senderDeviceId, mine, identityHint), failed: false }
        } catch {
          next[msg.id] = { text: "Unable to decrypt this message", failed: true }
        }
        changed = true
      }

      if (!changed || cancelled) return
      decryptedRef.current = next
      setDecryptedContent(next)
    })()

    return () => { cancelled = true }
  }, [channel?.id, channel?.is_encrypted, channel?.encryption_scheme, currentUserId, messages, ensureOlmReady])

  // Reset the indexed-IDs tracker whenever the active channel changes so that
  // the new channel's messages are fully re-indexed from scratch.
  useEffect(() => {
    indexedIdsRef.current = new Set()
  }, [channel?.id])

  // Feed newly-decrypted messages into the local search index incrementally.
  // Only messages whose IDs are not already tracked in indexedIdsRef are
  // added; this prevents the full corpus from being re-submitted on every
  // decryptedContent update.
  useEffect(() => {
    if (!channel?.is_encrypted) return
    const toIndex: IndexedDocument[] = []
    for (const msg of messages) {
      if (indexedIdsRef.current.has(msg.id)) continue
      const dec = decryptedContent[msg.id]
      if (!dec || dec.failed) continue
      toIndex.push({
        id: msg.id,
        channelId: channel.id,
        authorId: msg.sender_id,
        authorName: msg.sender?.display_name || msg.sender?.username || "Unknown",
        avatarUrl: msg.sender?.avatar_url ?? null,
        text: dec.text,
        createdAt: msg.created_at,
      })
      indexedIdsRef.current.add(msg.id)
    }
    if (toIndex.length > 0) indexMessages(channel.id, toIndex)
  }, [channel?.id, channel?.is_encrypted, decryptedContent, messages, indexMessages])

  // Wipe the channel's local index when the user navigates away.
  useEffect(() => {
    return () => {
      clearLocalChannel(channelId)
    }
  }, [channelId, clearLocalChannel])

  // Join the gateway room for this DM channel so message/reaction/typing
  // events for it are delivered to this socket. Deliberately not
  // unsubscribed on unmount: dm-list.tsx and useDmNotificationSound may
  // also be subscribed to this same channel for this socket, and
  // gateway:unsubscribe leaves the room for the whole socket, not just
  // this listener — see the sticky-subscription note in dm-list.tsx.
  useEffect(() => {
    gateway.subscribe([channelId])
  }, [channelId, gateway])

  useEffect(() => {
    const removeListener = gateway.addEventListener(channelId, (event: VortexEvent) => {
      if (event.type !== "message.created") return
      // Only add if it's from someone else (we already added our own optimistically)
      if (event.actorId === currentUserId) return
      const messageId = (event.data as { messageId?: string } | undefined)?.messageId
      if (!messageId) return

      playNotification("dm")
      fetch(`/api/dm/channels/${channelId}/messages/${messageId}`)
        .then(async (res) => {
          if (!res.ok) return
          const data = await res.json() as Record<string, unknown> | null
          if (!data) return
          const newMsg: Message = data as unknown as Message
          setMessages((prev) => prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg])

          // Incrementally index the new message if the channel is encrypted
          // and we can decrypt it.
          if (channelRef.current?.is_encrypted && conversationKeyRef.current) {
            const envelope = parseEncryptedEnvelope(newMsg.content)
            if (envelope) {
              getConversationKey(`dm-conversation-key:${channelId}:${envelope.keyVersion}`)
                .then(async (vk) => {
                  if (!vk) return
                  const text = await decryptDmContent(envelope, vk)
                  addMessageToIndex(channelId, {
                    id: newMsg.id,
                    channelId,
                    authorId: newMsg.sender_id,
                    authorName: newMsg.sender?.display_name || newMsg.sender?.username || "Unknown",
                    avatarUrl: newMsg.sender?.avatar_url ?? null,
                    text,
                    createdAt: newMsg.created_at,
                  })
                })
                .catch(() => {/* best-effort */})
            }
          }
        })
    })

    return () => removeListener()
    // channelRef / conversationKeyRef are used inside the callback so they
    // don't need to be deps – this prevents tearing down and recreating the
    // gateway listener every time encryption state loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, currentUserId, gateway])

  // Gateway subscription for DM reactions
  useEffect(() => {
    const removeListener = gateway.addEventListener(channelId, (event: VortexEvent) => {
      if (event.type === "reaction.added") {
        const r = event.data as DmReaction | undefined
        // Skip our own reactions (already handled optimistically)
        if (!r?.user_id || r.user_id === currentUserId) return
        setMessages((prev) => {
          if (!prev.some((m) => m.id === r.dm_id)) return prev
          return prev.map((m) => {
            if (m.id !== r.dm_id) return m
            if (m.reactions.some((er) => er.dm_id === r.dm_id && er.user_id === r.user_id && er.emoji === r.emoji)) return m
            return { ...m, reactions: [...m.reactions, r] }
          })
        })
      } else if (event.type === "reaction.removed") {
        const r = event.data as DmReaction | undefined
        // Always skip own-user events — own reactions are managed
        // optimistically by handleDmReaction and must not be reverted by
        // a stale or duplicate gateway event.
        if (!r?.user_id || r.user_id === currentUserId) return
        setMessages((prev) => {
          if (!prev.some((m) => m.id === r.dm_id)) return prev
          return prev.map((m) => {
            if (m.id !== r.dm_id) return m
            return { ...m, reactions: m.reactions.filter((er) => !(er.dm_id === r.dm_id && er.user_id === r.user_id && er.emoji === r.emoji)) }
          })
        })
      }
    })

    return () => removeListener()
  }, [channelId, currentUserId, gateway])

  // Reaction chip pop animation — track count changes per message
  useEffect(() => {
    const nextAll: Record<string, Record<string, number>> = {}
    for (const msg of messages) {
      const counts: Record<string, number> = {}
      for (const r of msg.reactions ?? []) {
        counts[r.emoji] = (counts[r.emoji] ?? 0) + 1
      }
      nextAll[msg.id] = counts
    }

    const prev = reactionCountsRef.current
    const pops: Record<string, Record<string, number>> = {}
    for (const msgId of Object.keys(nextAll)) {
      const prevCounts = prev[msgId]
      if (!prevCounts) continue
      const nextCounts = nextAll[msgId]
      for (const emoji of Object.keys(nextCounts)) {
        if (prevCounts[emoji] !== undefined && prevCounts[emoji] !== nextCounts[emoji]) {
          if (!pops[msgId]) pops[msgId] = {}
          pops[msgId][emoji] = (pops[msgId]?.[emoji] ?? 0) + 1
        }
      }
    }

    if (Object.keys(pops).length > 0) {
      setPoppingReactions((current) => {
        const next = { ...current }
        for (const [msgId, emojis] of Object.entries(pops)) {
          next[msgId] = { ...(next[msgId] ?? {}), ...emojis }
          for (const emoji of Object.keys(emojis)) {
            const key = `${msgId}:${emoji}`
            const existing = popTimersRef.current.get(key)
            if (existing) clearTimeout(existing)
            const timer = setTimeout(() => {
              setPoppingReactions((c) => {
                const updated = { ...c }
                if (updated[msgId]) {
                  const { [emoji]: _, ...rest } = updated[msgId]
                  updated[msgId] = rest
                  if (Object.keys(updated[msgId]).length === 0) delete updated[msgId]
                }
                return updated
              })
              popTimersRef.current.delete(key)
            }, 180)
            popTimersRef.current.set(key, timer)
          }
        }
        return next
      })
    }

    reactionCountsRef.current = nextAll
  }, [messages])

  // Close reaction picker on outside click or Escape
  useEffect(() => {
    if (!reactionPickerMsgId) return
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement
      if (target.closest?.("[data-dm-reaction-picker-portal]")) return
      setReactionPickerMsgId(null)
      setReactionPickerPos(null)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { setReactionPickerMsgId(null); setReactionPickerPos(null) }
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [reactionPickerMsgId])

  // Unified send handler matching MessageInput's full onSend signature.
  // Handles text, GIF URLs, and file attachments with optional encryption.
  const handleDmSend = useCallback(async (
    text: string,
    files?: File[],
    onUploadProgress?: (percent: number) => void,
    abortSignal?: AbortSignal,
  ): Promise<void> => {
    if (!text.trim() && (!files || files.length === 0)) return

    const encryptText = async (plaintext: string): Promise<string> => {
      if (!channel?.is_encrypted) return plaintext
      if (channel.encryption_scheme === "olm") return encryptOlmText(channel, plaintext)
      const key = conversationKey ?? await ensureConversationKey(channel)
      if (!key) throw new Error("Missing encryption key")
      return JSON.stringify(await encryptDmContent(plaintext, key, channel.encryption_key_version ?? 1))
    }

    // Olm has no shared symmetric channel key the sender could
    // use to decrypt their own just-sent message, and by design the
    // envelope carries no ciphertext entry for the sending device itself
    // (see encryptOlmText) — seed the local decrypted-content cache
    // directly with the plaintext we already have in hand instead of
    // routing it through the decrypt effect. Also persisted to IndexedDB
    // (saveOwnPlaintext) since decryptedContent is in-memory only and would
    // otherwise be unrecoverable after a reload (see the Olm decrypt effect,
    // which falls back to loadOwnPlaintext for our own messages).
    const seedOwnPlaintext = (id: string, plaintext: string) => {
      if (channel?.is_encrypted && channel.encryption_scheme === "olm") {
        decryptedRef.current = { ...decryptedRef.current, [id]: { text: plaintext, failed: false } }
        setDecryptedContent(decryptedRef.current)
        saveOwnPlaintext(id, plaintext).catch(() => {})
      }
    }

    // Handle file attachments (each sent as a separate message)
    if (files && files.length > 0) {
      const totalFiles = files.length
      for (let i = 0; i < totalFiles; i++) {
        if (abortSignal?.aborted) throw new Error("Upload cancelled")
        const file = files[i]

        const uploadFormData = new FormData()
        uploadFormData.append("file", file)
        const uploadRes = await fetch(`/api/dm/channels/${channelId}/attachments`, {
          method: "POST",
          body: uploadFormData,
          signal: abortSignal,
        })
        if (!uploadRes.ok) throw new Error("File upload failed")
        if (abortSignal?.aborted) throw new Error("Upload cancelled")
        const uploaded = await uploadRes.json() as { key: string; filename: string; size: number; content_type: string }

        // Best-effort cleanup for the file just uploaded above if anything
        // afterward fails — otherwise it's an orphan nothing ever purges
        // (the decay cron only ever looks at rows in dm_attachments).
        const cleanupUploadedFile = () => {
          fetch(`/api/dm/channels/${channelId}/attachments?key=${encodeURIComponent(uploaded.key)}`, { method: "DELETE" }).catch(() => {})
        }

        onUploadProgress?.(Math.round(((i + 0.5) / totalFiles) * 100))

        try {
          const captionPlaintext = `📎 ${file.name}`
          const outbound = await encryptText(captionPlaintext)
          const filePayload: { content: string; reply_to_id?: string } = { content: outbound }
          // Attach reply context to the first file message
          if (i === 0 && replyTo) filePayload.reply_to_id = replyTo.id
          const msg = await sendDmPayload(filePayload)
          if (!msg) throw new Error("Failed to send file")
          seedOwnPlaintext(msg.id, captionPlaintext)

          const attachRes = await fetch(`/api/dm/channels/${channelId}/attachments`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dm_id: msg.id,
              key: uploaded.key,
              filename: file.name,
              size: file.size,
              content_type: file.type || "application/octet-stream",
            }),
          })
          if (!attachRes.ok) {
            console.error("[dm file upload] failed to save attachment metadata:", await attachRes.text().catch(() => attachRes.statusText))
            cleanupUploadedFile()
            // Metadata write failed — don't leave a message behind that claims an
            // attachment ("📎 filename") but has no attachment metadata to back it.
            await handleDelete(msg.id)
            throw new Error("Failed to save attachment metadata")
          }
          const insertedAtt = await attachRes.json() as { id: string; filename: string; size: number; content_type: string }
          setMessages((prev) => [...prev, {
            ...msg,
            dm_attachments: [{ id: insertedAtt.id, filename: insertedAtt.filename, size: insertedAtt.size, content_type: insertedAtt.content_type }],
          }])
        } catch (err) {
          cleanupUploadedFile()
          throw err
        }
        onUploadProgress?.(Math.round(((i + 1) / totalFiles) * 100))
      }
    }

    // Send composed text if present (runs even when files were uploaded)
    if (text.trim()) {
      if (abortSignal?.aborted) throw new Error("Cancelled")
      const outbound = await encryptText(text)
      const payload: { content: string; reply_to_id?: string } = { content: outbound }
      // Attach reply context to text (unless already attached to first file above)
      if (replyTo && (!files || files.length === 0)) payload.reply_to_id = replyTo.id
      const msg = await sendDmPayload(payload)
      if (!msg) throw new Error("Failed to send message")
      seedOwnPlaintext(msg.id, text)
      setMessages((prev) => [...prev, msg])
    }

    setReplyTo(null)
  }, [channelId, channel, conversationKey, ensureConversationKey, encryptOlmText, replyTo, sendDmPayload])

  async function handleEditSave(messageId: string) {
    if (!editContent.trim()) return
    if (channel?.is_encrypted) {
      toast({ variant: "destructive", title: "Editing encrypted messages is currently disabled" })
      setEditingId(null)
      return
    }

    const res = await fetch(`/api/dm/channels/${channelId}/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editContent.trim() }),
    })
    if (res.ok) {
      setMessages((prev) =>
        prev.map((m) => m.id === messageId ? { ...m, content: editContent.trim(), edited_at: new Date().toISOString() } : m)
      )
    } else {
      toast({ variant: "destructive", title: "Failed to edit message" })
    }
    setEditingId(null)
  }

  async function handleDelete(messageId: string) {
    const res = await fetch(`/api/dm/channels/${channelId}/messages/${messageId}`, { method: "DELETE" })
    if (res.ok) {
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
      removeMessageFromIndex(messageId)
      indexedIdsRef.current.delete(messageId)
    } else {
      toast({ variant: "destructive", title: "Failed to delete message" })
    }
  }

  async function handleDmReaction(messageId: string, emoji: string): Promise<void> {
    navigator.vibrate?.(6)
    addEmojiRecent(emoji)
    const msg = messages.find((m) => m.id === messageId)
    if (!msg) return
    const existing = msg.reactions.find((r) => r.user_id === currentUserId && r.emoji === emoji)
    const remove = Boolean(existing)

    // Optimistic update
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m
        return {
          ...m,
          reactions: remove
            ? m.reactions.filter((r) => !(r.user_id === currentUserId && r.emoji === emoji))
            : [...m.reactions, { dm_id: messageId, user_id: currentUserId, emoji, created_at: new Date().toISOString() }],
        }
      })
    )

    try {
      const res = await fetch(`/api/dm/channels/${channelId}/messages/${messageId}/reactions`, {
        method: remove ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji, nonce: crypto.randomUUID() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        console.error("[dm reaction toggle] API error:", { messageId, emoji, action: remove ? "remove" : "add", status: res.status, error: body?.error })
        // Revert optimistic update
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m
            return {
              ...m,
              reactions: remove
                ? [...m.reactions, { dm_id: messageId, user_id: currentUserId, emoji, created_at: new Date().toISOString() }]
                : m.reactions.filter((r) => !(r.user_id === currentUserId && r.emoji === emoji)),
            }
          })
        )
      }
    } catch (err) {
      console.error("[dm reaction toggle] network error:", { messageId, emoji, action: remove ? "remove" : "add", error: err })
      // Revert on network error
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m
          return {
            ...m,
            reactions: remove
              ? [...m.reactions, { dm_id: messageId, user_id: currentUserId, emoji, created_at: new Date().toISOString() }]
              : m.reactions.filter((r) => !(r.user_id === currentUserId && r.emoji === emoji)),
          }
        })
      )
    }
  }

  function startVoiceCall() {
    startCall(false, currentUser?.avatar_url ?? null)
  }

  function startVideoCall() {
    startCall(true, currentUser?.avatar_url ?? null)
  }

  function handleSearchClick() {
    if (channel?.is_encrypted) {
      setShowLocalSearch(true)
      return
    }
    setShowLocalSearch(true)
  }

  const handleSearchJumpToMessage = useCallback((_cid: string, mid: string) => {
    setShowLocalSearch(false)
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-message-id="${mid}"]`)
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" })
        return
      }
      if (hasMore) {
        toast({ title: "Loading history…", description: "Fetching older messages to find this one." })
        loadMore().then(() => {
          requestAnimationFrame(() => {
            const elRetry = document.querySelector(`[data-message-id="${mid}"]`)
            if (elRetry) {
              elRetry.scrollIntoView({ behavior: "smooth", block: "center" })
            } else {
              toast({ title: "Message not in current view", description: "Keep loading older messages to find it." })
              topRef.current?.scrollIntoView({ behavior: "smooth" })
            }
          })
        })
      } else {
        toast({ title: "Message not found", description: `Message ${mid} is not in the current view.` })
      }
    })
  }, [hasMore, loadMore, toast])

  function handlePinClick() {
    toast({ title: "Pinned messages coming soon", description: "Pin browsing will be available in a future update." })
  }

  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ background: "var(--app-bg-primary)" }}>
        <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Failed to load conversation.</p>
        <button
          onClick={() => loadMessages()}
          className="px-4 py-2 rounded text-sm font-medium"
          style={{ background: "var(--theme-accent)", color: "white" }}
        >
          Retry
        </button>
      </div>
    )
  }

  if (!channel) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--app-bg-primary)" }}>
        {/* Header skeleton */}
        <div className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
          <ChannelRowSkeleton className="flex-1 border-0 px-0 py-0" />
        </div>
        {/* Message list skeleton */}
        <MessageListSkeleton count={8} className="flex-1 px-0 py-2" />
      </div>
    )
  }

  const displayName = channel.is_group
    ? (channel.name || channel.members.map((m) => m.display_name || m.username).join(", "))
    : (channel.partner?.display_name || channel.partner?.username || "Unknown")
  const partnerInitials = displayName.slice(0, 2).toUpperCase()

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden"
      style={{ background: "var(--app-bg-primary)" }}
      data-theme-preset={channel.theme_preset ?? undefined}
    >
      {/* Header */}
      <div className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
        {/* Mobile: back arrow to DM list. Desktop: hidden (sidebar always visible). */}
        <button
          type="button"
          className="md:hidden w-8 h-8 flex items-center justify-center rounded-md transition-colors hover:bg-white/10 active:bg-white/15"
          style={{ color: "var(--theme-text-secondary)" }}
          onClick={() => router.push("/channels/me")}
          aria-label="Back to messages"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        {channel.is_group ? (
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--theme-accent)" }}>
            <Users className="w-4 h-4 text-white" />
          </div>
        ) : (
          <Avatar className="w-8 h-8">
            {channel.partner?.avatar_url && <AvatarImage src={channel.partner.avatar_url} />}
            <AvatarFallback style={{ background: "var(--theme-accent)", color: "white", fontSize: "12px" }}>
              {partnerInitials}
            </AvatarFallback>
          </Avatar>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm md:text-base text-white truncate">{displayName}</div>
          {channel.is_encrypted && (
            <div className="text-xs truncate" style={{ color: "var(--theme-text-muted)" }}>
              {channel.encryption_scheme === "olm"
                ? <>End-to-end encrypted (Olm) • Device {olmDeviceId ? olmDeviceId.slice(0, 8) : "verifying…"}</>
                : <>End-to-end encrypted • Device fingerprint: {deviceFingerprint ?? "verifying…"}</>}
            </div>
          )}
        </div>

        <button
          className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-md hover:bg-white/10 active:bg-white/15 transition-colors"
          style={{ color: "var(--theme-text-secondary)" }}
          title="Search in conversation"
          aria-label="Search in conversation"
          type="button"
          onClick={handleSearchClick}
        >
          <Search className="w-4 h-4 md:w-[18px] md:h-[18px]" />
        </button>
        <button
          className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-md hover:bg-white/10 active:bg-white/15 transition-colors"
          style={{ color: "var(--theme-text-secondary)" }}
          title="Pinned messages"
          aria-label="Pinned messages"
          type="button"
          onClick={handlePinClick}
        >
          <Pin className="w-4 h-4 md:w-[18px] md:h-[18px]" />
        </button>
        {channel.is_group && (
          <button
            className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-md hover:bg-white/10 active:bg-white/15 transition-colors"
            style={{ color: "var(--theme-text-secondary)" }}
            title="Group trust & safety"
            aria-label="Group trust & safety"
            type="button"
            onClick={() => { setTrustModalTab("log"); setTrustModalOtherUserId(null); setTrustModalOpen(true) }}
          >
            <ShieldCheck className="w-4 h-4 md:w-[18px] md:h-[18px]" />
          </button>
        )}
        <ConversationThemePicker
          channelId={channelId}
          themePreset={channel.theme_preset}
          onThemeChange={(next) => setChannel((prev) => (prev ? { ...prev, theme_preset: next } : prev))}
        />

        {/* Call buttons — available for both 1:1 and group conversations */}
        <button
          onClick={startVoiceCall}
          className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-md hover:bg-white/10 active:bg-white/15 transition-colors"
          style={{ color: (activeCall && !activeCall.withVideo) ? "var(--theme-success)" : "var(--theme-text-secondary)" }}
          title="Start voice call"
          aria-label="Start voice call"
          disabled={!!activeCall || !!ringing}
        >
          <Phone className="w-4 h-4 md:w-[18px] md:h-[18px]" />
        </button>
        <button
          onClick={startVideoCall}
          className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-md hover:bg-white/10 active:bg-white/15 transition-colors"
          style={{ color: (activeCall?.withVideo) ? "var(--theme-success)" : "var(--theme-text-secondary)" }}
          title="Start video call"
          aria-label="Start video call"
          disabled={!!activeCall || !!ringing}
        >
          <Video className="w-4 h-4 md:w-[18px] md:h-[18px]" />
        </button>
      </div>

      {/* Caller ringing overlay — shown while waiting for callee to accept */}
      {ringing && !activeCall && (
        <CallerRingingOverlay
          partnerName={displayName}
          partnerAvatar={channel.partner?.avatar_url ?? null}
          withVideo={ringing.withVideo}
          onCancel={cancelCall}
        />
      )}

      {/* Active call overlay */}
      {activeCall && (
        <DMCallView
          channelId={channelId}
          currentUserId={currentUserId}
          participants={channel.members.filter((m) => m.id !== currentUserId)}
          displayName={displayName}
          withVideo={activeCall.withVideo}
          onHangup={endCall}
        />
      )}

      {/* Incoming call toast — shown when another user rings this DM */}
      {incomingCall && !activeCall && (
        <IncomingCallToast
          call={incomingCall}
          onAccept={acceptCall}
          onDecline={declineCall}
        />
      )}

      {/* Messages */}
      {/* Scroll container: column-reverse (scrollTop=0 = newest messages) */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4" style={{ display: "flex", flexDirection: "column-reverse", overflowAnchor: "none", overscrollBehaviorY: "contain" }}>
        <div className="space-y-1">
        {/* Load more */}
        {hasMore && (
          <div className="flex justify-center pb-2">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="text-xs px-3 py-1 rounded transition-colors hover:bg-white/10"
              style={{ color: "var(--theme-text-muted)" }}
            >
              {loadingMore ? "Loading…" : "Load older messages"}
            </button>
          </div>
        )}
        <div ref={topRef} />

        {/* Welcome message */}
        {!hasMore && messages.length === 0 && (
          <div className="text-center py-16">
            {channel.is_group ? (
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "var(--theme-accent)" }}>
                <Users className="w-10 h-10 text-white" />
              </div>
            ) : (
              <Avatar className="w-20 h-20 mx-auto mb-4">
                {channel.partner?.avatar_url && <AvatarImage src={channel.partner.avatar_url} />}
                <AvatarFallback style={{ background: "var(--theme-accent)", color: "white", fontSize: "28px" }}>
                  {partnerInitials}
                </AvatarFallback>
              </Avatar>
            )}
            <h2 className="text-2xl font-bold text-white mb-1">{displayName}</h2>
            <p style={{ color: "var(--theme-text-secondary)" }} className="text-sm">
              {channel.is_group
                ? `Welcome to your group DM with ${channel.members.length} members.`
                : `This is the beginning of your DM with ${displayName}.`}
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          const prev = messages[i - 1]
          const msgDate = new Date(msg.created_at)
          const prevDate = prev ? new Date(prev.created_at) : null
          const showDaySeparator = !prevDate || msgDate.toDateString() !== prevDate.toDateString()
          const isGrouped = prev &&
            prev.sender_id === msg.sender_id &&
            !msg.reply_to_id &&
            !showDaySeparator &&
            new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000
          const isOwn = msg.sender_id === currentUserId
          const senderName = msg.sender?.display_name || msg.sender?.username || "Unknown"
          const senderInitials = senderName.slice(0, 2).toUpperCase()
          const isEditing = editingId === msg.id

          // Group reactions by emoji (shared utility)
          const reactionEntries = groupReactionsByEmoji(msg.reactions ?? [], currentUserId)

          const renderedContent = channel.is_encrypted ? (decryptedContent[msg.id]?.text ?? "Decrypting…") : msg.content
          const decryptFailed = channel.is_encrypted ? Boolean(decryptedContent[msg.id]?.failed) : false

          // Prefer structured dm_attachments (proxy URL, never expires) over
          // markdown-embedded signed URLs (expire after 7 days).
          const dbAttachments = msg.dm_attachments ?? []
          const hasDbAttachments = dbAttachments.length > 0

          // Render file attachments inline (markdown-style links) — fallback
          // for messages created before dm_attachments were tracked.
          const attachmentMatch = !hasDbAttachments
            ? renderedContent?.match(/^\[(.+)\]\((https?:\/\/.+)\)$/)
            : null
          const isImageAttachment = attachmentMatch
            ? /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(attachmentMatch[1])
            : false
          const isVideoAttachment = attachmentMatch
            ? /\.(mp4|webm|mov|ogg)$/i.test(attachmentMatch[1])
            : false
          // Detect standalone GIF URLs (Klipy/Giphy) for inline rendering
          const gifMediaUrl = extractGifUrl(renderedContent)

          return (
            <div key={msg.id}>
              {/* Date separator */}
              {showDaySeparator && <DaySeparator date={msgDate} />}
            <div data-message-id={msg.id} className={cn("group hover:bg-white/[0.02] rounded px-1 -mx-1", isGrouped ? "pl-11" : "")}>
              {/* Reply reference */}
              {msg.reply_to_id && msg.reply_to && (
                <div
                  className="flex items-center gap-2 mb-0.5 ml-11 text-xs rounded px-1 py-0.5"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  <Reply className="w-3 h-3 -scale-x-100 flex-shrink-0" />
                  <span className="font-medium" style={{ color: "var(--theme-text-secondary)" }}>
                    {msg.reply_to.sender?.display_name || msg.reply_to.sender?.username || "Unknown"}
                  </span>
                  <span className="truncate">
                    {channel.is_encrypted
                      ? (decryptedContent[msg.reply_to.id]?.text ?? "Encrypted message")
                      : (msg.reply_to.content ?? "Message deleted")}
                  </span>
                </div>
              )}

              <div className="flex items-start gap-3">
                {!isGrouped && (
                  <Avatar className="w-8 h-8 flex-shrink-0 mt-0.5">
                    {msg.sender?.avatar_url && <AvatarImage src={msg.sender.avatar_url} />}
                    <AvatarFallback style={{ background: "var(--theme-accent)", color: "white", fontSize: "12px" }}>
                      {senderInitials}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className="min-w-0 flex-1">
                  {!isGrouped && (
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-sm font-semibold" style={{ color: isOwn ? "var(--theme-link)" : "var(--theme-text-bright)" }}>
                        {isOwn ? "You" : senderName}
                      </span>
                      <span className="text-xs" style={{ color: "var(--theme-text-faint)" }}>
                        {format(new Date(msg.created_at), "h:mm a")}
                      </span>
                    </div>
                  )}
                  {isEditing ? (
                    <div className="flex gap-2 items-center">
                      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                      <input
                        autoFocus
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) handleEditSave(msg.id)
                          if (e.key === "Escape") setEditingId(null)
                        }}
                        aria-label="Edit message"
                        className="flex-1 bg-transparent border-b text-sm focus:outline-none"
                        style={{ color: "var(--theme-text-normal)", borderColor: "var(--theme-accent)" }}
                      />
                      <button type="button" onClick={() => handleEditSave(msg.id)} className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--theme-accent)", color: "white" }}>Save</button>
                      <button type="button" onClick={() => setEditingId(null)} className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Cancel</button>
                    </div>
                  ) : hasDbAttachments ? (
                    <div className="mt-1 space-y-1">
                      {dbAttachments.map((att) => {
                        const proxyUrl = att.id.startsWith("local-") && att.url ? att.url : `/api/dm/attachments/${att.id}/download`
                        const isImg = att.content_type?.startsWith("image/")
                        const isVid = att.content_type?.startsWith("video/")
                        const isAud = att.content_type?.startsWith("audio/")

                        if (isImg) {
                          return (
                            <div key={att.id} className="max-w-sm" data-img-wrapper>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={proxyUrl}
                                alt={att.filename}
                                loading="lazy"
                                className="rounded object-contain cursor-pointer"
                                style={{ maxWidth: "100%", maxHeight: "20rem", background: "var(--theme-bg-tertiary)" }}
                                onError={(e) => {
                                  const el = e.target as HTMLImageElement
                                  el.style.display = "none"
                                  const fallback = el.closest("[data-img-wrapper]")?.querySelector("[data-fallback]")
                                  if (fallback) (fallback as HTMLElement).style.display = "flex"
                                }}
                              />
                              <div
                                data-fallback
                                className="hidden items-center gap-2 px-3 py-2 rounded border text-sm"
                                style={{ borderColor: "var(--theme-bg-tertiary)", background: "var(--theme-bg-secondary)", color: "var(--theme-text-secondary)" }}
                              >
                                <Paperclip className="w-4 h-4 flex-shrink-0" />
                                <a href={proxyUrl} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">
                                  {att.filename}
                                </a>
                                <span className="text-xs flex-shrink-0" style={{ color: "var(--theme-text-muted)" }}>
                                  {(att.size / 1024).toFixed(1)} KB
                                </span>
                              </div>
                            </div>
                          )
                        }

                        if (isVid) {
                          return (
                            <div key={att.id} className="max-w-lg rounded overflow-hidden" style={{ background: "var(--theme-bg-tertiary)" }}>
                              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                              <video src={proxyUrl} controls preload="metadata" className="rounded max-h-80 w-full" aria-label={att.filename} />
                              <div className="flex items-center gap-2 px-3 py-1.5">
                                <span className="text-xs truncate" style={{ color: "var(--theme-text-muted)" }}>{att.filename}</span>
                                <span className="text-xs flex-shrink-0" style={{ color: "var(--theme-text-muted)" }}>{(att.size / 1024).toFixed(1)} KB</span>
                              </div>
                            </div>
                          )
                        }

                        if (isAud) {
                          return (
                            <div key={att.id} className="max-w-sm rounded p-3 space-y-2" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: "var(--theme-accent)" }}>
                                  <span className="text-[10px] font-bold" style={{ color: "var(--theme-text-bright)" }}>
                                    {att.filename.split(".").pop()?.toUpperCase().slice(0, 4)}
                                  </span>
                                </div>
                                <span className="text-sm font-medium truncate" style={{ color: "var(--theme-text-bright)" }}>{att.filename}</span>
                                <span className="text-xs flex-shrink-0" style={{ color: "var(--theme-text-muted)" }}>{(att.size / 1024).toFixed(1)} KB</span>
                              </div>
                              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                              <audio src={proxyUrl} controls preload="metadata" className="w-full h-8" aria-label={att.filename} />
                            </div>
                          )
                        }

                        return (
                          <a
                            key={att.id}
                            href={proxyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 p-3 rounded max-w-sm"
                            style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
                          >
                            <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0" style={{ background: "var(--theme-accent)" }}>
                              <span className="text-xs font-bold" style={{ color: "var(--theme-text-bright)" }}>
                                {att.filename.split(".").pop()?.toUpperCase().slice(0, 4)}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate" style={{ color: "var(--theme-text-bright)" }}>{att.filename}</div>
                              <div className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{(att.size / 1024).toFixed(1)} KB</div>
                            </div>
                          </a>
                        )
                      })}
                    </div>
                  ) : attachmentMatch && isImageAttachment ? (
                    <div className="mt-1" data-img-wrapper>
                      <a href={attachmentMatch[2]} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={attachmentMatch[2]}
                          alt={attachmentMatch[1]}
                          className="max-w-xs max-h-60 rounded object-contain cursor-pointer"
                          loading="lazy"
                          onError={(e) => {
                            const el = e.target as HTMLImageElement
                            el.style.display = "none"
                            const fallback = el.closest("[data-img-wrapper]")?.querySelector("[data-fallback]")
                            if (fallback) (fallback as HTMLElement).style.display = "flex"
                          }}
                        />
                      </a>
                      <div
                        data-fallback
                        className="hidden items-center gap-2 px-3 py-2 rounded border text-sm"
                        style={{ borderColor: "var(--theme-bg-tertiary)", background: "var(--theme-bg-secondary)", color: "var(--theme-text-secondary)" }}
                      >
                        <Paperclip className="w-4 h-4 flex-shrink-0" />
                        <a href={attachmentMatch[2]} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">
                          {attachmentMatch[1]}
                        </a>
                      </div>
                    </div>
                  ) : attachmentMatch && isVideoAttachment ? (
                    <div className="mt-1">
                      <video
                        src={attachmentMatch[2]}
                        controls
                        preload="metadata"
                        className="max-w-xs max-h-60 rounded"
                      />
                      <span className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{attachmentMatch[1]}</span>
                    </div>
                  ) : attachmentMatch ? (
                    <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded border text-sm"
                      style={{ borderColor: "var(--theme-bg-tertiary)", background: "var(--theme-bg-secondary)" }}
                    >
                      <Paperclip className="w-4 h-4 flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />
                      <a
                        href={attachmentMatch[2]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline truncate"
                        style={{ color: "var(--theme-link)" }}
                      >
                        {attachmentMatch[1]}
                      </a>
                    </div>
                  ) : gifMediaUrl ? (
                    <div className="mt-1">
                      <img
                        src={gifMediaUrl}
                        alt="GIF"
                        className="max-w-sm w-full rounded-md border"
                        style={{ borderColor: "var(--theme-bg-tertiary)", background: "var(--theme-bg-tertiary)" }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                      />
                    </div>
                  ) : (
                    <p className="text-sm break-words" style={{ color: decryptFailed ? "var(--theme-warning)" : "var(--theme-text-normal)" }}>
                      {renderedContent}
                    </p>
                  )}
                  {msg.edited_at && !isEditing && (
                    <span className="text-xs" style={{ color: "var(--theme-text-faint)" }}> (edited)</span>
                  )}
                </div>
                {/* Hover actions */}
                {!isEditing && (
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 flex-shrink-0 transition-opacity">
                    {/* Reaction button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        if (reactionPickerMsgId === msg.id) {
                          setReactionPickerMsgId(null)
                          setReactionPickerPos(null)
                        } else if (window.matchMedia("(pointer: coarse)").matches) {
                          // Mobile: open bottom sheet directly (no position needed)
                          setReactionPickerPos(null)
                          setReactionPickerMsgId(msg.id)
                          navigator.vibrate?.(10)
                        } else {
                          const rect = e.currentTarget.getBoundingClientRect()
                          const pickerW = 320
                          const pickerH = 400
                          const gap = 4
                          let top = rect.top - pickerH - gap
                          if (top < 8) top = rect.bottom + gap
                          if (top + pickerH > window.innerHeight - 8) top = window.innerHeight - pickerH - 8
                          let left = rect.right - pickerW
                          if (left < 8) left = 8
                          if (left + pickerW > window.innerWidth - 8) left = window.innerWidth - pickerW - 8
                          setReactionPickerPos({ top, left })
                          setReactionPickerMsgId(msg.id)
                        }
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10"
                      style={{ color: reactionPickerMsgId === msg.id ? "var(--theme-accent)" : "var(--theme-text-muted)" }}
                      title="Add Reaction"
                      aria-label="Add reaction"
                    >
                      <Smile className="w-3.5 h-3.5" />
                    </button>
                    {/* Reply button — available for all messages */}
                    <button
                      type="button"
                      onClick={() => { setReplyTo(msg) }}
                      className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10"
                      style={{ color: "var(--theme-text-muted)" }}
                      title="Reply"
                      aria-label="Reply"
                    >
                      <Reply className="w-3.5 h-3.5 -scale-x-100" />
                    </button>
                    {isOwn && !channel.is_encrypted && (
                      <>
                        <button
                          type="button"
                          onClick={() => { setEditingId(msg.id); setEditContent(renderedContent) }}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10"
                          style={{ color: "var(--theme-text-muted)" }}
                          title="Edit"
                          aria-label="Edit message"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(msg.id)}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-500/20"
                          style={{ color: "var(--theme-text-muted)" }}
                          title="Delete"
                          aria-label="Delete message"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {/* Reactions display */}
              {reactionEntries.length > 0 && (
                <div className={cn("flex flex-wrap gap-1 mt-1", isGrouped ? "pl-0" : "ml-11")}>
                  {reactionEntries.map(([emoji, { count, hasOwn, users }]) => (
                    <button
                      key={`${emoji}-${poppingReactions[msg.id]?.[emoji] ?? 0}`}
                      onClick={() => handleDmReaction(msg.id, emoji)}
                      title={users.map((id) => id === currentUserId ? "You" : (channel.members.find((m) => m.id === id)?.display_name || channel.members.find((m) => m.id === id)?.username || "Unknown")).join(", ")}
                      className={cn("motion-interactive motion-press flex items-center gap-1 px-2 py-0.5 rounded-full text-sm hover:-translate-y-px", poppingReactions[msg.id]?.[emoji] && "reaction-chip-pop")}
                      aria-label={`Toggle ${emoji} reaction`}
                      style={{
                        background: hasOwn ? "rgba(88,101,242,0.3)" : "rgba(255,255,255,0.06)",
                        border: `1px solid ${hasOwn ? "var(--theme-accent)" : "transparent"}`,
                        color: "var(--theme-text-normal)",
                      }}
                    >
                      {emoji} {count}
                    </button>
                  ))}
                </div>
              )}
              {/* Desktop: positioned reaction emoji picker */}
              {reactionPickerMsgId === msg.id && reactionPickerPos && createPortal(
                <div
                  data-dm-reaction-picker-portal
                  onClick={(e) => { if (e.target === e.currentTarget) { setReactionPickerMsgId(null); setReactionPickerPos(null) } }}
                  className="hidden md:block fixed z-[9999]"
                  style={{ top: reactionPickerPos.top, left: reactionPickerPos.left }}
                >
                  <div
                    className="rounded-lg shadow-xl overflow-hidden"
                    style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
                  >
                    {EmojiPicker ? (
                      <DmReactionPickerContent
                        onReaction={(emoji) => { handleDmReaction(msg.id, emoji); setReactionPickerMsgId(null); setReactionPickerPos(null) }}
                        onClose={() => { setReactionPickerMsgId(null); setReactionPickerPos(null) }}
                        EmojiPicker={EmojiPicker}
                      />
                    ) : (
                      <div className="flex items-center justify-center p-6 text-sm" style={{ color: "var(--theme-text-muted)", minWidth: 200, minHeight: 100 }}>
                        {reactionPickerLoading ? "Loading reactions\u2026" : "Couldn\u2019t load reactions."}
                      </div>
                    )}
                  </div>
                </div>,
                document.body,
              )}
              {/* Mobile: reaction emoji picker as bottom sheet (only when desktop positioned picker is not active) */}
              {reactionPickerMsgId === msg.id && !reactionPickerPos && createPortal(
                <div
                  data-dm-reaction-picker-portal
                  className="md:hidden fixed inset-0 z-[9999] flex flex-col justify-end"
                  onClick={(e) => { if (e.target === e.currentTarget) { setReactionPickerMsgId(null); setReactionPickerPos(null) } }}
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
                      {DM_QUICK_REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => { handleDmReaction(msg.id, emoji); setReactionPickerMsgId(null); setReactionPickerPos(null) }}
                          className="w-11 h-11 flex items-center justify-center rounded-full text-xl active:scale-90 transition-transform"
                          style={{ background: "var(--theme-bg-tertiary)" }}
                          aria-label={`React with ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    {EmojiPicker ? (
                      <DmReactionPickerContent
                        onReaction={(emoji) => { handleDmReaction(msg.id, emoji); setReactionPickerMsgId(null); setReactionPickerPos(null) }}
                        onClose={() => { setReactionPickerMsgId(null); setReactionPickerPos(null) }}
                        maxHeight="calc(70vh - 100px)"
                        EmojiPicker={EmojiPicker}
                      />
                    ) : (
                      <div className="flex items-center justify-center p-6 text-sm" style={{ color: "var(--theme-text-muted)" }}>
                        {reactionPickerLoading ? "Loading reactions\u2026" : "Couldn\u2019t load reactions."}
                      </div>
                    )}
                  </div>
                </div>,
                document.body,
              )}
            </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
        </div>{/* end inner wrapper */}
        {!isAtBottom && (
          <div className="sticky bottom-0 flex justify-center pointer-events-none pb-3">
            <button
              onClick={() => { scrollToBottom("smooth"); setPendingNewMessageCount(0) }}
              className="motion-interactive motion-press px-4 py-1.5 rounded-full text-xs font-semibold shadow-lg flex items-center gap-1.5 pointer-events-auto"
              style={{ background: "var(--theme-accent)", color: "white" }}
              aria-label={pendingNewMessageCount > 0 ? `Jump to latest — ${pendingNewMessageCount} new message${pendingNewMessageCount !== 1 ? "s" : ""}` : "Jump to latest message"}
            >
              ↓ {pendingNewMessageCount > 0 ? `${pendingNewMessageCount} new message${pendingNewMessageCount !== 1 ? "s" : ""}` : "Jump to latest"}
            </button>
          </div>
        )}
      </div>

      {/* Typing indicator */}
      <TypingIndicator users={typingUsers.map((user) => user.displayName)} />

      {/* Input — hidden during active/ringing calls */}
      {/* Input — hidden during active/ringing calls */}
      {!activeCall && !ringing && (
        <MessageInput
          key={channelId}
          variant="dm"
          channelName={displayName}
          draft=""
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={handleDmSend}
          onDraftChange={() => {}}
          onTyping={onKeystroke}
          onSent={onSent}
        />
      )}

      {/* Local search modal for encrypted DM channels */}
      {showLocalSearch && channel?.is_encrypted && (
        <Suspense fallback={null}>
        <DmLocalSearchModal
          channelId={channel.id}
          channelLabel={displayName}
          onClose={() => setShowLocalSearch(false)}
          onJumpToMessage={handleSearchJumpToMessage}
          searchFn={searchLocal}
          indexedCount={Object.values(decryptedContent).filter((d) => !d.failed).length}
        />
        </Suspense>
      )}

      {/* Server-side search modal for non-encrypted DM channels */}
      {showLocalSearch && channel && !channel.is_encrypted && (
        <Suspense fallback={null}>
          <SearchModal
            dmChannelId={channel.id}
            dmChannelLabel={displayName}
            onClose={() => setShowLocalSearch(false)}
            onJumpToMessage={handleSearchJumpToMessage}
          />
        </Suspense>
      )}

      {/* Issue #40: group trust log + safety-number verification */}
      {trustModalOpen && channel && (
        <Suspense fallback={null}>
          <GroupTrustModal
            open={trustModalOpen}
            onClose={() => { setTrustModalOpen(false); setTrustModalOtherUserId(null) }}
            channelId={channel.id}
            currentUserId={currentUserId}
            members={channel.members}
            initialTab={trustModalTab}
            initialOtherUserId={trustModalOtherUserId}
          />
        </Suspense>
      )}
    </div>
  )
}

// ─── DM Call View ───────────────────────────────────────────────────────────
//
// LiveKit SFU: a single Room.connect() to a room scoped to this DM channel
// (`dm-{channelId}`), authorized by a short-lived AccessToken minted by
// /api/dm/channels/[channelId]/call/token after a membership check. Remote
// media arrives via TrackSubscribed/TrackUnsubscribed events, keyed by each
// participant's identity (== their user id, per the token's `identity`
// claim) — Room.remoteParticipants replaces the old per-peer Map.

interface CallProps {
  channelId: string
  currentUserId: string
  /** Every other member of this DM/group conversation. */
  participants: User[]
  displayName: string
  withVideo: boolean
  onHangup: () => void
}

function DMCallView({ channelId, currentUserId, participants, displayName, withVideo, onHangup }: CallProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const roomRef = useRef<Room | null>(null)
  const localAudioTrackRef = useRef<LocalAudioTrack | null>(null)
  const localVideoTrackRef = useRef<LocalVideoTrack | null>(null)
  const intentionalDisconnectRef = useRef(false)
  const eqProcessorRef = useRef<EqTrackProcessor | null>(null)
  const eqButtonRef = useRef<HTMLButtonElement>(null)
  const spatialAudioContextRef = useRef<AudioContext | null>(null)
  const spatialGraphsRef = useRef<Record<string, SpatialAudioGraph>>({})
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const [status, setStatus] = useState<"connecting" | "connected" | "failed">("connecting")
  const [failReason, setFailReason] = useState("")
  const [showEqPanel, setShowEqPanel] = useState(false)
  const isGroupCall = participants.length > 1
  const spatialAudioEnabled = useVoiceAudioStore(
    (state) => state.getEffectiveSettings(currentUserId).spatialAudioEnabled
  )
  const participantMixes = useVoiceAudioStore((state) => state.participantMixByServer[channelId] ?? {})
  const getParticipantMix = useVoiceAudioStore((state) => state.getParticipantMix)

  const statusMeta: Record<typeof status, { label: string; detail: string; tone: string; bg: string }> = {
    connecting: {
      label: "Connecting",
      detail: withVideo ? `Setting up video with ${displayName}` : `Reaching ${displayName}`,
      tone: "var(--theme-text-secondary)",
      bg: "rgba(181,186,193,0.18)",
    },
    connected: {
      label: "Live",
      detail: withVideo ? "Video and audio are flowing" : "Voice is stable",
      tone: "#9ae6b4",
      bg: "rgba(35,165,90,0.2)",
    },
    failed: {
      label: "Couldn’t connect",
      detail: failReason || "Try again in a moment.",
      tone: "#ffd58a",
      bg: "rgba(240,177,50,0.2)",
    },
  }
  const [muted, setMuted] = useState(false)
  const [videoOff, setVideoOff] = useState(false)

  useEffect(() => {
    let mounted = true

    const room = new Room()
    roomRef.current = room
    intentionalDisconnectRef.current = false

    function addRemoteTrack(track: RemoteTrack, participant: RemoteParticipant): void {
      setRemoteStreams((prev) => {
        const stream = prev[participant.identity] ?? new MediaStream()
        stream.addTrack(track.mediaStreamTrack)
        return { ...prev, [participant.identity]: stream }
      })
      setStatus("connected")
    }

    function removeRemoteTrack(track: RemoteTrack, participant: RemoteParticipant): void {
      setRemoteStreams((prev) => {
        const stream = prev[participant.identity]
        if (!stream) return prev
        stream.removeTrack(track.mediaStreamTrack)
        return { ...prev, [participant.identity]: stream }
      })
    }

    function removeParticipant(participant: RemoteParticipant): void {
      setRemoteStreams((prev) => {
        if (!(participant.identity in prev)) return prev
        const next = { ...prev }
        delete next[participant.identity]
        return next
      })
      // 1:1 calls end entirely when the only other party leaves. Group
      // calls keep going for whoever's left — the local user hangs up
      // explicitly when they're done.
      if (!isGroupCall && room.remoteParticipants.size === 0) onHangup()
    }

    room
      .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => addRemoteTrack(track, participant))
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => removeRemoteTrack(track, participant))
      .on(RoomEvent.ParticipantDisconnected, removeParticipant)
      .on(RoomEvent.Disconnected, () => {
        if (!mounted || intentionalDisconnectRef.current) return
        setStatus((prev) => (prev === "connected" ? "failed" : prev))
      })

    async function connect(): Promise<void> {
      try {
        const res = await fetch(`/api/dm/channels/${channelId}/call/token`, { method: "POST" })
        if (!res.ok) throw new Error(`token-fetch-failed:${res.status}`)
        const { token, url } = (await res.json()) as { token: string; url: string }
        if (!mounted) return

        await room.connect(url, token)
        if (!mounted) { await room.disconnect(); return }

        const audioTrack = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true })
        if (!mounted) { audioTrack.stop(); return }
        localAudioTrackRef.current = audioTrack
        await room.localParticipant.publishTrack(audioTrack)

        const audioSettings = useVoiceAudioStore.getState().getEffectiveSettings(currentUserId)
        const eqProcessor = createEqTrackProcessor(audioSettings)
        eqProcessorRef.current = eqProcessor
        await audioTrack.setProcessor(eqProcessor)

        if (withVideo) {
          const videoTrack = await createLocalVideoTrack()
          if (!mounted) { videoTrack.stop(); return }
          localVideoTrackRef.current = videoTrack
          await room.localParticipant.publishTrack(videoTrack)
          if (localVideoRef.current) videoTrack.attach(localVideoRef.current)
        }
      } catch (err: unknown) {
        if (!mounted) return
        setStatus("failed")
        const errName = err instanceof DOMException ? err.name : ""
        if (errName === "NotAllowedError") {
          setFailReason("Permission denied. Allow microphone" + (withVideo ? " and camera" : "") + " access and retry.")
        } else if (errName === "NotFoundError") {
          setFailReason("No " + (withVideo ? "camera or " : "") + "microphone found.")
        } else {
          setFailReason("Could not connect to the call.")
        }
      }
    }
    connect()

    return () => {
      mounted = false
      intentionalDisconnectRef.current = true
      localAudioTrackRef.current?.stop()
      localVideoTrackRef.current?.stop()
      localAudioTrackRef.current = null
      localVideoTrackRef.current = null
      eqProcessorRef.current = null
      room.disconnect()
      roomRef.current = null
    }
  // participants intentionally omitted — the member list is fixed for the lifetime of a call
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, currentUserId, withVideo, isGroupCall])

  // Spatial audio: only meaningful once there's more than one remote voice to
  // tell apart, so it's scoped to group calls. Builds a gain/pan graph per
  // participant into a shared AudioContext, keyed off the remoteStreams that
  // TrackSubscribed/TrackUnsubscribed already maintain.
  useEffect(() => {
    if (!isGroupCall || !spatialAudioEnabled) {
      Object.values(spatialGraphsRef.current).forEach((graph) => graph.cleanup())
      spatialGraphsRef.current = {}
      if (spatialAudioContextRef.current) {
        spatialAudioContextRef.current.close().catch(() => {})
        spatialAudioContextRef.current = null
      }
      return
    }

    const AudioCtx =
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return

    const audioContext = spatialAudioContextRef.current ?? new AudioCtx()
    spatialAudioContextRef.current = audioContext
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {})

    for (const participantId of Object.keys(spatialGraphsRef.current)) {
      if (!(participantId in remoteStreams)) {
        spatialGraphsRef.current[participantId].cleanup()
        delete spatialGraphsRef.current[participantId]
      }
    }

    for (const [participantId, stream] of Object.entries(remoteStreams)) {
      const mix = getParticipantMix(channelId, participantId)
      const existing = spatialGraphsRef.current[participantId]
      if (existing) {
        existing.updateMix(mix)
      } else if (stream.getAudioTracks().length > 0) {
        spatialGraphsRef.current[participantId] = buildSpatialAudioGraph(audioContext, stream, mix)
      }
    }
  }, [isGroupCall, spatialAudioEnabled, remoteStreams, participantMixes, channelId, getParticipantMix])

  // Belt-and-suspenders teardown on unmount — the effect above already tears
  // down on isGroupCall/spatialAudioEnabled flipping, but not on unmount itself.
  useEffect(() => {
    return () => {
      Object.values(spatialGraphsRef.current).forEach((graph) => graph.cleanup())
      spatialGraphsRef.current = {}
      if (spatialAudioContextRef.current) {
        spatialAudioContextRef.current.close().catch(() => {})
        spatialAudioContextRef.current = null
      }
    }
  }, [])

  const { toggleMute, toggleVideo } = useCallMediaToggles({
    muted,
    videoOff,
    setMuted,
    setVideoOff,
    onToggleMute: (isMuted) => {
      if (isMuted) localAudioTrackRef.current?.unmute()
      else localAudioTrackRef.current?.mute()
    },
    onToggleVideo: (isVideoOff) => {
      if (isVideoOff) localVideoTrackRef.current?.unmute()
      else localVideoTrackRef.current?.mute()
    },
  })

  async function hangup() {
    intentionalDisconnectRef.current = true
    if (roomRef.current) {
      await roomRef.current.disconnect()
      roomRef.current = null
    }
    onHangup()
  }

  const connectedCount = Object.keys(remoteStreams).length

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center p-4" style={{ background: "var(--theme-bg-tertiary)" }}>
      {!isGroupCall ? (
        // ── 1:1 layout — unchanged from the original single-peer UI ──────
        <>
          <audio ref={(el) => { if (el) el.srcObject = remoteStreams[participants[0]?.id ?? ""] ?? null }} autoPlay playsInline />
          {withVideo ? (
            <div className="relative w-full max-w-2xl aspect-video rounded-xl overflow-hidden bg-black">
              <video
                ref={(el) => { if (el) el.srcObject = remoteStreams[participants[0]?.id ?? ""] ?? null }}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute bottom-3 right-3 w-32 rounded-lg border-2 object-cover"
                style={{ borderColor: "var(--theme-accent)", transform: "scaleX(-1)" }}
              />
              {status === "connecting" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: "rgba(0,0,0,0.6)" }}>
                  <div className="w-6 h-6 rounded-full motion-spinner" aria-label="Connecting…" />
                  <p className="text-white text-sm">{statusMeta.connecting.detail}…</p>
                </div>
              )}
              {status === "failed" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
                  <p className="text-white font-medium">{statusMeta.failed.label}</p>
                  <p className="text-sm text-center" style={{ color: "var(--theme-text-secondary)" }}>{statusMeta.failed.detail}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 pb-8">
              <div
                className={cn(
                  "w-32 h-32 rounded-full flex items-center justify-center overflow-hidden",
                  status === "connected" ? "ring-4 ring-green-500/80" : "ring-2 ring-[var(--theme-text-faint)]/60"
                )}
                style={{ background: "var(--theme-accent)", transition: "box-shadow 240ms ease" }}
              >
                {participants[0]?.avatar_url ? (
                  <img src={participants[0].avatar_url} alt={`${displayName}'s avatar`} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white font-bold text-4xl">{displayName.slice(0, 2).toUpperCase()}</span>
                )}
              </div>
              <p className="text-white font-semibold text-lg">{displayName}</p>
              <div className="text-sm px-3 py-1 rounded-full" style={{ color: statusMeta[status].tone, background: statusMeta[status].bg }}>
                <span className="font-medium">{statusMeta[status].label}</span>
                <span className="ml-2" style={{ color: "var(--theme-text-secondary)" }}>{statusMeta[status].detail}</span>
              </div>
              {status === "connecting" && (
                <div className="flex items-center gap-2 text-xs" style={{ color: "var(--theme-text-muted)" }}>
                  <div className="w-3.5 h-3.5 rounded-full motion-spinner-sm" aria-label="Connecting…" />
                  Establishing secure media link…
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        // ── Group layout — a tile per participant, full-mesh ──────────────
        <div className="w-full max-w-3xl flex flex-col items-center gap-3">
          <div className="text-sm px-3 py-1 rounded-full mb-1" style={{ color: statusMeta[status].tone, background: statusMeta[status].bg }}>
            <span className="font-medium">{connectedCount}/{participants.length} connected</span>
          </div>
          <div className="w-full grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(participants.length, 3)}, minmax(0, 1fr))` }}>
            {participants.map((participant) => (
              <GroupCallTile
                key={participant.id}
                participant={participant}
                stream={remoteStreams[participant.id] ?? null}
                withVideo={withVideo}
                channelId={channelId}
                spatialAudioEnabled={spatialAudioEnabled}
              />
            ))}
          </div>
          {withVideo && (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-32 rounded-lg border-2 object-cover self-end"
              style={{ borderColor: "var(--theme-accent)", transform: "scaleX(-1)" }}
            />
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-4 mt-6">
        <button
          onClick={toggleMute}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-colors"
          style={{ background: muted ? "var(--theme-danger)" : "var(--theme-text-faint)" }}
          title={muted ? "Unmute" : "Mute"}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
        </button>
        <div className="relative">
          <button
            ref={eqButtonRef}
            onClick={() => setShowEqPanel((prev) => !prev)}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-colors"
            style={{ background: showEqPanel ? "var(--theme-accent)" : "var(--theme-text-faint)" }}
            title="Voice settings"
            aria-label="Voice settings"
          >
            <Settings className="w-5 h-5 text-white" />
          </button>
          {showEqPanel && (
            <EqSettingsPanel
              userId={currentUserId}
              onClose={() => setShowEqPanel(false)}
              anchorRef={eqButtonRef}
              processorRef={eqProcessorRef}
            />
          )}
        </div>
        {withVideo && (
          <button
            onClick={toggleVideo}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-colors"
            style={{ background: videoOff ? "var(--theme-danger)" : "var(--theme-text-faint)" }}
            title={videoOff ? "Turn on camera" : "Turn off camera"}
            aria-label={videoOff ? "Turn on camera" : "Turn off camera"}
          >
            {videoOff ? <VideoOff className="w-5 h-5 text-white" /> : <Video className="w-5 h-5 text-white" />}
          </button>
        )}
        <button
          onClick={hangup}
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: "var(--theme-danger)" }}
          title="Hang up"
          aria-label="Hang up"
        >
          <PhoneOff className="w-5 h-5 text-white" />
        </button>
      </div>
    </div>
  )
}

/** One participant's tile in a group call grid — video, or an avatar placeholder while audio-only/connecting. */
function GroupCallTile({
  participant,
  stream,
  withVideo,
  channelId,
  spatialAudioEnabled,
}: {
  participant: User
  stream: MediaStream | null
  withVideo: boolean
  channelId: string
  spatialAudioEnabled: boolean
}) {
  const name = participant.display_name || participant.username
  const connected = !!stream
  const mix = useVoiceAudioStore((state) => state.getParticipantMix(channelId, participant.id))
  const setParticipantVolume = useVoiceAudioStore((state) => state.setParticipantVolume)
  const setParticipantPan = useVoiceAudioStore((state) => state.setParticipantPan)

  // When spatial audio is routing this participant's stream through its own
  // gain/pan graph into the call's AudioContext, mute the raw element so its
  // audio doesn't also play unprocessed and double up.
  return (
    <div
      className="relative rounded-xl overflow-hidden flex flex-col items-center justify-center aspect-video"
      style={{ background: "var(--theme-bg-secondary)", border: connected ? "1px solid var(--theme-success)" : "1px solid var(--theme-bg-tertiary)" }}
    >
      {withVideo && (
        <video
          ref={(el) => { if (el) { el.srcObject = stream; el.muted = spatialAudioEnabled } }}
          autoPlay
          playsInline
          className={cn("absolute inset-0 w-full h-full object-cover", !connected && "hidden")}
        />
      )}
      {!withVideo && (
        <audio ref={(el) => { if (el) { el.srcObject = stream; el.muted = spatialAudioEnabled } }} autoPlay playsInline />
      )}
      {(!withVideo || !connected) && (
        <div className="flex flex-col items-center gap-2 p-3">
          <div className="w-14 h-14 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0" style={{ background: "var(--theme-accent)" }}>
            {participant.avatar_url ? (
              <img src={participant.avatar_url} alt={`${name}'s avatar`} className="w-full h-full object-cover" />
            ) : (
              <span className="text-white font-bold text-lg">{name.slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          <span className="text-xs font-medium truncate max-w-full" style={{ color: "var(--theme-text-primary)" }}>{name}</span>
          {!connected && (
            <span className="text-[10px]" style={{ color: "var(--theme-text-muted)" }}>Connecting…</span>
          )}
        </div>
      )}
      {spatialAudioEnabled && connected && (
        <div
          className="absolute bottom-1 left-1 right-1 flex flex-col gap-0.5 px-2 py-1 rounded-md"
          style={{ background: "rgba(0,0,0,0.55)" }}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] w-6 shrink-0" style={{ color: "var(--theme-text-secondary)" }}>Vol</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={mix.volume}
              onChange={(event) => setParticipantVolume(channelId, participant.id, Number(event.target.value))}
              aria-label={`${name} volume`}
              className="w-full h-3"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] w-6 shrink-0" style={{ color: "var(--theme-text-secondary)" }}>Pan</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={mix.pan ?? 0}
              onChange={(event) => setParticipantPan(channelId, participant.id, Number(event.target.value))}
              aria-label={`${name} pan`}
              className="w-full h-3"
            />
          </div>
        </div>
      )}
    </div>
  )
}
