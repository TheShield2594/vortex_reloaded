import { describe, expect, it, beforeEach } from "vitest"
import {
  LocalSearchIndex,
  MAX_DOCS_PER_CHANNEL,
  tokenise,
  parseLocalSearchQuery,
  type IndexedDocument,
} from "./local-search-index"

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

let idx: LocalSearchIndex

function makeDoc(overrides: Partial<IndexedDocument> & { id: string; text: string }): IndexedDocument {
  return {
    channelId: "channel-1",
    authorId: "user-1",
    authorName: "Alice",
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  idx = new LocalSearchIndex()
})

// --------------------------------------------------------------------------
// Tokenisation
// --------------------------------------------------------------------------

describe("tokenise", () => {
  it("lowercases and splits on whitespace", () => {
    expect(tokenise("Hello World")).toEqual(["hello", "world"])
  })

  it("strips punctuation", () => {
    expect(tokenise("Hello, world!")).toEqual(["hello", "world"])
  })

  it("drops stop words", () => {
    const tokens = tokenise("the quick brown fox")
    expect(tokens).not.toContain("the")
    expect(tokens).toContain("quick")
    expect(tokens).toContain("brown")
    expect(tokens).toContain("fox")
  })

  it("drops tokens shorter than 2 chars", () => {
    expect(tokenise("I am a cat")).not.toContain("i")
    expect(tokenise("I am a cat")).not.toContain("a")
  })

  it("handles empty string", () => {
    expect(tokenise("")).toEqual([])
  })

  it("handles unicode letters", () => {
    const tokens = tokenise("Ünïcödé text")
    expect(tokens).toContain("ünïcödé")
    expect(tokens).toContain("text")
  })
})

// --------------------------------------------------------------------------
// Filter parsing
// --------------------------------------------------------------------------

describe("parseLocalSearchQuery", () => {
  it("extracts from: filter", () => {
    const { query, filters } = parseLocalSearchQuery("hello from:user-123 world")
    expect(filters.fromAuthorId).toBe("user-123")
    expect(query).toContain("hello")
    expect(query).toContain("world")
    expect(query).not.toContain("from:")
  })

  it("extracts before: filter with valid date", () => {
    const { filters } = parseLocalSearchQuery("test before:2025-06-01")
    expect(filters.before).toBe(new Date("2025-06-01").toISOString())
  })

  it("ignores invalid before: date", () => {
    const { filters } = parseLocalSearchQuery("test before:notadate")
    expect(filters.before).toBeUndefined()
  })

  it("handles query with no filters", () => {
    const { query, filters } = parseLocalSearchQuery("hello world")
    expect(query).toBe("hello world")
    expect(filters.fromAuthorId).toBeUndefined()
    expect(filters.before).toBeUndefined()
  })
})

// --------------------------------------------------------------------------
// Indexing
// --------------------------------------------------------------------------

describe("LocalSearchIndex.addDocument", () => {
  it("indexes a document and returns it in search results", () => {
    idx.addDocument(makeDoc({ id: "msg-1", text: "hello encrypted world" }))
    const results = idx.search("hello")
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe("msg-1")
  })

  it("re-indexes (updates) a document when called with the same id", () => {
    idx.addDocument(makeDoc({ id: "msg-1", text: "original text" }))
    idx.addDocument(makeDoc({ id: "msg-1", text: "updated content" }))

    expect(idx.search("original")).toHaveLength(0)
    const results = idx.search("updated")
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe("msg-1")
  })

  it("addDocuments bulk-indexes multiple docs", () => {
    idx.addDocuments([
      makeDoc({ id: "m1", text: "apple banana" }),
      makeDoc({ id: "m2", text: "cherry apple" }),
      makeDoc({ id: "m3", text: "dragon fruit" }),
    ])
    expect(idx.search("apple")).toHaveLength(2)
    expect(idx.search("dragon")).toHaveLength(1)
  })
})

// --------------------------------------------------------------------------
// Search
// --------------------------------------------------------------------------

