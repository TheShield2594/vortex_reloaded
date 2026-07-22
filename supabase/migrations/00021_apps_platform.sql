-- Apps platform: identity, install scopes/permissions, commands/events, analytics and rate limits.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_trust_badge') THEN
    CREATE TYPE public.app_trust_badge AS ENUM ('verified', 'partner', 'internal');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.app_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'productivity',
  icon_url TEXT,
  homepage_url TEXT,
  identity JSONB NOT NULL DEFAULT '{}'::jsonb,
  install_scopes TEXT[] NOT NULL DEFAULT ARRAY['server']::TEXT[],
  permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  trust_badge public.app_trust_badge,
  average_rating NUMERIC(3,2) NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_catalog_credentials (
  app_id UUID PRIMARY KEY REFERENCES public.app_catalog(id) ON DELETE CASCADE,
  credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES public.app_catalog(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.server_app_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES public.app_catalog(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  installed_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  install_scopes TEXT[] NOT NULL DEFAULT ARRAY['server']::TEXT[],
  granted_permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, server_id)
);

CREATE TABLE IF NOT EXISTS public.server_app_install_credentials (
  app_install_id UUID PRIMARY KEY REFERENCES public.server_app_installs(id) ON DELETE CASCADE,
  credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES public.app_catalog(id) ON DELETE CASCADE,
  command_name TEXT NOT NULL,
  description TEXT,
  schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, command_name)
);

CREATE TABLE IF NOT EXISTS public.app_event_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_install_id UUID NOT NULL REFERENCES public.server_app_installs(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_install_id, event_key)
);

CREATE TABLE IF NOT EXISTS public.app_rate_limits (
  app_id UUID PRIMARY KEY REFERENCES public.app_catalog(id) ON DELETE CASCADE,
  requests_per_minute INTEGER NOT NULL DEFAULT 120,
  burst INTEGER NOT NULL DEFAULT 30,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_usage_metrics (
  id BIGSERIAL PRIMARY KEY,
  app_id UUID NOT NULL REFERENCES public.app_catalog(id) ON DELETE CASCADE,
  server_id UUID REFERENCES public.servers(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  metric_value INTEGER NOT NULL DEFAULT 1,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_reviews_app_id ON public.app_reviews(app_id);
CREATE INDEX IF NOT EXISTS idx_app_usage_metrics_app_id ON public.app_usage_metrics(app_id);
CREATE INDEX IF NOT EXISTS idx_app_usage_metrics_server_id ON public.app_usage_metrics(server_id);
CREATE INDEX IF NOT EXISTS idx_app_usage_metrics_occurred_at ON public.app_usage_metrics(occurred_at);
CREATE INDEX IF NOT EXISTS idx_app_usage_metrics_app_id_occurred_at ON public.app_usage_metrics(app_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.app_catalog_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_catalog_update_ts_tr ON public.app_catalog;
CREATE TRIGGER app_catalog_update_ts_tr
BEFORE UPDATE ON public.app_catalog
FOR EACH ROW
EXECUTE FUNCTION public.app_catalog_set_updated_at();

ALTER TABLE public.app_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_catalog_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_app_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_app_install_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_event_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_usage_metrics ENABLE ROW LEVEL SECURITY;

-- Do not expose base app_catalog rows to anon/authenticated directly.
REVOKE ALL ON TABLE public.app_catalog FROM anon, authenticated;
GRANT SELECT ON TABLE public.app_catalog TO authenticated;
REVOKE ALL ON TABLE public.app_catalog_credentials FROM anon, authenticated;
REVOKE ALL ON TABLE public.server_app_install_credentials FROM anon, authenticated;

CREATE OR REPLACE VIEW public.app_catalog_public AS
SELECT
  id,
  slug,
  name,
  description,
  category,
  icon_url,
  homepage_url,
  identity,
  install_scopes,
  permissions,
  trust_badge,
  average_rating,
  review_count,
  is_published,
  created_at,
  updated_at
FROM public.app_catalog
WHERE is_published = TRUE;

GRANT SELECT ON public.app_catalog_public TO anon, authenticated;

CREATE POLICY "authenticated read app catalog"
  ON public.app_catalog FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "service-role manage app credentials"
  ON public.app_catalog_credentials FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "members read installs"
  ON public.server_app_installs FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "owners manage installs"
  ON public.server_app_installs FOR ALL
  USING (public.is_server_owner(server_id));

CREATE POLICY "owners manage install credentials"
  ON public.server_app_install_credentials FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.server_app_installs sai
    WHERE sai.id = app_install_id
      AND public.is_server_owner(sai.server_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.server_app_installs sai
    WHERE sai.id = app_install_id
      AND public.is_server_owner(sai.server_id)
  ));

CREATE POLICY "members read commands"
  ON public.app_commands FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public.server_app_installs sai
    WHERE sai.app_id = app_commands.app_id
      AND public.is_server_member(sai.server_id)
  ));

CREATE POLICY "members read subscriptions"
  ON public.app_event_subscriptions FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public.server_app_installs sai
    WHERE sai.id = app_event_subscriptions.app_install_id
      AND public.is_server_member(sai.server_id)
  ));

