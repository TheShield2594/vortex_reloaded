-- Server-level Gemini API key
-- Each server owner provides their own Gemini API key for AI features
-- (channel summarization, voice post-call summaries).
-- AI features are unavailable for a server until its owner sets a key.
--
-- Stored in a dedicated table with owner-only RLS so members cannot
-- read the key via direct Supabase queries.

CREATE TABLE IF NOT EXISTS public.server_secrets (
  server_id UUID PRIMARY KEY REFERENCES public.servers(id) ON DELETE CASCADE,
  gemini_api_key TEXT DEFAULT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.server_secrets ENABLE ROW LEVEL SECURITY;

-- Only the server owner can read or write secrets
CREATE POLICY "Server owners can view their server secrets"
  ON public.server_secrets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = server_secrets.server_id
        AND servers.owner_id = auth.uid()
    )
  );

CREATE POLICY "Server owners can upsert their server secrets"
  ON public.server_secrets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = server_secrets.server_id
        AND servers.owner_id = auth.uid()
    )
  );

CREATE POLICY "Server owners can update their server secrets"
  ON public.server_secrets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = server_secrets.server_id
        AND servers.owner_id = auth.uid()
    )
  );

CREATE POLICY "Server owners can delete their server secrets"
  ON public.server_secrets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = server_secrets.server_id
        AND servers.owner_id = auth.uid()
    )
  );

COMMENT ON TABLE public.server_secrets IS
  'Owner-only server secrets. RLS restricts access to the server owner.';
