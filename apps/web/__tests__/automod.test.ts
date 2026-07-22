/**
 * AutoMod engine unit tests.
 *
 * Tests cover:
 *  - keyword_filter rule evaluation (plain keywords + regex patterns)
 *  - mention_spam rule evaluation
 *  - link_spam rule evaluation
 *  - evaluateAllRules – multiple rules, accumulation of violations
 *  - shouldBlockMessage helper
 *  - getTimeoutDuration helper (picks max duration)
 *  - getAlertChannels helper
 *  - Disabled rules are skipped
 */

import { describe, it, expect } from "vitest"
import {
  evaluateRule,
  evaluateAllRules,
  shouldBlockMessage,
  getTimeoutDuration,
  getAlertChannels,
} from "../lib/automod"
import type { AutoModRuleWithParsed } from "../types/database"

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRule(
  overrides: Partial<AutoModRuleWithParsed> & {
    trigger_type: AutoModRuleWithParsed["trigger_type"]
    config: AutoModRuleWithParsed["config"]
    actions: AutoModRuleWithParsed["actions"]
  }
): AutoModRuleWithParsed {
  return {
    id: "rule-1",
    server_id: "server-1",
    name: "Test Rule",
    conditions: {},
    priority: 100,
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

// ── Keyword filter ────────────────────────────────────────────────────────────

describe("keyword_filter", () => {
  const rule = makeRule({
    trigger_type: "keyword_filter",
    config: { keywords: ["spam", "badword"], regex_patterns: [] },
    actions: [{ type: "block_message" }],
  })

  it("triggers when content contains a blocked keyword (case-insensitive)", () => {
    expect(evaluateRule(rule, "SPAM everywhere", [])).not.toBeNull()
    expect(evaluateRule(rule, "this is badword content", [])).not.toBeNull()
  })

  it("does not trigger on clean content", () => {
    expect(evaluateRule(rule, "Hello, world!", [])).toBeNull()
  })

  it("includes the matched keyword in the reason", () => {
    const result = evaluateRule(rule, "spam is bad", [])
    expect(result?.reason).toContain("spam")
  })

  it("triggers on regex patterns", () => {
    const ruleWithRegex = makeRule({
      trigger_type: "keyword_filter",
      config: { keywords: [], regex_patterns: ["\\btest\\d+\\b"] },
      actions: [{ type: "block_message" }],
    })
    expect(evaluateRule(ruleWithRegex, "test123 is a pattern match", [])).not.toBeNull()
    expect(evaluateRule(ruleWithRegex, "no match here", [])).toBeNull()
  })

  it("skips malformed regex patterns gracefully", () => {
    const ruleWithBadRegex = makeRule({
      trigger_type: "keyword_filter",
      config: { keywords: [], regex_patterns: ["[invalid"] },
      actions: [{ type: "block_message" }],
    })
    expect(() => evaluateRule(ruleWithBadRegex, "test", [])).not.toThrow()
  })
})

// ── Mention spam ──────────────────────────────────────────────────────────────

describe("mention_spam", () => {
  const rule = makeRule({
    trigger_type: "mention_spam",
    config: { mention_threshold: 3 },
    actions: [{ type: "timeout_member", duration_seconds: 60 }],
  })

  it("triggers when resolved mentions array meets threshold", () => {
    const mentions = ["u1", "u2", "u3"]
    expect(evaluateRule(rule, "hey all", mentions)).not.toBeNull()
  })

  it("triggers on inline <@uuid> mentions in content", () => {
    const content = "<@aa> <@bb> <@cc>"
    expect(evaluateRule(rule, content, [])).not.toBeNull()
  })

  it("does not trigger below threshold", () => {
    expect(evaluateRule(rule, "hey <@aa>", ["u1"])).toBeNull()
  })

  it("reports correct mention count in reason", () => {
    const result = evaluateRule(rule, "msg", ["u1", "u2", "u3", "u4"])
    expect(result?.reason).toContain("4")
  })
})

// ── Link spam ─────────────────────────────────────────────────────────────────

describe("link_spam", () => {
  const rule = makeRule({
    trigger_type: "link_spam",
    config: { link_threshold: 2 },
    actions: [{ type: "block_message" }, { type: "alert_channel", channel_id: "alert-ch" }],
  })

  it("triggers when message contains enough links", () => {
    const content = "Check https://example.com and http://spam.io and www.another.com"
    expect(evaluateRule(rule, content, [])).not.toBeNull()
  })

  it("does not trigger with fewer links than threshold", () => {
    expect(evaluateRule(rule, "Visit https://example.com for details", [])).toBeNull()
  })

  it("reports link count in reason", () => {
    const result = evaluateRule(rule, "http://a.com http://b.com http://c.com", [])
    expect(result?.reason).toContain("3")
  })
})

// ── Disabled rules ────────────────────────────────────────────────────────────

describe("disabled rules", () => {
  it("are skipped", () => {
    const rule = makeRule({
      trigger_type: "keyword_filter",
      config: { keywords: ["spam"], regex_patterns: [] },
      actions: [{ type: "block_message" }],
      enabled: false,
    })
    expect(evaluateRule(rule, "spam content", [])).toBeNull()
  })
})

// ── evaluateAllRules ──────────────────────────────────────────────────────────

describe("evaluateAllRules", () => {
  const keywordRule = makeRule({
    id: "r1",
    trigger_type: "keyword_filter",
    config: { keywords: ["forbidden"], regex_patterns: [] },
    actions: [{ type: "block_message" }],
  })
  const mentionRule = makeRule({
    id: "r2",
    trigger_type: "mention_spam",
    config: { mention_threshold: 2 },
    actions: [{ type: "timeout_member", duration_seconds: 30 }],
  })

  it("returns empty array for clean message", () => {
    expect(evaluateAllRules([keywordRule, mentionRule], "Hello!", [])).toHaveLength(0)
  })

  it("returns multiple violations when multiple rules trigger", () => {
    const violations = evaluateAllRules([keywordRule, mentionRule], "forbidden msg", ["u1", "u2"])
    expect(violations).toHaveLength(2)
  })

  it("returns empty array for empty content", () => {
    expect(evaluateAllRules([keywordRule], "", [])).toHaveLength(0)
  })

  it("evaluates rules by ascending priority", () => {
    const lowPriority = makeRule({
      id: "r-low",
      trigger_type: "keyword_filter",
      config: { keywords: ["alpha"] },
      actions: [{ type: "warn_member" }],
      priority: 200,
    } as any)
    const highPriority = makeRule({
      id: "r-high",
      trigger_type: "keyword_filter",
      config: { keywords: ["alpha"] },
      actions: [{ type: "block_message" }],
      priority: 10,
    } as any)
    const violations = evaluateAllRules([lowPriority, highPriority], "alpha", [])
    expect(violations[0]?.rule_id).toBe("r-high")
  })
})

describe("rapid_message", () => {
  it("triggers when recent message count exceeds threshold", () => {
    const rule = makeRule({
      trigger_type: "rapid_message",
      config: { message_threshold: 5, window_seconds: 10 },
      actions: [{ type: "quarantine_message" }],
      priority: 50,
    } as any)
    const violation = evaluateRule(rule, "hello", [], { recentMessageCount: 6 })
    expect(violation).not.toBeNull()
  })
})

describe("performance ceiling", () => {
  it("keeps burst evaluation under 200ms for 1k rules", () => {
    const rules = Array.from({ length: 1000 }).map((_, i) =>
      makeRule({
        id: `r-${i}`,
        trigger_type: "keyword_filter",
        config: { keywords: ["needle"] },
        actions: [{ type: "warn_member" }],
        priority: i,
      } as any)
    )

    const start = performance.now()
    evaluateAllRules(rules, "clean message", [])
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
  })
})

// ── Action helpers ────────────────────────────────────────────────────────────

describe("shouldBlockMessage", () => {
  it("returns true when any violation has block_message action", () => {
    const violations = [
      {
        rule_id: "r1",
        rule_name: "R1",
        trigger_type: "keyword_filter",
        actions: [{ type: "block_message" as const }],
        reason: "blocked keyword",
      },
    ]
    expect(shouldBlockMessage(violations)).toBe(true)
  })

  it("returns false when no violation has block_message", () => {
    const violations = [
      {
        rule_id: "r1",
        rule_name: "R1",
        trigger_type: "mention_spam",
        actions: [{ type: "timeout_member" as const, duration_seconds: 60 }],
        reason: "too many mentions",
      },
    ]
    expect(shouldBlockMessage(violations)).toBe(false)
  })

  it("returns false for empty violations", () => {
    expect(shouldBlockMessage([])).toBe(false)
  })
})

describe("getTimeoutDuration", () => {
  it("returns null when no timeout actions", () => {
    const violations = [
      {
        rule_id: "r1",
        rule_name: "R1",
        trigger_type: "keyword_filter",
        actions: [{ type: "block_message" as const }],
        reason: "keyword",
      },
    ]
    expect(getTimeoutDuration(violations)).toBeNull()
  })

  it("returns the maximum timeout duration across all violations", () => {
    const violations = [
      {
        rule_id: "r1",
        rule_name: "R1",
        trigger_type: "mention_spam",
        actions: [{ type: "timeout_member" as const, duration_seconds: 30 }],
        reason: "mentions",
      },
      {
        rule_id: "r2",
        rule_name: "R2",
        trigger_type: "link_spam",
        actions: [{ type: "timeout_member" as const, duration_seconds: 120 }],
        reason: "links",
      },
    ]
    expect(getTimeoutDuration(violations)).toBe(120)
  })

  it("defaults to 60 seconds when duration_seconds is not set", () => {
    const violations = [
      {
        rule_id: "r1",
        rule_name: "R1",
        trigger_type: "keyword_filter",
        actions: [{ type: "timeout_member" as const }],
        reason: "keyword",
      },
    ]
    expect(getTimeoutDuration(violations)).toBe(60)
  })
})

describe("getAlertChannels", () => {
  it("returns empty array when no alert_channel actions", () => {
    const violations = [
      {
        rule_id: "r1",
        rule_name: "R1",
        trigger_type: "keyword_filter",
        actions: [{ type: "block_message" as const }],
        reason: "keyword",
      },
    ]
    expect(getAlertChannels(violations)).toEqual([])
  })

  it("collects unique channel IDs from all violations", () => {
    const violations = [
      {
        rule_id: "r1",
        rule_name: "R1",
        trigger_type: "keyword_filter",
        actions: [{ type: "alert_channel" as const, channel_id: "ch-1" }],
        reason: "keyword",
      },
      {
        rule_id: "r2",
        rule_name: "R2",
        trigger_type: "link_spam",
        actions: [
          { type: "alert_channel" as const, channel_id: "ch-1" },
          { type: "alert_channel" as const, channel_id: "ch-2" },
        ],
        reason: "links",
      },
    ]
    const channels = getAlertChannels(violations)
    expect(channels).toHaveLength(2)
    expect(channels).toContain("ch-1")
    expect(channels).toContain("ch-2")
  })
})
