-- Composite index on direct_messages(dm_channel_id, created_at DESC)
-- Supports paginated message loading per DM channel without full table scans.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_direct_messages_dm_channel_id_created
  ON public.direct_messages(dm_channel_id, created_at DESC);
