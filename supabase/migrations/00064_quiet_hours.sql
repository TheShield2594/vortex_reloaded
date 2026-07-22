-- ============================================================
-- Quiet hours (notification schedule) per user
-- When quiet hours are enabled, push notifications are
-- suppressed between quiet_hours_start and quiet_hours_end
-- in the user's configured timezone.
-- ============================================================

ALTER TABLE public.user_notification_preferences
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS quiet_hours_start   TIME    NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS quiet_hours_end     TIME    NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS quiet_hours_timezone TEXT   NOT NULL DEFAULT 'UTC';
