ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_nonce TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_channel_author_client_nonce
  ON public.messages(channel_id, author_id, client_nonce)
  WHERE client_nonce IS NOT NULL;
