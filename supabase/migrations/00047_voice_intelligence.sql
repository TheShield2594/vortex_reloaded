-- Voice Intelligence: sessions, participants, consent, transcript segments,
-- translations, summaries, policies, and audit log.
-- RLS policies are also defined here per the plan.

-- ============================================================
-- 1. voice_call_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.voice_call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('server_channel', 'dm_call')),
  scope_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  started_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  transcription_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (transcription_mode IN ('off', 'manual_opt_in', 'server_policy_required')),
  summary_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (summary_status IN ('pending', 'ready', 'failed', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vcs_scope
  ON public.voice_call_sessions(scope_type, scope_id, started_at);
CREATE INDEX IF NOT EXISTS idx_vcs_started_by
  ON public.voice_call_sessions(started_by, started_at);

-- ============================================================
-- 2. voice_call_participants
-- ============================================================
CREATE TABLE IF NOT EXISTS public.voice_call_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.voice_call_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  consent_transcription BOOLEAN NOT NULL DEFAULT FALSE,
  consent_translation BOOLEAN NOT NULL DEFAULT FALSE,
  preferred_subtitle_language TEXT,
  UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vcp_session
  ON public.voice_call_participants(session_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_vcp_user
  ON public.voice_call_participants(user_id, joined_at);

-- ============================================================
-- 3. voice_transcript_segments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.voice_transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.voice_call_sessions(id) ON DELETE CASCADE,
  speaker_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  source_language TEXT NOT NULL DEFAULT 'en',
  text TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  confidence REAL,
  provider TEXT,
  is_redacted BOOLEAN NOT NULL DEFAULT FALSE,
  -- Retention metadata
  expires_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  purged_at TIMESTAMPTZ,
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  legal_hold_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vts_session
  ON public.voice_transcript_segments(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_vts_speaker
  ON public.voice_transcript_segments(speaker_user_id, started_at);
-- Retention cleanup job index: find expired, non-purged, non-held records
CREATE INDEX IF NOT EXISTS idx_vts_retention
  ON public.voice_transcript_segments(expires_at, purged_at)
  WHERE purged_at IS NULL AND legal_hold = FALSE;

-- ============================================================
-- 4. voice_transcript_translations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.voice_transcript_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id UUID NOT NULL REFERENCES public.voice_transcript_segments(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  target_language TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vtt_segment
  ON public.voice_transcript_translations(segment_id, target_user_id);
CREATE INDEX IF NOT EXISTS idx_vtt_user
  ON public.voice_transcript_translations(target_user_id, segment_id);

-- ============================================================
-- 5. voice_call_summaries
-- ============================================================
CREATE TABLE IF NOT EXISTS public.voice_call_summaries (
  session_id UUID PRIMARY KEY REFERENCES public.voice_call_sessions(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  highlights_md TEXT NOT NULL DEFAULT '',
  decisions_md TEXT NOT NULL DEFAULT '',
  action_items_md TEXT NOT NULL DEFAULT '',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quality_score REAL,
  -- Retention metadata
  expires_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  purged_at TIMESTAMPTZ,
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  legal_hold_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_vcsum_generated
  ON public.voice_call_summaries(generated_at);
-- Retention cleanup job index
CREATE INDEX IF NOT EXISTS idx_vcsum_retention
  ON public.voice_call_summaries(expires_at, purged_at)
  WHERE purged_at IS NULL AND legal_hold = FALSE;

-- ============================================================
-- 6. voice_intelligence_policies
-- ============================================================
CREATE TABLE IF NOT EXISTS public.voice_intelligence_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace', 'server')),
  scope_id TEXT NOT NULL,
  transcription_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  require_explicit_consent BOOLEAN NOT NULL DEFAULT TRUE,
  translation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  summary_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  retention_days INTEGER NOT NULL DEFAULT 30,
  allowed_locales TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_vip_scope
  ON public.voice_intelligence_policies(scope_type, scope_id);

-- Reuse the shared handle_updated_at trigger function from initial schema
CREATE TRIGGER voice_intelligence_policies_updated_at
  BEFORE UPDATE ON public.voice_intelligence_policies
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- 7. voice_intelligence_audit_log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.voice_intelligence_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.voice_call_sessions(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vial_session
  ON public.voice_intelligence_audit_log(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_vial_actor
  ON public.voice_intelligence_audit_log(actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_vial_event
  ON public.voice_intelligence_audit_log(event_type, created_at);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.voice_call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_call_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_transcript_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_call_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_intelligence_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_intelligence_audit_log ENABLE ROW LEVEL SECURITY;

-- voice_call_sessions: visible to the session starter and to all participants
CREATE POLICY "vcs_select"
  ON public.voice_call_sessions FOR SELECT
  USING (
    started_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.voice_call_participants vcp
      WHERE vcp.session_id = id AND vcp.user_id = auth.uid()
    )
  );

CREATE POLICY "vcs_insert"
  ON public.voice_call_sessions FOR INSERT
  WITH CHECK (started_by = auth.uid());

-- Starter can end/update the session; participants can also update for consent
CREATE POLICY "vcs_update"
  ON public.voice_call_sessions FOR UPDATE
  USING (
    started_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.voice_call_participants vcp
      WHERE vcp.session_id = id AND vcp.user_id = auth.uid()
    )
  );

-- voice_call_participants: own row always visible; starter sees all rows in their session
CREATE POLICY "vcp_select"
  ON public.voice_call_participants FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.voice_call_sessions vcs
      WHERE vcs.id = session_id AND vcs.started_by = auth.uid()
    )
  );

CREATE POLICY "vcp_insert"
  ON public.voice_call_participants FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "vcp_update"
  ON public.voice_call_participants FOR UPDATE
  USING (user_id = auth.uid());

-- voice_transcript_segments: visible to session participants (DM and server);
-- purged/deleted records are hidden at the RLS layer.
CREATE POLICY "vts_select"
  ON public.voice_transcript_segments FOR SELECT
  USING (
    purged_at IS NULL
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.voice_call_participants vcp
      WHERE vcp.session_id = session_id AND vcp.user_id = auth.uid()
    )
  );

CREATE POLICY "vts_insert"
  ON public.voice_transcript_segments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.voice_call_participants vcp
      WHERE vcp.session_id = session_id AND vcp.user_id = auth.uid()
    )
  );

-- voice_transcript_translations: only the intended recipient can read their translation rows
CREATE POLICY "vtt_select"
  ON public.voice_transcript_translations FOR SELECT
  USING (target_user_id = auth.uid());

CREATE POLICY "vtt_insert"
  ON public.voice_transcript_translations FOR INSERT
  WITH CHECK (target_user_id = auth.uid());

-- voice_call_summaries: visible to session participants; purged/deleted hidden
CREATE POLICY "vcsum_select"
  ON public.voice_call_summaries FOR SELECT
  USING (
    purged_at IS NULL
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.voice_call_participants vcp
      WHERE vcp.session_id = session_id AND vcp.user_id = auth.uid()
    )
  );

-- voice_intelligence_policies: all authenticated users can read (needed for effective-policy fetch)
CREATE POLICY "vip_select"
  ON public.voice_intelligence_policies FOR SELECT
  TO authenticated
  USING (true);

-- Write access for policies is handled server-side via service role key only.
-- No direct INSERT/UPDATE/DELETE policy for authenticated users.

-- voice_intelligence_audit_log: no direct user reads; service role only
-- (No SELECT policy = no row is visible to authenticated users via anon key)
