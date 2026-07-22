-- ============================================================
-- Reports table — user-facing content/user reporting pipeline
-- ============================================================
-- status workflow: pending → reviewed → resolved / dismissed

CREATE TYPE public.report_reason AS ENUM (
  'spam',
  'harassment',
  'inappropriate_content',
  'other'
);

CREATE TYPE public.report_status AS ENUM (
  'pending',
  'reviewed',
  'resolved',
  'dismissed'
);

CREATE TABLE IF NOT EXISTS public.reports (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID            NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reported_user_id UUID           NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reported_message_id UUID        REFERENCES public.messages(id) ON DELETE SET NULL,
  server_id       UUID            REFERENCES public.servers(id) ON DELETE CASCADE,
  reason          public.report_reason NOT NULL,
  description     TEXT            CHECK (char_length(description) <= 1000),
  status          public.report_status NOT NULL DEFAULT 'pending',
  reviewed_by     UUID            REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reports_server_status_idx
  ON public.reports(server_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS reports_reporter_idx
  ON public.reports(reporter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS reports_reported_user_idx
  ON public.reports(reported_user_id, created_at DESC);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Reporters can view their own reports
CREATE POLICY "reporters can view own reports"
  ON public.reports FOR SELECT
  USING (auth.uid() = reporter_id);

-- Server members can view reports in their server (moderator filtering done at API level)
CREATE POLICY "server members can view server reports"
  ON public.reports FOR SELECT
  USING (server_id IS NOT NULL AND public.is_server_member(server_id));

-- Authenticated users can create reports
CREATE POLICY "authenticated users can create reports"
  ON public.reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

-- Server owners can update report status (moderator access enforced at API level)
CREATE POLICY "server owners can update reports"
  ON public.reports FOR UPDATE
  USING (server_id IS NOT NULL AND public.is_server_owner(server_id));

-- System can update reports (for API-level moderator access)
CREATE POLICY "system can update reports"
  ON public.reports FOR UPDATE
  USING (TRUE);

-- ============================================================
-- Rollback
-- ============================================================
-- DROP TABLE IF EXISTS public.reports;
-- DROP TYPE IF EXISTS public.report_status;
-- DROP TYPE IF EXISTS public.report_reason;
