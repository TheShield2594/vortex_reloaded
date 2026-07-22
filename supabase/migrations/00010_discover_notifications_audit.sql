-- ============================================================
-- Server Discovery: make servers optionally public
-- ============================================================
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS member_count INTEGER NOT NULL DEFAULT 0;

-- Populate member_count from existing data
UPDATE public.servers s
SET member_count = (
  SELECT COUNT(*) FROM public.server_members sm WHERE sm.server_id = s.id
);

-- Trigger to keep member_count accurate
CREATE OR REPLACE FUNCTION public.sync_member_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.servers SET member_count = member_count + 1 WHERE id = NEW.server_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.servers SET member_count = GREATEST(0, member_count - 1) WHERE id = OLD.server_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_count ON public.server_members;
CREATE TRIGGER trg_member_count
  AFTER INSERT OR DELETE ON public.server_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_member_count();

CREATE INDEX IF NOT EXISTS idx_servers_public ON public.servers(is_public) WHERE is_public = TRUE;

-- ============================================================
-- Notification Settings (per-user, per-server or per-channel)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_settings (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  server_id    UUID        REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id   UUID        REFERENCES public.channels(id) ON DELETE CASCADE,
  -- mode: 'all' | 'mentions' | 'muted'
  mode         TEXT        NOT NULL DEFAULT 'all' CHECK (mode IN ('all', 'mentions', 'muted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Either server_id or channel_id must be set, not both
  UNIQUE (user_id, server_id),
  UNIQUE (user_id, channel_id),
  CHECK (
    (server_id IS NOT NULL AND channel_id IS NULL) OR
    (server_id IS NULL AND channel_id IS NOT NULL)
  )
);

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can manage own notification settings"
  ON public.notification_settings FOR ALL
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_notif_settings_user ON public.notification_settings(user_id);

-- ============================================================
-- Audit Log — RLS (table already exists from 00007)
-- ============================================================
-- Ensure owners can view the audit log for their servers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'server owners can view audit logs'
  ) THEN
    CREATE POLICY "server owners can view audit logs"
      ON public.audit_logs FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.servers WHERE id = server_id AND owner_id = auth.uid()
        )
      );
  END IF;
END $$;
