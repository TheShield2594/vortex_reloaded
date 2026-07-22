import { and, eq, lte, sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { dmChannelKeys } from "../schema/dm"

/**
 * Port of `prune_dm_channel_keys` / `dm_channel_keys_prune_trigger`
 * (supabase/migrations/00030_dm_e2ee.sql): after any write batch to
 * `dm_channel_keys`, keep only the `keepVersions` most recent key versions
 * per DM channel, deleting older ones.
 *
 * The Postgres original ran off a *statement-level*
 * `AFTER INSERT/UPDATE ... REFERENCING NEW TABLE` trigger, which has no
 * SQLite equivalent — call this once per write batch (not once per row)
 * with the set of distinct `dmChannelId`s the batch touched, same as the
 * Postgres trigger did internally via `SELECT DISTINCT dm_channel_id FROM
 * new_rows`.
 */
export function pruneDmChannelKeys(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: BetterSQLite3Database<any>,
  dmChannelIds: Iterable<string>,
  keepVersions = 5
): void {
  const keep = Math.max(keepVersions, 1)

  for (const dmChannelId of new Set(dmChannelIds)) {
    const [row] = db
      .select({ maxVersion: sql<number | null>`max(${dmChannelKeys.keyVersion})` })
      .from(dmChannelKeys)
      .where(eq(dmChannelKeys.dmChannelId, dmChannelId))
      .all()

    if (row?.maxVersion == null) continue

    db.delete(dmChannelKeys)
      .where(
        and(eq(dmChannelKeys.dmChannelId, dmChannelId), lte(dmChannelKeys.keyVersion, row.maxVersion - keep))
      )
      .run()
  }
}
