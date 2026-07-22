-- Add heartbeat column for server-side presence validation.
-- The client sends a heartbeat every 30s; a cron job marks users with stale
-- heartbeats as offline. This replaces the unreliable sendBeacon-on-close
-- approach and mirrors how Fluxer's gateway detects disconnections.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

-- Index for the stale-presence cron query: find users whose heartbeat is older
-- than the threshold AND who are still marked as online/idle.
CREATE INDEX IF NOT EXISTS idx_users_presence_heartbeat
  ON public.users (last_heartbeat_at)
  WHERE status IN ('online', 'idle', 'dnd');
