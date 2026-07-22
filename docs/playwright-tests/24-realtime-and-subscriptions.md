# 24 — Realtime & Supabase Subscriptions

> Covers: Supabase realtime subscriptions for messages, reactions, presence, typing, threads, notifications, DMs.

**Hooks under test:**
- `use-realtime-messages.ts`, `use-realtime-threads.ts`
- `use-supabase-subscription.ts`
- `use-typing.ts`, `use-presence-sync.ts`
- `use-unread-channels.ts`, `use-mark-channel-read.ts`

---

## 24.1 Message Realtime

### `realtime-messages.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should receive new message in real time | User A sends → User B | Message appears without refresh |
| 2 | should receive message edit in real time | User A edits → User B | Edit reflected immediately |
| 3 | should receive message delete in real time | User A deletes → User B | Message removed |
| 4 | should subscribe on channel enter | Navigate to channel | Subscription created |
| 5 | should unsubscribe on channel leave | Navigate away | Subscription cleaned up |
| 6 | should handle subscription reconnect | Simulate disconnect → reconnect | Messages resume |
| 7 | should not duplicate messages on reconnect | Reconnect | No duplicates |
| 8 | should sync new messages across tabs | Open two tabs for User B; User A sends | Message appears in both tabs |

---

## 24.2 Reaction Realtime

### `realtime-reactions.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should receive new reaction in real time | User A reacts → User B sees | Reaction appears |
| 2 | should receive reaction removal in real time | User A removes → User B | Reaction disappears |
| 3 | should update reaction count in real time | Multiple users react | Count updates |
| 4 | should sync reactions across tabs | Open two tabs; react in one | Reaction appears in both |

---

## 24.3 DM Realtime

### `realtime-dm.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should receive DM in real time | User A sends DM → User B | DM appears |
| 2 | should update DM list ordering | New DM received | Conversation moves to top |
| 3 | should show DM notification | Receive DM while not in DM view | Unread indicator |
| 4 | should sync DM reactions in real time | User A reacts in DM → User B | Reaction appears |

---

## 24.4 Typing Realtime

### `realtime-typing.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should broadcast typing event | User types | Typing event emitted |
| 2 | should receive typing indicator | Other user types | "User is typing..." shown |
| 3 | should timeout typing after inactivity | Stop typing | Indicator disappears |
| 4 | should handle multiple concurrent typers | 3 users type | "User1, User2, and User3 are typing..." |
| 5 | should sync typing indicators across tabs | Open two tabs; other user types | Indicator appears in both tabs |

---

## 24.5 Presence Realtime

### `realtime-presence.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should sync online status | User comes online | Green status for others |
| 2 | should sync idle status | User goes idle | Yellow status |
| 3 | should sync offline status | User disconnects | Gray status |
| 4 | should update member list | Status changes | Member list reflects change |
| 5 | should sync presence across tabs | Open two tabs; user changes status | Both tabs update |

---

## 24.6 Thread Realtime

### `realtime-threads.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should receive new thread message | User posts in thread → subscriber | Message appears |
| 2 | should update thread message count | New message in thread | Count updates |
| 3 | should show new thread indicator | Thread created on a message | Indicator appears |

---

## 24.7 Unread Channel Realtime

### `realtime-unread.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should mark channel unread on new message | Receive message in other channel | Unread dot appears |
| 2 | should mark channel read on visit | Click channel | Dot disappears |
| 3 | should count mention unreads | Get @mentioned | "@1" badge |
| 4 | should sync unread state across tabs | Mark read in one tab | Other tab updates |

---

## 24.8 Subscription Lifecycle

### `subscription-lifecycle.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should create subscription on mount | Component mounts | Supabase subscription active |
| 2 | should remove subscription on unmount | Component unmounts | Subscription removed |
| 3 | should handle subscription error | Simulate error | Graceful error handling |
| 4 | should resubscribe on auth token refresh | Token refreshes | Subscription continues |
| 5 | should not leak subscriptions | Navigate 20 channels rapidly | Subscription count stays bounded |
