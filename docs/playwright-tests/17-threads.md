# 17 — Threads

> Covers: thread creation, thread messaging, thread panel, thread list, thread auto-archive, thread members, thread counts.

**Components under test:**
- `thread-panel.tsx`, `thread-list.tsx`, `create-thread-modal.tsx`
- API: `/api/threads`, `/api/threads/[threadId]`, `/api/threads/[threadId]/messages`
- API: `/api/threads/[threadId]/members`, `/api/threads/counts`
- Cron: `/api/cron/thread-auto-archive`

---

## 17.1 Thread Creation

### `thread-create.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should create thread from message | Right-click message → Create Thread | Create thread modal opens |
| 2 | should set thread name | Enter name → create | Thread created with name |
| 3 | should set auto-archive duration | Select duration (1h, 24h, 3d, 1w) | Duration saved |
| 4 | should open thread panel after creation | Create thread | Thread panel opens on right |
| 5 | should show thread indicator on parent message | Create thread | Parent message shows "Thread" link |
| 6 | should create standalone thread | Click "Create Thread" button | Thread created without parent message |
| 7 | should require CREATE_PUBLIC_THREADS or CREATE_PRIVATE_THREADS | Login without permission | Create option hidden |

---

## 17.2 Thread Messaging

### `thread-messages.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should send message in thread | Open thread → type → send | Message appears in thread |
| 2 | should show messages in real time | User A sends in thread → User B sees | Realtime update |
| 3 | should show date separators in threads | Messages across days | Date separators shown |
| 4 | should show thread message count | Send messages | Count updates |
| 5 | should support reactions in threads | React to thread message | Reaction shown |
| 6 | should support editing thread messages | Edit message in thread | "(edited)" shown |
| 7 | should support deleting thread messages | Delete message in thread | Message removed |
| 8 | should support file attachments in threads | Upload file | File attached |

---

## 17.3 Thread Panel

### `thread-panel.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open thread panel | Click thread on message | Panel opens on right side |
| 2 | should close thread panel | Click X | Panel closes |
| 3 | should show thread title | View panel | Thread name in header |
| 4 | should show parent message | View panel | Original message shown at top |
| 5 | should scroll to load older messages | Scroll up | Older messages load |
| 6 | should show thread members | View panel | Member count/list |

---

## 17.4 Thread List

### `thread-list.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show all threads in channel | Open thread list | All threads listed |
| 2 | should show active threads | View list | Active threads visible |
| 3 | should show archived threads | Toggle archived | Archived threads shown |
| 4 | should show thread preview | View list | Thread name + last message preview |
| 5 | should navigate to thread on click | Click thread | Thread panel opens |
| 6 | should show thread counts | View channel | Thread count shown |

---

## 17.5 Thread Auto-Archive

### `thread-auto-archive.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should auto-archive after inactivity | Use fake clock → advance past configured duration → trigger cron handler | Thread archived |
| 2 | should support 1h duration | Set 1h → advance clock 61 min → invoke `/api/cron/thread-auto-archive` | Archived after 1h |
| 3 | should support 24h duration | Set 24h → advance clock 25h → invoke cron | Archived after 24h |
| 4 | should support 3d duration | Set 3d → advance clock 73h → invoke cron | Archived after 3 days |
| 5 | should support 1w duration | Set 1w → advance clock 8d → invoke cron | Archived after 1 week |
| 6 | should auto-unarchive on new message | Send message to archived thread | Thread unarchived |
| 7 | should change archive duration | Thread panel → change duration | Duration updated |
| 8 | should run via Vercel cron every 5 min | Invoke cron handler directly via API call | Cron processes correctly (verify via `vercel.json` schedule config) |

---

## 17.6 Thread Members

### `thread-members.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should auto-add poster to thread members | Post in thread | User added to thread members |
| 2 | should show thread member list | View thread → members | Members listed |
| 3 | should join thread | Click "Join Thread" | Added to members |
| 4 | should leave thread | Click "Leave Thread" | Removed from members |
| 5 | should notify thread members on new message | New message in thread | Members notified |
