# Local Search for Encrypted Channels

## Overview

VortexChat's server-side full-text search (`/api/search`) works against the
`messages` table in PostgreSQL.  Because DMs that are end-to-end encrypted
(E2EE) store only opaque AES-GCM ciphertext, the server has nothing to search.

This document describes the **client-side local search index** that fills that
gap, the architectural decisions made, and the tradeoffs involved.

---

## Architecture

### Components

| File | Role |
|------|------|
| `apps/web/lib/local-search-index.ts` | Pure-TS in-memory inverted index (no React) |
| `apps/web/hooks/use-local-search.ts` | React hook — lifecycle, lazy loading, wipe-on-logout |
| `apps/web/components/modals/dm-local-search-modal.tsx` | Search UI for encrypted DM channels |
| `apps/web/components/modals/search-modal.tsx` | Existing server search — now notes encrypted channels are excluded |
| `apps/web/components/dm/dm-channel-area.tsx` | Feeds decrypted messages into the index; opens the local search modal |

### Routing Logic

```text
User opens search
       │
       ├─ Server channel (plaintext)
       │     └─ SearchModal → GET /api/search  (PostgreSQL full-text)
       │
       └─ Encrypted DM / group DM (is_encrypted = true)
             └─ DmLocalSearchModal → LocalSearchIndex.search()  (in-browser)
```

The routing decision is made in `DMChannelArea.handleSearchClick()`:

```ts
function handleSearchClick() {
  if (channel?.is_encrypted) {
    setShowLocalSearch(true)   // → DmLocalSearchModal
    return
  }
  toast({ title: "Search is coming soon" })  // non-encrypted DMs
}
```

---

## Index Design

### Data structures

```text
invertedIndex : Map<token, Set<messageId>>   ← posting lists
docs          : Map<messageId, IndexedDocument>  ← document store
channelDocs   : Map<channelId, Set<messageId>>   ← membership for eviction
```

### Tokenisation

1. Lowercase the text.
2. Replace all non-alphanumeric runs (punctuation, emoji, CJK spacers) with a
   space using the Unicode-aware regex `/[^\p{L}\p{N}]+/gu`.
3. Split on whitespace.
4. Drop tokens shorter than 2 characters.
5. Drop ~40 common English stop-words.

This keeps the index small while still being sufficient for conversational
search.

### Query parsing

The same `from:<authorId>` and `before:<YYYY-MM-DD>` filter syntax supported
by the server search is also supported locally:

```text
hello from:user-abc before:2026-01-01
```

