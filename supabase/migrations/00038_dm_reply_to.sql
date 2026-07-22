-- Migration: Add reply_to_id to direct_messages for threaded replies
-- Allows DM messages to reference a parent message in the same channel.

ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES public.direct_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_direct_messages_reply_to_id
  ON public.direct_messages(reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- Rollback:
-- DROP INDEX IF EXISTS idx_direct_messages_reply_to_id;
-- ALTER TABLE public.direct_messages DROP COLUMN IF EXISTS reply_to_id;
