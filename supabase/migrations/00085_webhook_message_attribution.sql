-- ============================================================
-- Webhook message attribution
--
-- Adds a nullable webhook_id FK to the messages table so webhook
-- messages are attributed to the webhook identity rather than
-- being disguised as server-owner messages.
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS webhook_id UUID REFERENCES public.webhooks(id) ON DELETE SET NULL;

-- Index for querying messages by webhook
CREATE INDEX IF NOT EXISTS idx_messages_webhook_id
  ON public.messages (webhook_id)
  WHERE webhook_id IS NOT NULL;

-- Allow the system bot / service role to set webhook_id
COMMENT ON COLUMN public.messages.webhook_id IS
  'Non-null when this message was posted by a webhook. Used for BOT badge rendering and attribution.';
