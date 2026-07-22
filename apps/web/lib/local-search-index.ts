/**
 * local-search-index.ts
 *
 * Client-side inverted index for searching decrypted message content in
 * encrypted channels and DMs.  The index lives entirely in memory (never
 * written to localStorage / IndexedDB) so plaintext is cleared automatically
 * when the page is closed or the user logs out.
 *
 * Architecture:
 *   token → Set<messageId>   (inverted index)
 *   messageId → IndexedDocument  (forward index / doc store)
 *   channelId → Set<messageId>   (channel membership for scoped eviction)
 *
 * Memory bounds:
 *   MAX_DOCS_PER_CHANNEL – oldest messages evicted when the limit is exceeded
 *   MAX_DOCS_GLOBAL      – hard global ceiling across all channels
 */

// --------------------------------------------------------------------------
// Public types
// --------------------------------------------------------------------------

export interface IndexedDocument {
  id: string
  channelId: string
  authorId: string
  authorName: string
  avatarUrl: string | null
  text: string       // plaintext (already decrypted before insertion)
  createdAt: string  // ISO 8601
}

export interface LocalSearchResult extends IndexedDocument {
  score: number        // higher = more relevant; used for ordering
  matchedTokens: string[]
}

export interface LocalSearchFilters {
  fromAuthorId?: string
  before?: string  // ISO 8601 upper bound (exclusive)
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

export const MAX_DOCS_PER_CHANNEL = 2_000
export const MAX_DOCS_GLOBAL = 10_000

// Common English stop-words to skip during tokenisation.
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "has", "have", "he", "her", "him", "his", "how", "i", "if", "in", "is",
  "it", "its", "me", "my", "no", "not", "of", "on", "or", "our", "out",
  "she", "so", "than", "that", "the", "their", "them", "then", "there",
  "they", "this", "to", "up", "us", "was", "we", "were", "what", "when",
  "who", "why", "will", "with", "you", "your",
])

// --------------------------------------------------------------------------
// Tokenisation helpers
// --------------------------------------------------------------------------

/** Split text into lowercase, de-punctuated tokens, drop stop-words and blanks. */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    // Replace all non-alphanumeric runs with a space (handles punctuation,
    // emoji, CJK spacers, etc.)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
}

// --------------------------------------------------------------------------
// Index class
// --------------------------------------------------------------------------

export class LocalSearchIndex {
  // token → Set<messageId>
  private readonly invertedIndex = new Map<string, Set<string>>()
  // messageId → IndexedDocument
  private readonly docs = new Map<string, IndexedDocument>()
  // channelId → Set<messageId>
  private readonly channelDocs = new Map<string, Set<string>>()

  // ------------------------------------------------------------------
  // Write operations
  // ------------------------------------------------------------------