`has:link` / `has:image` / `has:file` filters are **not** supported locally
(they require inspecting attachment metadata that isn't in the local index).

### Search algorithm

1. Tokenise the query.
2. For each token, look up its posting list (exact match, then prefix scan).
3. Intersect all posting lists (AND semantics: all tokens must appear).
4. Apply `from:` and `before:` filters.
5. Score: `matchedTokenCount × 10 + recencyBonus` where `recencyBonus` is a
   sigmoid-like decay from 1.0 (< 1 hour old) towards 0 (> 7 days old).
6. Sort by score descending, then `createdAt` descending.
7. Return top N (default 40).

---

## Index Lifecycle

### Incremental updates (new messages)

When the Supabase realtime `INSERT` event fires for a new DM message, the
component decrypts it and immediately calls `addMessageToIndex()`.  This
means freshly sent / received messages are searchable without any delay.

### Bulk indexing (initial page load)

After the initial `GET /api/dm/channels/<id>` fetch (50 messages) the
decryption `useEffect` runs, populating `decryptedContent`.  A second
`useEffect` watches `decryptedContent` and feeds all successfully-decrypted
messages into the index in bulk via `indexMessages()`.

### Lazy background indexing

`useLocalSearch.startLazyIndexing(channelId, loader)` accepts a function that
loads one page of messages at a time (taking a `before` cursor, returning
`IndexedDocument[]`).  The hook calls it in a loop with a 600 ms pause
between batches to avoid starving the UI thread, stopping when:

- the loader returns an empty array (no more history), or
- an `AbortController` signal fires (user navigated away).

**Note:** This capability is wired into the hook but the caller in
`dm-channel-area.tsx` does not yet invoke `startLazyIndexing` because it
would require a new API route to fetch and decrypt historical DM pages in
bulk on the client.  Enabling it is a one-call addition once that route
exists.

### Secure cleanup

| Event | Action |
|-------|--------|
| User navigates away from a DM channel | `clearChannel(channelId)` — removes all docs for that channel |
| Component unmounts with an active lazy-load | `AbortController.abort()` stops the background loop |
| User logs out | Call `clearAll()` from the logout handler to zero every posting list and document |

Because the index never writes to `localStorage`, `sessionStorage`, or
`IndexedDB`, closing the tab or refreshing the page also wipes it.

---

## Memory Bounds

| Constant | Value | Rationale |
|----------|-------|-----------|
| `MAX_DOCS_PER_CHANNEL` | 2 000 | ~200 KB of plaintext at avg 100 chars/msg; keeps a 1-year active DM searchable |
| `MAX_DOCS_GLOBAL` | 10 000 | Caps total RSS impact across all open channels at ~1 MB |

When either limit is exceeded, the **oldest document** (by `createdAt`) is
evicted before inserting the new one.  There is no LRU frequency tracking —
pure timestamp-based eviction is simpler and avoids extra metadata overhead.

Approximate memory usage:

| Docs indexed | Estimated heap |
|-------------|----------------|
| 500 | ~50 KB |
| 2 000 | ~200 KB |
| 10 000 | ~1 MB |

These figures are rough; actual usage depends on message length and vocabulary
diversity.

---

## Security Properties

| Property | Implementation |
|----------|----------------|
| Plaintext never sent to server | Index lives entirely in JS heap |
| No on-disk persistence | No `localStorage` / `sessionStorage` / `IndexedDB` writes |
| Cleared on logout | `clearAll()` empties every Map |
| Cleared on tab close | Memory is freed by GC when the page unloads |
| Per-channel isolation | `clearChannel()` removes exactly one channel's data |
| No server API call for search | `LocalSearchIndex.search()` is synchronous, pure JS |

The index does **not** encrypt its own contents.  It is an in-memory structure
and the plaintext exists in RAM for as long as the tab is open.  This is
unavoidable for any client-side display of decrypted messages.

---

## Tradeoffs

### What local search cannot do

| Feature | Server search | Local search |
|---------|--------------|-------------|
| Search across all channels at once | ✓ | ✗ (one channel at a time) |
| `has:image`, `has:file` filters | ✓ | ✗ |
| Search messages never loaded in this tab | ✓ | ✗ (coverage = loaded pages) |
| Search after logout | ✓ | ✗ (index wiped) |
| Stemming / lemmatisation | ✓ (Postgres English config) | ✗ (prefix match only) |
| Typo tolerance / fuzzy | ✗ | ✗ |

### Why not a service worker or OPFS?

Persisting the index to the Origin Private File System (OPFS) or an
encrypted `localStorage` blob would give richer coverage (survives tab close,
enables cross-session search).  This was deferred because:

1. It requires a key-derivation step at startup (derive an index-encryption
   key from the conversation key) to avoid storing plaintext on disk.
2. OPFS write performance is adequate but adds complexity.
3. The primary privacy goal — not exposing plaintext to the server — is met
   by the in-memory approach.

If persistent local search becomes a priority, the `LocalSearchIndex` class is
self-contained and can be serialised / deserialised without changing the hook
or UI layer.

### Why an inverted index rather than a linear scan?

The existing `handleSearchClick` proof-of-concept did a linear scan over
`Object.values(decryptedContent)`.  With 2 000 messages this still takes
< 5 ms, so either approach works for small channels.  The inverted index was
chosen because:

- Search complexity is O(k log n) for k query tokens regardless of corpus
  size, not O(n × k).
- It supports AND semantics naturally.
- It is the foundation for future features (ranked scoring, phrase proximity).

### Performance observations

Running the benchmark suite (`lib/local-search-index.test.ts`):

| Operation | N = 1 000 | N = 2 000 |
|-----------|-----------|-----------|
| `addDocuments` | < 50 ms | < 100 ms |
| `search` (single token) | < 5 ms | < 10 ms |
| `search` (3 tokens, AND) | < 5 ms | < 10 ms |

All timings measured in V8 (Node 20) on a 2024 development machine.  Browser
performance varies but is typically within 2× of these figures.

---

## Future Work

- **Persistent encrypted index** — store the serialised index in OPFS,
  encrypted with a key derived from the conversation key.
- **Lazy history loading** — call `startLazyIndexing` once a dedicated
  batch-decrypt API route exists.
- **Phrase search** — store token positions alongside posting lists to support
  `"exact phrase"` queries.
- **Non-encrypted DM search** — extend the server `/api/search` endpoint to
  cover non-encrypted DMs (currently only server channels are searched).
