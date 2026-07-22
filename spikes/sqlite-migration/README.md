# SQLite migration spike (issue #4)

Standalone scripts proving out two patterns before the full Drizzle schema
migration (#6) starts. Not part of any npm workspace — has its own
`package.json` so it doesn't touch the app's dependency tree.

Findings write-up: `docs/sqlite-migration-fts5-transactions-spike.md`.

## Setup

```bash
cd spikes/sqlite-migration
npm install
```

## Run

```bash
node fts5-direct-messages.mjs   # FTS5 virtual table + sync triggers + MATCH query
node device-key-race.mjs        # device-key cap-then-insert race + two fixes
```

Both scripts assert their own expectations with `node:assert` and exit
non-zero on failure — there's no separate test runner.
