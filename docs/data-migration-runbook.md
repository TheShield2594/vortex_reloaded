# Data migration runbook: Supabase Postgres → SQLite

Procedure and design notes for [#7](https://github.com/TheShield2594/vortex_reloaded/issues/7),
which builds on the frozen Drizzle schema from
[#6](https://github.com/TheShield2594/vortex_reloaded/issues/6) (`packages/db/src/schema` —
28 live tables, not the "41" in #7's original description; see that issue's
audit for why the number came down) and the Better Auth findings from
[#5](https://github.com/TheShield2594/vortex_reloaded/issues/5).

Code lives in `packages/db/src/migration/`.

## What this does and doesn't cover

This migrates the 28 tables in the frozen target schema — every `public`-schema
table in `packages/db/src/schema`, including the hand-rolled `auth_*` app
tables (`auth_challenges`, `auth_sessions`, `auth_trusted_devices`,
`auth_security_policies`, `passkey_credentials`, `recovery_codes`,
`login_risk_events`, `login_attempts`) layered on top of Supabase Auth today.

It does **not** migrate Supabase's own private `auth` schema
(`auth.users`, `auth.mfa_factors`, `auth.identities`) into a Drizzle table,
because Better Auth's own `user`/`session`/`account`/`twoFactor` tables don't
exist in this repo yet — generating them is
[#8](https://github.com/TheShield2594/vortex_reloaded/issues/8)'s job (its
Better Auth CLI-generate step, per
[`docs/better-auth-verification-spike.md`](./better-auth-verification-spike.md)).
Instead, `auth-secrets-export.ts` exports a best-effort-mapped staging file
for #8 to consume once that schema lands — see
["Auth data" below](#auth-data-the-issue-7-checklist).

## Procedure

1. **Get a Supabase Postgres connection string.** Supabase project → Database
   settings → Connection string → URI (the *direct* connection, not the
   pgBouncer pooler — a one-time bulk export doesn't want a connection pooler
   in the way). Export it as `SUPABASE_DB_URL`.
2. **Dry run first, always, against a scratch copy:**
   ```sh
   cd packages/db
   SUPABASE_DB_URL=postgres://... npm run migrate:dry-run
   ```
   This exports every table, imports into a throwaway temp SQLite file
   (never the real target — `--dry-run` ignores `--target`/`DATABASE_URL`
   entirely so this can't be pointed at a real file by mistake), and verifies
   row counts + a sample-row diff. `migrate:dry-run` (see
   `packages/db/package.json`) bakes in `--auth-secrets`, so this also runs
   the auth-secrets export — drop that flag (`tsx src/migration/run.ts
   --dry-run`) if you want a dry run that skips it. Either way it prints the
   report and deletes the temp file when done; pass `--keep` to inspect it
   afterward. Read the verification report before doing anything else — a
   mismatch here means a transform bug, not a real cutover risk yet.
3. **Real cutover**, once the dry run is clean:
   ```sh
   SUPABASE_DB_URL=postgres://... DATABASE_URL=file:/data/vortex.db npm run migrate:run -- --auth-secrets
   ```
   `import.ts` refuses to write into a file that already exists, so this only
   ever loads into a fresh database — point `DATABASE_URL` at a new path, then
   swap it into place once verified.
4. **Verify again** independently at any point (read-only, safe to re-run):
   ```sh
   npm run migrate:verify -- /data/vortex.db
   ```

Individual steps (`migrate:export`, `migrate:import`, `migrate:auth-secrets`)
are also runnable standalone — see `packages/db/package.json`.

## Type conversion mapping

Applied generically by JS runtime type in `transform.ts`, not a per-column
config — see that file's module comment for the full rationale:

| Postgres | node-pg gives us | SQLite target |
|---|---|---|
| `UUID` | string | passthrough (`TEXT`) |
| `TIMESTAMPTZ` | `Date` | `.toISOString()` → `TEXT` |
| `JSONB` / `TEXT[]` | object / array | `JSON.stringify()` → `TEXT` |
| `BOOLEAN` | boolean | `0` / `1` |
| `BIGINT` | string (precision-safe default) | `parseInt()` → `INTEGER` (see `pg-client.ts` — the only bigint columns in scope, `passkey_credentials.counter` and `{dm_,}attachments.size`, are nowhere near `Number.MAX_SAFE_INTEGER` in practice) |
| everything else | as-is | as-is |

## Import order and why triggers are safe

`import.ts` applies the plain table DDL (`schema-setup.ts`'s
`applyTableMigrations`), bulk-loads every table in FK-dependency order
(`tables.ts`), and only *then* applies `src/sql/fts5-and-triggers.sql`
(`applyFts5AndTriggers`) — every hand-written trigger in this schema
(`dm_message_bump_trigger`, `dm_rotate_on_member_*`, `trg_prune_activity_log`,
`user_device_keys_cap_before_insert`, `trg_dm_reply_same_channel_*`) lives in
that one file, none in the drizzle-kit-generated migration.

`CREATE TRIGGER` never fires retroactively for rows that already exist, so
bulk-loading `dm_channel_members`/`direct_messages` before any of these
triggers exist means none of their side effects (bumping
`dm_channels.updated_at`/`encryption_key_version` on every imported member
row, re-pruning an already-Postgres-capped activity log, etc.) corrupt the
transformed data during the load. They simply apply to real writes from that
point forward — same as on a normal running app.

That ordering also turns the FTS5 backfill (issue #7 step 4) into a genuine
one-time operation rather than something redundant with per-row trigger
inserts: `rebuildFts5Index()` runs
`INSERT INTO direct_messages_fts(rowid, content) SELECT rowid, content FROM direct_messages`
once, after every message is already loaded, then runs FTS5's built-in
`integrity-check` command (see
[`docs/sqlite-migration-fts5-transactions-spike.md`](./sqlite-migration-fts5-transactions-spike.md) —
the `rank = 1` form, not the bare form, is the one that actually diffs the
index against the content table).

## Auth data: the issue #7 checklist

- **Passwords.** `auth.users.encrypted_password` (a standard bcrypt hash) is
  copied as-is into `auth-secrets/credentials.ndjson` — no forced reset. #8's
  Credentials `authorize()` callback should verify it with `bcrypt.compare()`
  directly, not re-hash it into Better Auth's own (scrypt-based) native
  password format.
- **TOTP secrets.** `auth.mfa_factors` (`factor_type = 'totp'`) exports to
  `auth-secrets/totp-factors.ndjson`, shaped toward Better Auth's
  `twoFactor` table (`userId`, `secret`). This is unrelated to the app's own
  `recovery_codes` table (`packages/db/src/schema/auth.ts`) — that's a normal
  `public`-schema table migrated by `export.ts`/`import.ts` like everything
  else, not part of this file.
- **OAuth links.** Decision made explicitly here, per the issue's ask:
  **best-effort field mapping**, not "accept that linked-OAuth users
  re-link." `auth.identities` exports to `auth-secrets/oauth-identities.ndjson`,
  mapped toward Better Auth's `account` table shape (`userId`, `provider`,
  `providerAccountId`, `email`). Supabase's `auth.identities` doesn't expose
  OAuth access/refresh tokens through this table, so those are **not**
  carried over — only the identity link itself is, which is enough for #8 to
  pre-populate `account` rows so a returning user's next OAuth sign-in
  matches an existing linked identity instead of creating a duplicate one.

**Handling rules, enforced in code, not just convention:**
- Never logged — `auth-secrets-export.ts` only ever logs row *counts*.
- Written with `0600` permissions (owner read/write only).
- Land in `.migration-output/` (gitignored — see the top-level `.gitignore`),
  entirely separate from the normal table NDJSON dumps, and **must never be
  committed**.
- `--dry-run`'s default flow does *not* export auth secrets unless
  `--auth-secrets` is passed explicitly — a dry run for row-count/sample
  verification doesn't need to touch this data at all.

## Verification

`verify.ts` is read-only against both databases (safe to re-run anytime,
including against production after cutover) and checks three things:

1. **Row counts** per table.
2. **A sample of transformed rows** (first 25 by each table's declared
   order) diffed field-by-field against what's actually in SQLite.
3. **`direct_messages.reply_to_id` referential integrity** — the
   `trg_dm_reply_same_channel_*` triggers that normally enforce "a reply
   points at a message in the same DM channel" don't exist yet during the
   bulk-load phase (see above), so this is the check that would catch a
   transform bug here that would otherwise only surface once someone hits
   "reply" in the migrated app.
