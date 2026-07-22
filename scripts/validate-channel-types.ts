/**
 * validate-channel-types.ts
 *
 * Validation script for the new channel type additions.
 * Run with: npx tsx scripts/validate-channel-types.ts
 *
 * Checks that:
 * 1. All expected channel types are defined in shared types.
 * 2. The DB type definitions include all new types + metadata fields.
 * 3. The migration file exists and covers all new types.
 */

import { readFileSync } from "fs"
import { join } from "path"
import type { ChannelType } from "../packages/shared/src/index"

const ROOT = join(__dirname, "..")

// ─── 1. Shared ChannelType includes all expected types ───────────────────────
const EXPECTED_CHANNEL_TYPES: ChannelType[] = [
  "text",
  "voice",
  "category",
  "forum",
  "stage",
  "announcement",
  "media",
]

const sharedSrc = readFileSync(join(ROOT, "packages/shared/src/index.ts"), "utf8")
let allTypesFound = true
for (const t of EXPECTED_CHANNEL_TYPES) {
  if (!sharedSrc.includes(`'${t}'`)) {
    console.error(`✗ Missing channel type '${t}' in packages/shared/src/index.ts`)
    allTypesFound = false
  }
}
if (allTypesFound) {
  console.log(`✓ All ${EXPECTED_CHANNEL_TYPES.length} channel types present in shared types`)
}

// ─── 2. DB types include all channel types + new metadata fields ─────────────
const dbTypes = readFileSync(join(ROOT, "apps/web/types/database.ts"), "utf8")
let dbTypesOk = true

for (const t of EXPECTED_CHANNEL_TYPES) {
  if (!dbTypes.includes(`'${t}'`)) {
    console.error(`✗ Missing channel type '${t}' in apps/web/types/database.ts`)
    dbTypesOk = false
  }
}

const requiredFields = ["forum_guidelines", "last_post_at"]
for (const field of requiredFields) {
  if (!dbTypes.includes(field)) {
    console.error(`✗ Missing metadata field '${field}' in apps/web/types/database.ts`)
    dbTypesOk = false
  }
}

if (dbTypesOk) {
  console.log(`✓ DB types include all channel types and metadata fields`)
}

// ─── 3. Migration file exists and covers all new types ───────────────────────
const migrationPath = join(ROOT, "supabase/migrations/00014_channel_types.sql")
try {
  const migration = readFileSync(migrationPath, "utf8")
  const newTypes = ["forum", "stage", "announcement", "media"]
  let migrationOk = true

  for (const t of newTypes) {
    if (!migration.includes(`'${t}'`)) {
      console.error(`✗ Migration does not include type '${t}'`)
      migrationOk = false
    }
  }

  if (!migration.includes("forum_guidelines")) {
    console.error("✗ Migration missing forum_guidelines column")
    migrationOk = false
  }
  if (!migration.includes("last_post_at")) {
    console.error("✗ Migration missing last_post_at column")
    migrationOk = false
  }
  if (!migration.includes("DROP CONSTRAINT")) {
    console.error("✗ Migration does not drop old check constraint")
    migrationOk = false
  }
  if (!migration.includes("ADD CONSTRAINT")) {
    console.error("✗ Migration does not add new check constraint")
    migrationOk = false
  }

  if (migrationOk) {
    console.log(`✓ Migration file covers all new channel types and fields`)
  }
} catch {
  console.error(`✗ Migration file not found: ${migrationPath}`)
}

// ─── 4. Channel page handles all non-category types ──────────────────────────
const channelPage = readFileSync(
  join(ROOT, "apps/web/app/channels/[serverId]/[channelId]/page.tsx"),
  "utf8"
)
const newPageTypes = ["announcement", "forum", "media", "voice", "stage"]
let pageOk = true
for (const t of newPageTypes) {
  if (!channelPage.includes(`"${t}"`)) {
    console.error(`✗ Channel page does not handle type '${t}'`)
    pageOk = false
  }
}
if (pageOk) {
  console.log(`✓ Channel page handles all channel types`)
}

// ─── 5. Channel creation modal includes all new types ────────────────────────
const createModal = readFileSync(
  join(ROOT, "apps/web/components/modals/create-channel-modal.tsx"),
  "utf8"
)
const modalTypes = ["forum", "stage", "announcement", "media"]
let modalOk = true
for (const t of modalTypes) {
  if (!createModal.includes(`"${t}"`)) {
    console.error(`✗ Create channel modal missing type '${t}'`)
    modalOk = false
  }
}
if (modalOk) {
  console.log(`✓ Create channel modal includes all new types`)
}

// ─── 6. Channel components exist ─────────────────────────────────────────────
const { existsSync } = require("fs")
const components = [
  "apps/web/components/channels/announcement-channel.tsx",
  "apps/web/components/channels/forum-channel.tsx",
  "apps/web/components/channels/media-channel.tsx",
]
let componentsOk = true
for (const c of components) {
  if (!existsSync(join(ROOT, c))) {
    console.error(`✗ Missing component: ${c}`)
    componentsOk = false
  }
}
if (componentsOk) {
  console.log(`✓ All channel type components exist`)
}

// ─── Summary ─────────────────────────────────────────────────────────────────
const allOk = allTypesFound && dbTypesOk && pageOk && modalOk && componentsOk
if (allOk) {
  console.log("\n✓ All validations passed!")
  process.exit(0)
} else {
  console.log("\n✗ Some validations failed — see errors above.")
  process.exit(1)
}
