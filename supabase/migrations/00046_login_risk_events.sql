-- Identity security parity: risk telemetry for successful logins + suspicious login alerts.

CREATE TABLE IF NOT EXISTS public.login_risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  location_hint TEXT,
  risk_score INT NOT NULL DEFAULT 0,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  suspicious BOOLEAN NOT NULL DEFAULT FALSE,
  succeeded BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_risk_events_user_created ON public.login_risk_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_risk_events_suspicious ON public.login_risk_events(suspicious, created_at DESC);

ALTER TABLE public.login_risk_events ENABLE ROW LEVEL SECURITY;

-- RLS policies intentionally omitted: service role writes/reads telemetry.
