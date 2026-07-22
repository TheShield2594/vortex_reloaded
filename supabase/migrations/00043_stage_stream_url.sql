-- Migration: stage channel stream URL
-- Adds an optional YouTube stream URL for stage channels.

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS stream_url TEXT;

COMMENT ON COLUMN public.channels.stream_url IS
  'Optional external stream URL for stage channels (currently YouTube links).';
