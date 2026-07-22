-- Migration: Temporary Channels
-- Channels can optionally have an expiry time (expires_at).
-- When expires_at is set and in the past, the channel should be deleted.
-- A Postgres function + cron-compatible helper are provided for cleanup.

-- 1. Add expires_at column to channels
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 2. Index for efficient expiry queries
CREATE INDEX IF NOT EXISTS idx_channels_expires_at
  ON public.channels(expires_at)
  WHERE expires_at IS NOT NULL;

-- 3. Function: delete all expired channels and return count of deleted rows
CREATE OR REPLACE FUNCTION public.delete_expired_channels()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM public.channels
    WHERE expires_at IS NOT NULL
      AND expires_at <= NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$;

-- Restrict execute to service_role only (function is SECURITY DEFINER)
REVOKE EXECUTE ON FUNCTION public.delete_expired_channels() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_expired_channels() TO service_role;

-- Notes:
-- - expires_at = NULL means the channel is permanent (default behaviour).
-- - The cleanup function is called by the /api/channels/cleanup endpoint,
--   which should be invoked periodically (e.g. every minute via Coolify cron
--   or an external cron service hitting the endpoint with the CRON_SECRET header).
-- - Deleting the channel cascades to messages, channel_permissions, etc.
--   via ON DELETE CASCADE on the foreign keys defined in the initial schema.
