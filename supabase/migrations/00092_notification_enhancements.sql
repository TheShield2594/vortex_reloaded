-- Migration 00091: Notification enhancements
-- #607: suppress @everyone and @role mention toggles
-- #608: last_online_at for offline users
-- #609: test notification rate limiting (uses existing rate_limits infra)

-- Add suppress toggles to user_notification_preferences
ALTER TABLE user_notification_preferences
  ADD COLUMN IF NOT EXISTS suppress_everyone BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suppress_role_mentions BOOLEAN NOT NULL DEFAULT FALSE;

-- Add last_online_at to users table for "last seen" display
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_online_at TIMESTAMPTZ;

-- Index for efficient queries on last_online_at (only for users who have gone offline)
CREATE INDEX IF NOT EXISTS idx_users_last_online_at
  ON users (last_online_at)
  WHERE last_online_at IS NOT NULL;