CREATE POLICY "owners manage subscriptions"
  ON public.app_event_subscriptions FOR ALL
  USING (EXISTS (
    SELECT 1
    FROM public.server_app_installs sai
    WHERE sai.id = app_event_subscriptions.app_install_id
      AND public.is_server_owner(sai.server_id)
  ));

CREATE POLICY "members read app reviews"
  ON public.app_reviews FOR SELECT
  USING (TRUE);

CREATE POLICY "users manage own reviews"
  ON public.app_reviews FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "members read rate limits"
  ON public.app_rate_limits FOR SELECT
  USING (TRUE);

CREATE POLICY "members read usage"
  ON public.app_usage_metrics FOR SELECT
  USING (server_id IS NULL OR public.is_server_member(server_id));

CREATE OR REPLACE FUNCTION public.recompute_app_rating(p_app_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.app_catalog
  SET
    average_rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM public.app_reviews WHERE app_id = p_app_id), 0),
    review_count = COALESCE((SELECT COUNT(*) FROM public.app_reviews WHERE app_id = p_app_id), 0),
    updated_at = NOW()
  WHERE id = p_app_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_app_usage(p_app_id UUID, p_server_id UUID, p_metric_key TEXT, p_metric_value INTEGER DEFAULT 1)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.app_usage_metrics(app_id, server_id, metric_key, metric_value)
  VALUES (p_app_id, p_server_id, p_metric_key, COALESCE(p_metric_value, 1));
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_app_rating(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bump_app_usage(UUID, UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_app_rating(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bump_app_usage(UUID, UUID, TEXT, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.on_app_review_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app_id UUID;
BEGIN
  v_app_id := COALESCE(NEW.app_id, OLD.app_id);
  PERFORM public.recompute_app_rating(v_app_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS app_review_change_trigger ON public.app_reviews;
CREATE TRIGGER app_review_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.app_reviews
FOR EACH ROW EXECUTE FUNCTION public.on_app_review_change();

INSERT INTO public.app_catalog (slug, name, description, category, install_scopes, permissions, trust_badge, identity)
VALUES
  ('standup-assistant', 'Standup Assistant', 'Collect asynchronous daily standups with reminders.', 'productivity', ARRAY['server','channel'], ARRAY['SEND_MESSAGES','READ_MESSAGES'], 'verified', '{"publisher":"Vortex Labs"}'::jsonb),
  ('incident-bot', 'Incident Bot', 'Automated incident timeline and status page updates.', 'ops', ARRAY['server'], ARRAY['SEND_MESSAGES','MANAGE_MESSAGES'], 'partner', '{"publisher":"Reliant Ops"}'::jsonb),
  ('welcome-guide', 'Welcome Guide', 'Onboarding prompts and role assignment workflows.', 'community', ARRAY['server'], ARRAY['SEND_MESSAGES','MANAGE_ROLES'], NULL, '{"publisher":"Community Forge"}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.app_rate_limits (app_id, requests_per_minute, burst)
SELECT id, 120, 30 FROM public.app_catalog
ON CONFLICT (app_id) DO NOTHING;
