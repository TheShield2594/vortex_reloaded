-- Activity log: lightweight audit trail shown in the "Recent Activity" profile section
-- Events are written by triggers / API handlers and culled to 50 rows per user

CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN (
    'message_posted',
    'file_uploaded',
    'server_joined',
    'reaction_added',
    'channel_created'
  )),
  -- Human-readable summary rendered in the feed, e.g. "Posted in #vortex-dev"
  summary       TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 200),
  -- Optional reference to the resource (channel id, server id, message id …)
  ref_id        UUID,
  ref_type      TEXT CHECK (ref_type IN ('channel', 'server', 'message', 'file', NULL)),
  -- Optional display label for the referenced resource, e.g. "#vortex-dev"
  ref_label     TEXT CHECK (ref_label IS NULL OR length(ref_label) <= 80),
  -- Optional navigation URL relative to the app root
  ref_url       TEXT CHECK (ref_url IS NULL OR length(ref_url) <= 500),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for per-user feed queries (newest first)
CREATE INDEX IF NOT EXISTS idx_user_activity_log_user_created
  ON public.user_activity_log (user_id, created_at DESC);

-- RLS
ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;

-- Visibility is enforced at the API layer using users.activity_visibility.
-- The RLS policy allows the owner to always read their own activity,
-- and allows other authenticated users to read (the API will filter by visibility).
CREATE POLICY "activity_log_select_authenticated"
  ON public.user_activity_log FOR SELECT
  TO authenticated
  USING (true);

-- Only server-side (service role) writes activity entries; users cannot insert their own
CREATE POLICY "activity_log_insert_service"
  ON public.user_activity_log FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Only the owner or service role can delete
CREATE POLICY "activity_log_delete_owner"
  ON public.user_activity_log FOR DELETE
  USING (user_id = auth.uid());

-- Auto-prune trigger: keep at most 50 activity rows per user
CREATE OR REPLACE FUNCTION public.prune_activity_log()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.user_activity_log
  WHERE user_id = NEW.user_id
    AND id NOT IN (
      SELECT id FROM public.user_activity_log
      WHERE user_id = NEW.user_id
      ORDER BY created_at DESC
      LIMIT 50
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prune_activity_log
  AFTER INSERT ON public.user_activity_log
  FOR EACH ROW EXECUTE FUNCTION public.prune_activity_log();

COMMENT ON TABLE public.user_activity_log IS
  'Recent activity events shown on user profiles; capped at 50 rows per user via trigger';