describe("LocalSearchIndex.search", () => {
  beforeEach(() => {
    idx.addDocuments([
      makeDoc({ id: "m1", text: "hello world", createdAt: "2025-01-01T00:00:00Z", authorId: "alice" }),
      makeDoc({ id: "m2", text: "hello there", createdAt: "2025-01-02T00:00:00Z", authorId: "bob" }),
      makeDoc({ id: "m3", text: "goodbye world", createdAt: "2025-01-03T00:00:00Z", authorId: "alice" }),
    ])
  })

  it("returns all docs when query is empty (no filter)", () => {
    const results = idx.search("")
    expect(results.length).toBeGreaterThanOrEqual(3)
  })

  it("AND-matches multi-word queries", () => {
    // "hello world" should match m1 (has both) but not m2 (no "world") or m3 (no "hello")
    const results = idx.search("hello world")
    expect(results.map((r) => r.id)).toContain("m1")
    expect(results.map((r) => r.id)).not.toContain("m2")
    expect(results.map((r) => r.id)).not.toContain("m3")
  })

  it("returns no results for unmatched query", () => {
    expect(idx.search("zzzmissing")).toHaveLength(0)
  })

  it("filters by channelId scope", () => {
    idx.addDocument(makeDoc({ id: "other", text: "hello world", channelId: "channel-2" }))
    const results = idx.search("hello", "channel-1")
    expect(results.every((r) => r.channelId === "channel-1")).toBe(true)
    expect(results.map((r) => r.id)).not.toContain("other")
  })

  it("applies from: filter by authorId", () => {
    const results = idx.search("from:alice hello")
    expect(results.every((r) => r.authorId === "alice")).toBe(true)
    expect(results.map((r) => r.id)).toContain("m1")
    expect(results.map((r) => r.id)).not.toContain("m2")
  })

  it("applies before: date filter", () => {
    // Only m1 (2025-01-01) and m2 (2025-01-02) are before 2025-01-03
    const results = idx.search("before:2025-01-03 hello")
    expect(results.map((r) => r.id)).toContain("m1")
    expect(results.map((r) => r.id)).toContain("m2")
    expect(results.map((r) => r.id)).not.toContain("m3")
  })

  it("respects the limit parameter", () => {
    // Add many docs with same keyword
    for (let i = 10; i < 30; i++) {
      idx.addDocument(makeDoc({ id: `bulk-${i}`, text: "keyword content here" }))
    }
    const results = idx.search("keyword", undefined, 5)
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it("returns matchedTokens for each result", () => {
    const results = idx.search("hello world")
    expect(results[0].matchedTokens).toBeDefined()
    expect(results[0].matchedTokens.length).toBeGreaterThan(0)
  })

  it("prefix-matches partial tokens", () => {
    idx.addDocument(makeDoc({ id: "prefix-1", text: "cryptography discussion" }))
    const results = idx.search("crypt")
    expect(results.map((r) => r.id)).toContain("prefix-1")
  })
})

// --------------------------------------------------------------------------
// Removal
// --------------------------------------------------------------------------

describe("LocalSearchIndex.removeDocument", () => {
  it("removes a document from results", () => {
    idx.addDocument(makeDoc({ id: "rm-1", text: "vanish this message" }))
    expect(idx.search("vanish")).toHaveLength(1)

    idx.removeDocument("rm-1")
    expect(idx.search("vanish")).toHaveLength(0)
  })

  it("is a no-op for unknown ids", () => {
    expect(() => idx.removeDocument("nonexistent")).not.toThrow()
  })
})

// --------------------------------------------------------------------------
// Channel clearing
// --------------------------------------------------------------------------

describe("LocalSearchIndex.clearChannel", () => {
  it("removes all docs for a channel", () => {
    idx.addDocuments([
      makeDoc({ id: "c1-m1", text: "hello", channelId: "channel-1" }),
      makeDoc({ id: "c1-m2", text: "world", channelId: "channel-1" }),
      makeDoc({ id: "c2-m1", text: "hello", channelId: "channel-2" }),
    ])

    idx.clearChannel("channel-1")

    expect(idx.search("hello", "channel-1")).toHaveLength(0)
    expect(idx.search("hello", "channel-2")).toHaveLength(1)
  })
})

// --------------------------------------------------------------------------
// Full wipe
// --------------------------------------------------------------------------

describe("LocalSearchIndex.clearAll", () => {
  it("removes every document and token", () => {
    idx.addDocuments([
      makeDoc({ id: "x1", text: "foo bar" }),
      makeDoc({ id: "x2", text: "baz qux" }),
    ])

    idx.clearAll()

    expect(idx.search("foo")).toHaveLength(0)
    expect(idx.search("baz")).toHaveLength(0)
    expect(idx.stats().totalDocs).toBe(0)
    expect(idx.stats().totalTokens).toBe(0)
  })
})

// --------------------------------------------------------------------------
// Memory bounds
// --------------------------------------------------------------------------

describe("memory bounds", () => {
  it("evicts the oldest document when the per-channel cap is hit", () => {
    // Use a fresh index and add MAX_DOCS_PER_CHANNEL + 1 docs.
    // Each doc carries a unique 10-character token "msgXXXXXXXX" that is
    // distinct per document and won't collide with any other doc's token.
    const MAX = MAX_DOCS_PER_CHANNEL
    const baseDate = new Date("2020-01-01T00:00:00Z")

    for (let i = 0; i < MAX + 1; i++) {
      const ts = new Date(baseDate.getTime() + i * 60_000).toISOString()
      // Pad to 8 digits so token is always >=2 chars and unique per doc.
      const unique = `msg${String(i).padStart(8, "0")}unique`
      idx.addDocument(makeDoc({ id: `cap-${i}`, text: `${unique} shared`, createdAt: ts }))
    }

    const { channelCounts } = idx.stats()
    expect(channelCounts["channel-1"]).toBeLessThanOrEqual(MAX)

    // The oldest doc (cap-0 at 2020-01-01T00:00:00Z) should have been evicted.
    // Its unique token is "msg00000000unique".
    expect(idx.search("msg00000000unique", "channel-1")).toHaveLength(0)
    // The newest doc should still be present via its unique token.
    const newestUnique = `msg${String(MAX).padStart(8, "0")}unique`
    expect(idx.search(newestUnique, "channel-1")).toHaveLength(1)
  })
})

// --------------------------------------------------------------------------
// Stats
// --------------------------------------------------------------------------

describe("LocalSearchIndex.stats", () => {
  it("reports doc and token counts", () => {
    idx.addDocument(makeDoc({ id: "s1", text: "quick brown fox" }))
    const { totalDocs, totalTokens } = idx.stats()
    expect(totalDocs).toBe(1)
    expect(totalTokens).toBeGreaterThan(0)
  })
})

// --------------------------------------------------------------------------
// Benchmark notes (not assertions — just observations logged to output)
// --------------------------------------------------------------------------

describe("benchmark notes", () => {
  it("indexes 1000 docs and searches in under 200ms each", () => {
    const N = 1_000
    const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"]
    const docs = Array.from({ length: N }, (_, i) => {
      const word = words[i % words.length]
      return makeDoc({ id: `bench-${i}`, text: `${word} message number ${i}`, createdAt: new Date(Date.now() - i * 1000).toISOString() })
    })

    const t0 = performance.now()
    idx.addDocuments(docs)
    const indexTime = performance.now() - t0

    const t1 = performance.now()
    const results = idx.search("alpha")
    const searchTime = performance.now() - t1

    console.info(`[benchmark] indexed ${N} docs in ${indexTime.toFixed(1)}ms; search returned ${results.length} results in ${searchTime.toFixed(2)}ms`)

    // Only assert timing in explicit perf runs to avoid CI flakiness.
    if (process.env.RUN_PERF_TESTS) {
      expect(indexTime).toBeLessThan(2_000)
      expect(searchTime).toBeLessThan(200)
    }
  })
})
