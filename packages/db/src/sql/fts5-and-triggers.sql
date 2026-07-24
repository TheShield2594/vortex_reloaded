-- Hand-written SQL for schema objects Drizzle's SQLite schema builder can't
-- declare: an FTS5 virtual table and a handful of row-level triggers that
-- port real Postgres trigger logic (see supabase/migrations/00009_group_dms.sql,
-- 00030_dm_e2ee.sql, 00041/00042_hardening_policy_fixes*.sql,
-- 00058_user_activity_log.sql, 00089_dm_full_text_search.sql, and
-- docs/sqlite-migration-fts5-transactions-spike.md, issue #4's spike).
--
-- Apply this AFTER the drizzle-kit-generated table migrations (it assumes
-- direct_messages, dm_channels, and dm_channel_members already exist) —
-- see src/migrate.ts.

-- ============================================================================
-- 1. direct_messages full-text search (replaces the dropped `search_vector`
--    tsvector column + GIN index + BEFORE INSERT/UPDATE trigger from
--    00089_dm_full_text_search.sql). External-content FTS5 table keyed off
--    direct_messages' implicit rowid (kept even though `id` is a TEXT PK,
--    since the table isn't declared WITHOUT ROWID).
-- ============================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS direct_messages_fts USING fts5(
  content,
  content='direct_messages',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS direct_messages_fts_ai
AFTER INSERT ON direct_messages
BEGIN
  INSERT INTO direct_messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS direct_messages_fts_ad
AFTER DELETE ON direct_messages
BEGIN
  INSERT INTO direct_messages_fts(direct_messages_fts, rowid, content)
  VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS direct_messages_fts_au
AFTER UPDATE OF content ON direct_messages
BEGIN
  INSERT INTO direct_messages_fts(direct_messages_fts, rowid, content)
  VALUES ('delete', old.rowid, old.content);
  INSERT INTO direct_messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Query pattern (see docs/sqlite-migration-fts5-transactions-spike.md):
--   SELECT dm.id, dm.content, bm25(direct_messages_fts) AS rank
--   FROM direct_messages_fts
--   JOIN direct_messages dm ON dm.rowid = direct_messages_fts.rowid
--   WHERE direct_messages_fts MATCH ? AND dm.deleted_at IS NULL
--   ORDER BY rank

-- ============================================================================
-- 2. dm_message_bump_trigger (00009_group_dms.sql) — bump dm_channels.updated_at
--    on every new DM, used for conversation-list sort order.
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS dm_message_bump_trigger
AFTER INSERT ON direct_messages
WHEN NEW.dm_channel_id IS NOT NULL
BEGIN
  UPDATE dm_channels
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.dm_channel_id;
END;

-- ============================================================================
-- 3. trg_dm_reply_same_channel (00041/00042_hardening_policy_fixes*.sql) —
--    reject a reply whose reply_to_id points at a message in a different
--    DM channel. Postgres expressed this as one BEFORE INSERT OR UPDATE
--    trigger; SQLite needs two (no combined INSERT-OR-UPDATE trigger form).
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS trg_dm_reply_same_channel_insert
BEFORE INSERT ON direct_messages
WHEN NEW.reply_to_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'reply_to_id must reference a message in the same DM channel')
  WHERE NOT EXISTS (
    SELECT 1 FROM direct_messages
    WHERE id = NEW.reply_to_id AND dm_channel_id IS NEW.dm_channel_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_dm_reply_same_channel_update
BEFORE UPDATE OF reply_to_id, dm_channel_id ON direct_messages
WHEN NEW.reply_to_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'reply_to_id must reference a message in the same DM channel')
  WHERE NOT EXISTS (
    SELECT 1 FROM direct_messages
    WHERE id = NEW.reply_to_id AND dm_channel_id IS NEW.dm_channel_id
  );
END;

-- ============================================================================
-- 4. dm_channel_rotate_on_member_change (00030_dm_e2ee.sql) — bump the key
--    version/membership epoch/updated_at on an encrypted channel whenever
--    its membership changes (key rotation on add/remove).
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS dm_rotate_on_member_insert
AFTER INSERT ON dm_channel_members
WHEN (SELECT is_encrypted FROM dm_channels WHERE id = NEW.dm_channel_id) = 1
BEGIN
  UPDATE dm_channels
  SET encryption_key_version = encryption_key_version + 1,
      encryption_membership_epoch = encryption_membership_epoch + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.dm_channel_id;
END;

CREATE TRIGGER IF NOT EXISTS dm_rotate_on_member_delete
AFTER DELETE ON dm_channel_members
WHEN (SELECT is_encrypted FROM dm_channels WHERE id = OLD.dm_channel_id) = 1
BEGIN
  UPDATE dm_channels
  SET encryption_key_version = encryption_key_version + 1,
      encryption_membership_epoch = encryption_membership_epoch + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.dm_channel_id;
END;

-- ============================================================================
-- 5. trg_prune_activity_log (00058_user_activity_log.sql) — cap each user's
--    activity log at their 50 most recent rows, deleting older ones on
--    every insert.
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS trg_prune_activity_log
AFTER INSERT ON user_activity_log
BEGIN
  DELETE FROM user_activity_log
  WHERE user_id = NEW.user_id
    AND id NOT IN (
      SELECT id FROM user_activity_log
      WHERE user_id = NEW.user_id
      ORDER BY created_at DESC
      LIMIT 50
    );
END;
