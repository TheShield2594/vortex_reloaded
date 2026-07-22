/**
 * AutoMod engine — evaluates configured rules against incoming messages.
 */

import type {
  AutoModRuleWithParsed,
  AutoModAction,
  KeywordFilterConfig,
  MentionSpamConfig,
  LinkSpamConfig,
  RegexFilterConfig,
  RapidMessageConfig,
  AutoModConditions,
} from "@/types/database"

const URL_RE =
  /https?:\/\/[^\s]+|www\.[^\s]+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|edu|gov|co|uk|de|fr|jp|au|ca|us|app|dev|ai|tech|info|biz)(?:\/[^\s]*)?/gi

function countLinks(text: string): number {
  return (text.match(URL_RE) ?? []).length
}

function countMentions(text: string, mentions: string[]): number {
  const inlineCount = (text.match(/<@[0-9a-f-]+>/gi) ?? []).length
  return Math.max(inlineCount, mentions.length)
}

export interface RuleEvaluationContext {
  channelId?: string
  memberRoleIds?: string[]
  accountAgeMinutes?: number
  trustLevel?: number
  recentMessageCount?: number
}

export interface RuleViolation {
  rule_id: string
  rule_name: string
  trigger_type: string
  priority?: number
  actions: AutoModAction[]
  reason: string
}

function matchesConditions(conditions: AutoModConditions | undefined, ctx: RuleEvaluationContext): boolean {
  if (!conditions) return true

  if (conditions.channel_ids?.length && (!ctx.channelId || !conditions.channel_ids.includes(ctx.channelId))) {
    return false
  }

  if (conditions.role_ids?.length) {
    const roleIds = ctx.memberRoleIds ?? []
    if (!conditions.role_ids.some((roleId) => roleIds.includes(roleId))) {
      return false
    }
  }

  if (typeof conditions.min_account_age_minutes === "number") {
    if (typeof ctx.accountAgeMinutes !== "number" || ctx.accountAgeMinutes < conditions.min_account_age_minutes) {
      return false
    }
  }

  if (typeof conditions.min_trust_level === "number") {
    if ((ctx.trustLevel ?? 0) < conditions.min_trust_level) {
      return false
    }
  }

  return true
}

export function evaluateRule(
  rule: AutoModRuleWithParsed,
  content: string,
  mentions: string[],
  context: RuleEvaluationContext = {}
): RuleViolation | null {
  if (!rule.enabled || !matchesConditions(rule.conditions, context)) return null

  const lower = content.toLowerCase()

  switch (rule.trigger_type) {
    case "keyword_filter": {
      const cfg = rule.config as KeywordFilterConfig
      const hitKeyword = cfg.keywords?.find((kw) => lower.includes(kw.toLowerCase()))
      if (hitKeyword) {
        return {
          rule_id: rule.id,
          rule_name: rule.name,
          trigger_type: rule.trigger_type,
          priority: rule.priority ?? 100,
          actions: rule.actions,
          reason: `Blocked keyword: "${hitKeyword}"`,
        }
      }

      const MAX_PATTERN_LENGTH = 200
      const REGEX_BUDGET_MS = 50
      const deadline = Date.now() + REGEX_BUDGET_MS
      for (const pattern of cfg.regex_patterns ?? []) {
        if (Date.now() > deadline) break
        if (typeof pattern !== "string" || pattern.length > MAX_PATTERN_LENGTH) continue
        try {
          const re = new RegExp(pattern, "i")
          if (re.test(content)) {
            return {
              rule_id: rule.id,
              rule_name: rule.name,
              trigger_type: rule.trigger_type,
              priority: rule.priority ?? 100,
              actions: rule.actions,
              reason: `Matched regex pattern: ${pattern}`,
            }
          }
        } catch {
          // ignore malformed regex
        }
      }

      return null
    }

    case "regex_filter": {
      const cfg = rule.config as RegexFilterConfig
      const MAX_PATTERN_LENGTH = 200
      const REGEX_BUDGET_MS = 50
      const deadline = Date.now() + REGEX_BUDGET_MS
      for (const pattern of cfg.regex_patterns ?? []) {
        if (Date.now() > deadline) break
        if (typeof pattern !== "string" || pattern.length > MAX_PATTERN_LENGTH) continue
        try {
          const re = new RegExp(pattern, "i")
          if (re.test(content)) {
            return {
              rule_id: rule.id,
              rule_name: rule.name,
              trigger_type: rule.trigger_type,
              priority: rule.priority ?? 100,
              actions: rule.actions,
              reason: `Matched regex pattern: ${pattern}`,
            }
          }
        } catch {
          // ignore malformed regex
        }
      }
      return null
    }

    case "mention_spam": {
      const cfg = rule.config as MentionSpamConfig
      const threshold = cfg.mention_threshold ?? 5
      const count = countMentions(content, mentions)
      if (count < threshold) return null
      return {
        rule_id: rule.id,
        rule_name: rule.name,
        trigger_type: rule.trigger_type,
        priority: rule.priority ?? 100,
        actions: rule.actions,
        reason: `Mention spam: ${count} mentions (threshold ${threshold})`,
      }
    }

    case "link_spam": {
      const cfg = rule.config as LinkSpamConfig
      const threshold = cfg.link_threshold ?? 3
      const count = countLinks(content)
      if (count < threshold) return null
      return {
        rule_id: rule.id,
        rule_name: rule.name,
        trigger_type: rule.trigger_type,
        priority: rule.priority ?? 100,
        actions: rule.actions,
        reason: `Link spam: ${count} links (threshold ${threshold})`,
      }
    }

    case "rapid_message": {
      const cfg = rule.config as RapidMessageConfig
      const threshold = cfg.message_threshold ?? 6
      const seen = context.recentMessageCount ?? 0
      if (seen < threshold) return null
      return {
        rule_id: rule.id,
        rule_name: rule.name,
        trigger_type: rule.trigger_type,
        priority: rule.priority ?? 100,
        actions: rule.actions,
        reason: `Rapid messages: ${seen} in ${cfg.window_seconds ?? 10}s (threshold ${threshold})`,
      }
    }

    default:
      return null
  }
}

