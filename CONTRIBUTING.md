# Contributing to VortexChat

## Prerequisites

- Node.js 22+, npm 10+ (this monorepo uses **npm** workspaces — do not use pnpm or yarn)
- [Supabase CLI](https://supabase.com/docs/guides/cli) for running migrations locally
- Docker (used by Supabase CLI for the local Postgres instance)

---

## Branch naming

CI runs on `main`, `master`, and any branch matching `claude/**`.

```
claude/<short-description>-<id>
```

Examples:

```
claude/fix-rls-timeout-policy-9x3kA
claude/add-forum-channel-type-4z7mB
```

- Use kebab-case for the description
- The trailing ID is appended automatically by the Claude Code agent; human-authored
  branches may omit it
- Feature branches that do **not** match `claude/**` will skip CI — open a PR to
  `main` to trigger the full pipeline

---

## Commit message format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>
```

| Type | When to use |
|------|-------------|
| `feat` | New user-facing feature |
| `fix` | Bug fix |
| `perf` | Performance improvement |
| `refactor` | Code change with no functional effect |
| `test` | Adding or updating tests |
| `ci` | CI/CD changes |
| `docs` | Documentation only |
| `chore` | Dependency bumps, build tooling |

Scope is optional but encouraged — use the workspace or domain name:
`feat(threads)`, `fix(rls)`, `ci(migrations)`.

Keep the summary under 72 characters and written in the imperative mood
("add timeout column", not "added" or "adds").

---

## Running migrations locally

### 1. Start the local Supabase stack

```bash
npx supabase start
```

This starts a local Postgres instance, Auth service, and Storage emulator.
The connection details are printed at the end — copy the `DB URL` for `psql` access.

### 2. Apply all migrations

```bash
npx supabase db push
```

Supabase CLI applies every file under `supabase/migrations/` in **alphabetical order**.
The naming convention ensures correct order:

```
00001_initial_schema.sql
00014_channel_types.sql       ← channel type constraint
00014b_expand_permissions.sql ← timeout column + permission bits
00014c_moderation.sql         ← screening, timeouts, automod
00014d_threads.sql            ← threads, thread_members, read states
00015_system_bot.sql
…
```

Files with the same numeric prefix use a letter suffix (`b`, `c`, `d`) to
establish a dependency order within the same logical group. **Never reuse a
prefix** — always increment or append a suffix.

### 3. Verify migrations

```bash
npm run test:migration-smoke
```

This static analysis script (`scripts/migration-smoke-test.mjs`) checks that:

- Every table with user data has RLS enabled
- Every `SECURITY DEFINER` function sets `search_path`
- No migration references a table created by a later migration

### 4. Writing a new migration

1. Choose the next available sequential prefix (check `supabase/migrations/` for the highest existing number).
2. Name the file `<prefix>_<slug>.sql`, e.g. `00054_add_poll_reactions.sql`.
3. Make every statement idempotent where possible:
   - `CREATE TABLE IF NOT EXISTS`
   - `ALTER TABLE … ADD COLUMN IF NOT EXISTS`
   - `CREATE OR REPLACE FUNCTION`
   - Wrap `CREATE POLICY` in a `DO $$ … END $$` block that checks `pg_policies` first (see existing migrations for the pattern)
4. Enable RLS on every new table that stores user data:
   ```sql
   ALTER TABLE public.your_table ENABLE ROW LEVEL SECURITY;
   ```
5. Set `search_path = ''` on every `SECURITY DEFINER` function:
   ```sql
   CREATE OR REPLACE FUNCTION public.my_fn(…)
   RETURNS … LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = ''   -- prevents search_path injection
   AS $$ … $$;
   ```
6. Run `npm run test:migration-smoke` before opening a PR.

### 5. Resetting to a clean state

```bash
npx supabase db reset   # drops and recreates the local DB, re-applies all migrations
```

---

## Permissions

Permission constants live in `packages/shared/src/index.ts`.
**Never hardcode raw bitmask integers in API routes or components** — always
import from `@vortex/shared`:

```typescript
import { PERMISSIONS } from "@vortex/shared"

// ✓ correct
if (memberPermissions & PERMISSIONS.MODERATE_MEMBERS) { … }

// ✗ wrong — magic number, breaks if the constant is renumbered
if (memberPermissions & 16384) { … }
```

---

## API documentation

A machine-readable OpenAPI 3.1 spec is served at `GET /api/docs` (authenticated).
When you add a new API route, add the corresponding path entry to the `OPENAPI_SPEC`
constant in `apps/web/app/api/docs/route.ts`.

---

## Running the full test suite locally

```bash
# Unit + integration tests (Vitest)
cd apps/web && npm test

# Type check all workspaces
npm run type-check

# Lint all workspaces
npm run lint

# Migration smoke test
npm run test:migration-smoke
```
