-- Migration: Channel guidelines field
-- The forum_guidelines column already exists from 00014_channel_types.sql.
-- This migration adds a proper length constraint to enforce the 2000-character limit.

ALTER TABLE public.channels
  ADD CONSTRAINT channels_forum_guidelines_length
  CHECK (forum_guidelines IS NULL OR length(forum_guidelines) <= 2000);

-- Rollback:
-- ALTER TABLE public.channels DROP CONSTRAINT IF EXISTS channels_forum_guidelines_length;
