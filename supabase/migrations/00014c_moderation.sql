-- Migration: Server verification, member screening, timeouts, and AutoMod rules
-- Adds server-level moderation settings and the supporting tables/functions.
--
-- Depends on: 00014b_expand_permissions.sql (timeout_until column)

-- ── Server-level moderation settings ─────────────────────────────────────────
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS verification_level          SMALLINT NOT NULL DEFAULT 0
    CHECK (verification_level BETWEEN 0 AND 4),
  ADD COLUMN IF NOT EXISTS explicit_content_filter     SMALLINT NOT NULL DEFAULT 0
    CHECK (explicit_content_filter BETWEEN 0 AND 2),
  ADD COLUMN IF NOT EXISTS default_message_notifications SMALLINT NOT NULL DEFAULT 0
    CHECK (default_message_notifications BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS screening_enabled           BOOLEAN  NOT NULL DEFAULT FALSE;

-- ── Shared updated_at trigger ─────────────────────────────────────────────────
-- Used by screening_configs and automod_rules below.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ── Screening configs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.screening_configs (
  server_id        UUID PRIMARY KEY REFERENCES public.servers(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT 'Server Rules',
  description      TEXT,
  rules_text       TEXT NOT NULL DEFAULT '',
  require_acceptance BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_screening_configs_updated_at
  BEFORE UPDATE ON public.screening_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.screening_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "server members can view screening config"
  ON public.screening_configs FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "server owner manages screening config"
  ON public.screening_configs FOR ALL
  USING (public.is_server_owner(server_id));

-- ── Member screening acceptance ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_screening (
  server_id    UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (server_id, user_id)
);

ALTER TABLE public.member_screening ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view own screening status"
  ON public.member_screening FOR SELECT
  USING (user_id = auth.uid() OR public.is_server_owner(server_id));

CREATE POLICY "users can accept screening"
  ON public.member_screening FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.is_server_member(server_id));

CREATE POLICY "server owner can manage screening records"
  ON public.member_screening FOR ALL
  USING (public.is_server_owner(server_id));

-- ── Member timeouts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_timeouts (
  server_id        UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  timed_out_until  TIMESTAMPTZ NOT NULL,
  moderator_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (server_id, user_id)
);

ALTER TABLE public.member_timeouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "server members can view timeouts"
  ON public.member_timeouts FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "system manages timeouts"
  ON public.member_timeouts FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.servers
      WHERE id = member_timeouts.server_id
        AND owner_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_member_timeouts_expiry
  ON public.member_timeouts(server_id, timed_out_until);

-- ── AutoMod rules ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.automod_rules (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id    UUID        NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  trigger_type TEXT        NOT NULL CHECK (trigger_type IN ('keyword_filter', 'mention_spam', 'link_spam')),
  config       JSONB       NOT NULL DEFAULT '{}',
  actions      JSONB       NOT NULL DEFAULT '[]',
  enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_automod_rules_updated_at
  BEFORE UPDATE ON public.automod_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.automod_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "server members can view automod rules"
  ON public.automod_rules FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "server owner manages automod rules"
  ON public.automod_rules FOR ALL
  USING (public.is_server_owner(server_id));

CREATE INDEX IF NOT EXISTS idx_automod_rules_server
  ON public.automod_rules(server_id) WHERE enabled = TRUE;

-- ── Helper functions ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_member_timed_out(
  p_server_id UUID,
  p_user_id   UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.member_timeouts mt
    WHERE mt.server_id = p_server_id
      AND mt.user_id   = p_user_id
      AND mt.timed_out_until > NOW()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_passed_screening(
  p_server_id UUID,
  p_user_id   UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN NOT (SELECT COALESCE(screening_enabled, FALSE) FROM public.servers WHERE id = p_server_id) THEN TRUE
      ELSE EXISTS (
        SELECT 1 FROM public.member_screening
        WHERE server_id = p_server_id AND user_id = p_user_id
      )
    END;
$$;

-- set_member_timeout: Moderator-only RPC to apply or remove a member timeout.
-- Also writes the denormalised timeout_until column on server_members (added by
-- 00014b_expand_permissions.sql) so RLS checks remain efficient.
CREATE OR REPLACE FUNCTION public.set_member_timeout(
  p_server_id     UUID,
  p_member_id     UUID,
  p_timeout_until TIMESTAMPTZ,
  p_moderator_id  UUID DEFAULT NULL,
  p_reason        TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.is_server_owner(p_server_id) OR
    public.has_permission(p_server_id, 16384)
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege'
      USING ERRCODE = '42501',
            DETAIL  = 'MODERATE_MEMBERS permission required to set timeouts';
  END IF;

  IF p_timeout_until IS NULL THEN
    DELETE FROM public.member_timeouts
    WHERE server_id = p_server_id
      AND user_id   = p_member_id;
  ELSE
    INSERT INTO public.member_timeouts
      (server_id, user_id, timed_out_until, moderator_id, reason, created_at)
    VALUES
      (p_server_id, p_member_id, p_timeout_until,
       COALESCE(p_moderator_id, auth.uid()), p_reason, NOW())
    ON CONFLICT (server_id, user_id) DO UPDATE SET
      timed_out_until = EXCLUDED.timed_out_until,
      moderator_id    = EXCLUDED.moderator_id,
      reason          = EXCLUDED.reason;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_member_timeout TO authenticated;