  /** Add or update a single document in the index. */
  addDocument(doc: IndexedDocument): void {
    // Remove any existing version of this doc to avoid stale tokens.
    if (this.docs.has(doc.id)) {
      this._removeDocument(doc.id)
    }

    // Enforce per-channel memory cap before inserting.
    this._enforceChannelCap(doc.channelId)
    // Enforce global cap.
    this._enforceGlobalCap()

    // Store document.
    this.docs.set(doc.id, doc)

    // Track channel membership.
    if (!this.channelDocs.has(doc.channelId)) {
      this.channelDocs.set(doc.channelId, new Set())
    }
    this.channelDocs.get(doc.channelId)!.add(doc.id)

    // Index tokens.
    for (const token of tokenise(doc.text)) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set())
      }
      this.invertedIndex.get(token)!.add(doc.id)
    }
  }

  /** Bulk-add documents (e.g. an initial history page). */
  addDocuments(docs: IndexedDocument[]): void {
    for (const doc of docs) {
      this.addDocument(doc)
    }
  }

  /** Remove a single document from all index structures. */
  removeDocument(id: string): void {
    this._removeDocument(id)
  }

  /** Remove all documents belonging to a specific channel (e.g. on channel close). */
  clearChannel(channelId: string): void {
    const ids = this.channelDocs.get(channelId)
    if (!ids) return
    for (const id of ids) {
      this._removeDocument(id)
    }
    this.channelDocs.delete(channelId)
  }

  /** Wipe every document from the index (call on logout). */
  clearAll(): void {
    this.invertedIndex.clear()
    this.docs.clear()
    this.channelDocs.clear()
  }

  // ------------------------------------------------------------------
  // Read operations
  // ------------------------------------------------------------------

  /**
   * Search the index.
   *
   * @param rawQuery  Free-text query (can include `from:<id>` / `before:<date>` filters).
   * @param channelId Optional channel scope; if omitted, searches all indexed channels.
   * @param limit     Maximum number of results (default 40).
   */
  search(rawQuery: string, channelId?: string, limit = 40): LocalSearchResult[] {
    const { query, filters } = parseLocalSearchQuery(rawQuery)

    // Build the candidate set.
    const tokens = tokenise(query)

    let candidateIds: Set<string> | null = null

    if (tokens.length === 0) {
      // No query text → return all docs in scope, newest first.
      if (channelId) {
        candidateIds = new Set(this.channelDocs.get(channelId) ?? [])
      } else {
        candidateIds = new Set(this.docs.keys())
      }
    } else {
      // Intersect posting lists for each token (AND semantics).
      for (const token of tokens) {
        // Try exact match first, then prefix scan for short tokens.
        const exactSet = this.invertedIndex.get(token)
        let postings: Set<string>

        if (exactSet) {
          postings = exactSet
        } else {
          // Prefix scan: collect all ids from tokens that start with this token.
          postings = new Set<string>()
          for (const [indexedToken, ids] of this.invertedIndex) {
            if (indexedToken.startsWith(token)) {
              for (const id of ids) postings.add(id)
            }
          }
        }

        if (candidateIds === null) {
          candidateIds = new Set(postings)
        } else {
          // Intersect.
          for (const id of candidateIds) {
            if (!postings.has(id)) candidateIds.delete(id)
          }
        }

        if (candidateIds.size === 0) break
      }
    }

    if (!candidateIds || candidateIds.size === 0) return []

    // Retrieve docs, apply channel + filter constraints.
    const results: LocalSearchResult[] = []
    for (const id of candidateIds) {
      const doc = this.docs.get(id)
      if (!doc) continue
      if (channelId && doc.channelId !== channelId) continue
      if (filters.fromAuthorId && doc.authorId !== filters.fromAuthorId) continue
      if (filters.before && doc.createdAt >= filters.before) continue

      // Score: count matched tokens + recency bonus.
      const docTokens = tokenise(doc.text)
      const matched = tokens.filter((t) =>
        docTokens.some((dt) => dt === t || dt.startsWith(t))
      )
      const recencyBonus = recencyScore(doc.createdAt)
      const score = matched.length * 10 + recencyBonus

      results.push({ ...doc, score, matchedTokens: matched })
    }

    // Sort by score desc, then by createdAt desc.
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0
    })

    return results.slice(0, limit)
  }

  // ------------------------------------------------------------------
  // Diagnostics / stats
  // ------------------------------------------------------------------

  stats(): { totalDocs: number; totalTokens: number; channelCounts: Record<string, number> } {
    const channelCounts: Record<string, number> = {}
    for (const [cid, ids] of this.channelDocs) {
      channelCounts[cid] = ids.size
    }
    return {
      totalDocs: this.docs.size,
      totalTokens: this.invertedIndex.size,
      channelCounts,
    }
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private _removeDocument(id: string): void {
    const doc = this.docs.get(id)
    if (!doc) return

    // Remove from token postings.
    for (const token of tokenise(doc.text)) {
      const set = this.invertedIndex.get(token)
      if (set) {
        set.delete(id)
        if (set.size === 0) this.invertedIndex.delete(token)
      }
    }

    // Remove from channel membership.
    this.channelDocs.get(doc.channelId)?.delete(id)

    // Remove from doc store.
    this.docs.delete(id)
  }

  private _enforceChannelCap(channelId: string): void {
    const ids = this.channelDocs.get(channelId)
    if (!ids || ids.size < MAX_DOCS_PER_CHANNEL) return

    // Evict the oldest document (smallest createdAt).
    let oldestId: string | null = null
    let oldestTs = ""
    for (const id of ids) {
      const ts = this.docs.get(id)?.createdAt ?? ""
      if (!oldestId || ts < oldestTs) {
        oldestId = id
        oldestTs = ts
      }
    }
    if (oldestId) this._removeDocument(oldestId)
  }

  private _enforceGlobalCap(): void {
    if (this.docs.size < MAX_DOCS_GLOBAL) return

    // Evict the oldest document globally.
    let oldestId: string | null = null
    let oldestTs = ""
    for (const [id, doc] of this.docs) {
      if (!oldestId || doc.createdAt < oldestTs) {
        oldestId = id
        oldestTs = doc.createdAt
      }
    }
    if (oldestId) this._removeDocument(oldestId)
  }
}

// --------------------------------------------------------------------------
// Filter parsing (mirrors server-side parseSearchQuery)
// --------------------------------------------------------------------------

export interface ParsedLocalQuery {
  query: string
  filters: LocalSearchFilters
}

export function parseLocalSearchQuery(raw: string): ParsedLocalQuery {
  const filters: LocalSearchFilters = {}
  let query = raw

  const fromMatch = query.match(/(?:^|\s)from:([^\s]+)/i)
  if (fromMatch?.[1]) {
    filters.fromAuthorId = fromMatch[1].trim()
    query = query.replace(fromMatch[0], " ")
  }

  const beforeMatch = query.match(/(?:^|\s)before:([^\s]+)/i)
  if (beforeMatch?.[1]) {
    const candidate = new Date(beforeMatch[1].trim())
    if (!Number.isNaN(candidate.getTime())) {
      filters.before = candidate.toISOString()
    }
    query = query.replace(beforeMatch[0], " ")
  }

  return { query: query.replace(/\s+/g, " ").trim(), filters }
}

// --------------------------------------------------------------------------
// Scoring helpers
// --------------------------------------------------------------------------

/** Maps a createdAt ISO string to a small float bonus [0, 1]. */
function recencyScore(createdAt: string): number {
  const age = Date.now() - new Date(createdAt).getTime()
  const ageHours = age / 3_600_000
  // Sigmoid-like decay: full score for < 1h, ~0.5 at 24h, ~0 after 7d.
  return 1 / (1 + ageHours / 24)
}

// --------------------------------------------------------------------------
// Singleton export
// --------------------------------------------------------------------------

/** App-level singleton. Import this in hooks / components. */
export const localSearchIndex = new LocalSearchIndex()
