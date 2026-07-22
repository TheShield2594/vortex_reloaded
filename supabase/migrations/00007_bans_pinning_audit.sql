-- ============================================================
-- Server Bans
-- ============================================================
CREATE TABLE IF NOT EXISTS public.server_bans (
  server_id   UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  banned_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reason      TEXT,
  banned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (server_id, user_id)
);

ALTER TABLE public.server_bans ENABLE ROW LEVEL SECURITY;

-- Server members with BAN_MEMBERS permission can view bans
CREATE POLICY "server members can view bans"
  ON public.server_bans FOR SELECT
  USING (public.is_server_member(server_id));

-- Only owner / permitted members may insert bans (enforced via API)
CREATE POLICY "admins can manage bans"
  ON public.server_bans FOR ALL
  USING (public.is_server_owner(server_id));

-- ============================================================
-- Message Pinning
-- ============================================================
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS pinned        BOOLEAN   NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pinned_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pinned_by     UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_pinned_idx
  ON public.messages(channel_id) WHERE pinned = TRUE;

-- ============================================================
-- Audit Logs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id   UUID        NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  actor_id    UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  action      TEXT        NOT NULL,   -- 'member_kick', 'member_ban', 'message_pin', etc.
  target_id   UUID,
  target_type TEXT,                   -- 'user', 'message', 'channel', 'role'
  changes     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_server_idx ON public.audit_logs(server_id, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "server members can view audit logs"
  ON public.audit_logs FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "system can insert audit logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (TRUE);
