#!/usr/bin/env node
/**
 * Migration smoke test (static analysis — no database required)
 *
 * This project uses cloud-hosted Supabase; there is no local Docker stack.
 * Instead of running `supabase db reset`, this script analyses the migration
 * files in supabase/migrations/ and asserts:
 *
 *   1. Every migration filename matches the expected NNNNn_name.sql pattern
 *   2. No two migration files share the same numeric prefix (version conflict)
 *   3. Every expected table has an ENABLE ROW LEVEL SECURITY statement
 *   4. No CREATE POLICY appears for a policy name that was already created in
 *      an earlier migration without a preceding DROP POLICY IF EXISTS guard
 *
 * Usage (from repo root):
 *   node scripts/migration-smoke-test.mjs
 *
 * Exit code:
 *   0 – all assertions passed
 *   1 – one or more assertions failed (details printed to stderr)
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url).pathname

// ── Expected tables ───────────────────────────────────────────────────────────
// Every table listed here MUST have an ALTER TABLE … ENABLE ROW LEVEL SECURITY
// statement somewhere in the migration files.
const EXPECTED_TABLES_WITH_RLS = [
  "users",
  "servers",
  "server_members",
  "roles",
  "member_roles",
  "channels",
  "channel_permissions",
  "messages",
  "attachments",
  "reactions",
  "direct_messages",
  "dm_attachments",
  "voice_states",
  "notifications",
  "server_emojis",
  "webhooks",
  "threads",
  "thread_members",
  "thread_read_states",
  "friendships",
  "invites",
  "read_states",
  "dm_channels",
  "dm_channel_members",
  "dm_read_states",
  "events",
  "event_rsvps",
  "event_hosts",
  "event_reminders",
  "server_bans",
  "member_timeouts",
  "audit_logs",
  "moderation_appeals",
  "moderation_appeal_status_events",
  "moderation_appeal_internal_notes",
  "moderation_decision_templates",
  "member_screening",
  "screening_configs",
  "automod_rules",
  "automod_rule_analytics",
  "push_subscriptions",
  "notification_settings",
  "auth_sessions",
  "auth_challenges",
  "auth_security_policies",
  "auth_trusted_devices",
  "passkey_credentials",
  "recovery_codes",
  "login_attempts",
  "login_risk_events",
  "reports",
  "app_catalog",
  "app_catalog_credentials",
  "app_commands",
  "app_event_subscriptions",
  "app_rate_limits",
  "app_reviews",
  "app_usage_metrics",
  "server_app_installs",
  "server_app_install_credentials",
  "channel_tasks",
  "channel_docs",
  "workspace_updates",
  "attachment_scan_metrics",
  "voice_call_sessions",
  "voice_call_participants",
  "voice_call_summaries",
  "voice_intelligence_policies",
  "voice_intelligence_audit_log",
  "voice_transcript_segments",
  "voice_transcript_translations",
  "dm_channel_keys",
  "user_device_keys",
  "user_connections",
]

let failures = 0

// ── Load migration files ──────────────────────────────────────────────────────
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()

// ── Check 1: filename format ──────────────────────────────────────────────────
// Accepts: NNNNN_name.sql  or  NNNNNx_name.sql  (x = single lowercase letter
// used for sub-migrations within the same logical group, e.g. 00014b_moderation.sql)
const FILE_RE = /^\d{5}[a-z]?_\w+\.sql$/
for (const f of files) {
  if (!FILE_RE.test(f)) {
    console.error(`✗  Unexpected migration filename: ${f}`)
    failures++
  }
}

// ── Check 2: no duplicate version prefixes ────────────────────────────────────
const versionsSeen = new Map()
for (const f of files) {
  // Include the optional letter suffix so 00014b !== 00014
  const version = f.match(/^\d{5}[a-z]?/)[0]
  if (versionsSeen.has(version)) {
    console.error(`✗  Duplicate migration version ${version}: ${versionsSeen.get(version)} and ${f}`)
    failures++
  } else {
    versionsSeen.set(version, f)
  }
}

// ── Parse all migration SQL ───────────────────────────────────────────────────
// Collect: tables with RLS, and policy creation order.
const rlsTables = new Set()
// Map of policy name → filename where it was first created
const policyFirstSeen = new Map()

for (const filename of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8")
  const lines = sql.split("\n")

  // ENABLE ROW LEVEL SECURITY
  for (const line of lines) {
    const m = line.match(/ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i)
    if (m) rlsTables.add(m[1])
  }

  // Policy duplicate detection
  // Track which policies this file drops before creating
  const droppedInThisFile = new Set()
  for (let i = 0; i < lines.length; i++) {
    const dropM = lines[i].match(/DROP\s+POLICY\s+IF\s+EXISTS\s+"([^"]+)"/i)
    if (dropM) droppedInThisFile.add(dropM[1])

    const createM = lines[i].match(/CREATE\s+POLICY\s+"([^"]+)"/i)
    if (createM) {
      const name = createM[1]
      if (policyFirstSeen.has(name) && !droppedInThisFile.has(name)) {
        // Check whether this line is inside a DO $$ … IF NOT EXISTS … END $$ block
        // (safe guard via pg_policies check — not a duplicate)
        const blockStart = Math.max(0, i - 40)
        const context = lines.slice(blockStart, i).join("\n")
        if (!context.includes("NOT EXISTS") || !context.includes(name)) {
          console.error(
            `✗  Duplicate policy without DROP IF EXISTS guard: "${name}"\n` +
            `     First created in: ${policyFirstSeen.get(name)}\n` +
            `     Created again in: ${filename}:${i + 1}`
          )
          failures++
        }
      } else if (!policyFirstSeen.has(name)) {
        policyFirstSeen.set(name, filename)
      }
    }
  }
}

// ── Check 3: expected tables have RLS ────────────────────────────────────────
for (const table of EXPECTED_TABLES_WITH_RLS) {
  if (!rlsTables.has(table)) {
    console.error(`✗  No ENABLE ROW LEVEL SECURITY found for table: ${table}`)
    failures++
  }
}

// ── Result ────────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n✗  ${failures} assertion(s) failed.`)
  process.exit(1)
}

console.log(`✓  ${files.length} migration files checked`)
console.log(`✓  ${EXPECTED_TABLES_WITH_RLS.length} expected tables have RLS enabled`)
console.log(`✓  ${policyFirstSeen.size} unique policies — no unguarded duplicates`)
