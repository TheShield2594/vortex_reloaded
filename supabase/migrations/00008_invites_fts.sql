-- ============================================================
-- Multiple Invite Links  (replaces servers.invite_code single-field approach)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invites (
  code         TEXT        PRIMARY KEY,
  server_id    UUID        NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id   UUID        REFERENCES public.channels(id) ON DELETE SET NULL,
  created_by   UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  max_uses     INT,                     -- NULL = unlimited
  uses         INT         NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ,            -- NULL = never
  temporary    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invites_server_idx ON public.invites(server_id);

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- Anyone can read invite info (needed for invite landing page, even unauthenticated)
CREATE POLICY "anyone can view invites"
  ON public.invites FOR SELECT
  USING (TRUE);

-- Only server members can create invites
CREATE POLICY "server members can create invites"
  ON public.invites FOR INSERT
  WITH CHECK (public.is_server_member(server_id));

-- Server owner / creator can delete
CREATE POLICY "admins can delete invites"
  ON public.invites FOR DELETE
  USING (created_by = auth.uid() OR public.is_server_owner(server_id));

-- Increment use count (done via service-role from API)
CREATE POLICY "system can update invites"
  ON public.invites FOR UPDATE
  USING (TRUE);

-- Seed existing servers with an invite in the new table
-- (Run only if servers have an invite_code and the invites table is empty)
INSERT INTO public.invites (code, server_id, created_by)
SELECT invite_code, id, owner_id
FROM public.servers
WHERE invite_code IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.invites WHERE invites.server_id = servers.id)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Full-Text Search on messages
-- ============================================================
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

-- Populate existing rows
UPDATE public.messages
SET search_vector = to_tsvector('english', coalesce(content, ''))
WHERE search_vector IS NULL;

-- GIN index for fast FTS queries
CREATE INDEX IF NOT EXISTS messages_fts_idx
  ON public.messages USING gin(search_vector);

-- Trigger to keep search_vector up to date on insert/update
CREATE OR REPLACE FUNCTION public.messages_search_vector_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.content, ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_search_vector_trigger ON public.messages;
CREATE TRIGGER messages_search_vector_trigger
  BEFORE INSERT OR UPDATE OF content ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_search_vector_update();
