# Chat message consistency model

## Goals

- Preserve the existing realtime flow while online.
- Allow sending while offline via a local outbox.
- Guarantee idempotent replay after reconnect.
- Surface local delivery state in UI (`queued`, `sending`, `failed`).

## Local outbox protocol

Each locally queued message stores:

- `id`: client-generated UUID (also used as `messages.id` on insert).
- `channelId`, `authorId`, `content`, `replyToId`.
- `createdAt` for replay ordering.
- `status`, `retryCount`, and `lastError`.

Outbox entries are persisted in `localStorage`.

### Replay ordering

Reconnect replay uses deterministic ordering:

1. Oldest `createdAt` first.
2. If timestamps tie, lexical `id` order.

This keeps replay stable and predictable across retries and refreshes.

### Idempotent replay + dedupe IDs

Retries reuse the same client UUID as the final message ID.

- First successful insert creates the message row.
- Duplicate insert attempts fail with a PK conflict (`23505`) and are treated as an acknowledgement-equivalent success.
- Realtime inserts also remove matching outbox entries by ID.

This means replays are safe and do not create duplicate messages.

### Conflict handling strategy

Current conflict policy:

- **Duplicate ID conflict** (`23505`): treat as success and clear outbox entry.
- **Transient/network failure**: mark as `failed` (or `queued` if currently offline), increment retry count, preserve local optimistic copy.
- **User retry action**: pushes failed entry back into replay flow.

Server state is authoritative once a message with the same ID exists.

## Draft persistence

Draft text is stored per-channel in `localStorage` and restored on channel revisit/reload.
Drafts are cleared after successful/queued submit.

## Edge cases

- **Offline with attachments**: not yet queued; user is prompted to reconnect before sending files.
- **Tab refresh while offline**: optimistic unsent text messages are rehydrated from outbox and still shown in timeline.
- **Reconnect race with realtime**: either replay success or realtime insert can clear the same outbox item; both paths are idempotent.
- **Clock skew**: ordering uses local `createdAt`; ties are deterministic by ID.
