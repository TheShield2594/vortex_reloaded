-- #665: Add composite indexes for common query patterns
-- Uses CREATE INDEX CONCURRENTLY to avoid write-locking tables in production.
-- IMPORTANT: This migration must run outside a transaction block
-- (Supabase CLI handles this automatically for CONCURRENTLY statements).

-- 1. Message pagination: messages(channel_id, created_at DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_channel_created
  ON messages (channel_id, created_at DESC);

-- 2. DM pagination with soft-delete filter: direct_messages(dm_channel_id, created_at DESC, deleted_at)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_direct_messages_channel_created_deleted
  ON direct_messages (dm_channel_id, created_at DESC, deleted_at);

-- 3. Unread notification count: notifications(user_id, created_at DESC) WHERE read = FALSE
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read = FALSE;

-- 4. Thread listing: threads(parent_channel_id, archived, created_at DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_threads_channel_archived_created
  ON threads (parent_channel_id, archived, created_at DESC);

-- 5. Admin audit log filtering: audit_logs(server_id, action, created_at DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_server_action_created
  ON audit_logs (server_id, action, created_at DESC);