export function evaluateAllRules(
  rules: AutoModRuleWithParsed[],
  content: string,
  mentions: string[] = [],
  context: RuleEvaluationContext = {}
): RuleViolation[] {
  if (!content) return []
  const sorted = [...rules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
  const violations: RuleViolation[] = []
  for (const rule of sorted) {
    const v = evaluateRule(rule, content, mentions, context)
    if (v) violations.push(v)
  }
  return violations
}

export function shouldBlockMessage(violations: RuleViolation[]): boolean {
  return violations.some((v) => v.actions.some((a) => a.type === "block_message"))
}

export function shouldQuarantineMessage(violations: RuleViolation[]): boolean {
  return violations.some((v) => v.actions.some((a) => a.type === "quarantine_message"))
}

export function getTimeoutDuration(violations: RuleViolation[]): number | null {
  let max = 0
  for (const v of violations) {
    for (const a of v.actions) {
      if (a.type === "timeout_member") {
        max = Math.max(max, a.duration_seconds ?? 60)
      }
    }
  }
  return max > 0 ? max : null
}

export function getAlertChannels(violations: RuleViolation[]): string[] {
  const channels = new Set<string>()
  for (const v of violations) {
    for (const a of v.actions) {
      if (a.type === "alert_channel" && a.channel_id) channels.add(a.channel_id)
    }
  }
  return [...channels]
}

export const VALID_TRIGGER_TYPES = ["keyword_filter", "regex_filter", "mention_spam", "link_spam", "rapid_message"] as const
export const VALID_ACTION_TYPES = ["block_message", "quarantine_message", "timeout_member", "warn_member", "alert_channel"] as const

const UNSAFE_REGEX_RE = /\([^)]*[+*?][^)]*\)[+*?{]/
/** Additional patterns that can cause catastrophic backtracking. */
const UNSAFE_NESTED_QUANTIFIER_RE = /([+*?{])\s*\1|\.{2,}[+*]|\(\?[^)]*[+*][^)]*\)[+*]/

export function validateConfigAndActions(
  trigger_type: string,
  config: unknown,
  actions: unknown,
  conditions?: unknown
): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return "config must be a non-null object"
  }
  const cfg = config as Record<string, unknown>

  if (trigger_type === "keyword_filter") {
    if (!Array.isArray(cfg.keywords) || cfg.keywords.some((k) => typeof k !== "string") || cfg.keywords.length === 0) {
      return "keyword_filter config must have non-empty keywords: string[]"
    }
    if (cfg.regex_patterns !== undefined) {
      if (!Array.isArray(cfg.regex_patterns) || cfg.regex_patterns.some((p) => typeof p !== "string")) {
        return "keyword_filter config.regex_patterns must be string[] if provided"
      }
      for (const pattern of cfg.regex_patterns as string[]) {
        if (UNSAFE_REGEX_RE.test(pattern) || UNSAFE_NESTED_QUANTIFIER_RE.test(pattern)) return `regex pattern contains unsafe nested quantifiers: ${pattern}`
      }
    }
  } else if (trigger_type === "regex_filter") {
    if (!Array.isArray(cfg.regex_patterns) || cfg.regex_patterns.some((p) => typeof p !== "string")) {
      return "regex_filter config must have regex_patterns: string[]"
    }
    for (const pattern of cfg.regex_patterns as string[]) {
      if (UNSAFE_REGEX_RE.test(pattern) || UNSAFE_NESTED_QUANTIFIER_RE.test(pattern)) return `regex pattern contains unsafe nested quantifiers: ${pattern}`
    }
  } else if (trigger_type === "mention_spam") {
    if (typeof cfg.mention_threshold !== "number" || cfg.mention_threshold <= 0) {
      return "mention_spam config must have mention_threshold > 0"
    }
  } else if (trigger_type === "link_spam") {
    if (typeof cfg.link_threshold !== "number" || cfg.link_threshold <= 0) {
      return "link_spam config must have link_threshold > 0"
    }
  } else if (trigger_type === "rapid_message") {
    if (typeof cfg.message_threshold !== "number" || cfg.message_threshold <= 0) {
      return "rapid_message config must have message_threshold > 0"
    }
    if (typeof cfg.window_seconds !== "number" || cfg.window_seconds <= 0) {
      return "rapid_message config must have window_seconds > 0"
    }
  }

  if (conditions !== undefined) {
    if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) {
      return "conditions must be an object"
    }
  }

  if (!Array.isArray(actions) || actions.length === 0) return "actions must be a non-empty array"
  for (const action of actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) return "each action must be an object"
    const a = action as Record<string, unknown>
    if (!(VALID_ACTION_TYPES as readonly string[]).includes(a.type as string)) {
      return `action.type must be one of: ${VALID_ACTION_TYPES.join(", ")}`
    }
    if (a.type === "alert_channel" && (typeof a.channel_id !== "string" || a.channel_id === "")) {
      return "alert_channel action must include a non-empty channel_id"
    }
  }

  return null
}
