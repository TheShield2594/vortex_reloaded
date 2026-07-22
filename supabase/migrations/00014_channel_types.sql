-- Migration: Add Discord-like channel type parity
-- Extends channel type check constraint to include: forum, stage, announcement, media
-- Adds metadata fields for new channel types
--
-- Related migrations:
--   00014b_expand_permissions.sql  — server_members timeout + role permission bits
--   00014c_moderation.sql          — verification, screening, automod, timeouts
--   00014d_threads.sql             — threads, thread_members, thread_read_states

-- 1. Drop the existing type check constraint
--    PostgreSQL auto-names inline CHECK constraints as <table>_<column>_check
ALTER TABLE public.channels DROP CONSTRAINT IF EXISTS channels_type_check;

-- 2. Add updated constraint with all channel types
ALTER TABLE public.channels
  ADD CONSTRAINT channels_type_check
  CHECK (type IN ('text', 'voice', 'category', 'forum', 'stage', 'announcement', 'media'));

-- 3. Add metadata fields for new channel types
--    forum_guidelines: pinned message/rules shown at top of forum channels
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS forum_guidelines TEXT;

--    last_post_at: tracks last thread/post activity in forum channels
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS last_post_at TIMESTAMPTZ;

-- 4. Index for sorting forum channels by activity
CREATE INDEX IF NOT EXISTS idx_channels_last_post_at
  ON public.channels(last_post_at DESC NULLS LAST)
  WHERE type = 'forum';

-- Notes:
-- - Existing text/voice/category channels are unaffected (backward compatible).
-- - forum: thread-based posting channel; supports topic + forum_guidelines.
-- - stage: broadcast-style voice channel; supports topic as description.
-- - announcement: read-only (for non-mods) news/announcements channel; uses text message infrastructure.
-- - media: media-focused text channel; existing attachment infrastructure handles uploads.
