-- AutoMod rule engine expansion: triggers, conditions, analytics, and safety controls.

ALTER TABLE public.automod_rules
  DROP CONSTRAINT IF EXISTS automod_rules_trigger_type_check;

ALTER TABLE public.automod_rules
  ADD CONSTRAINT automod_rules_trigger_type_check
  CHECK (trigger_type IN ('keyword_filter', 'regex_filter', 'mention_spam', 'link_spam', 'rapid_message'));

ALTER TABLE public.automod_rules
  ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100;

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS automod_dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS automod_emergency_disable BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.automod_rule_analytics (
  rule_id UUID PRIMARY KEY REFERENCES public.automod_rules(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  hit_count BIGINT NOT NULL DEFAULT 0,
  false_positive_count BIGINT NOT NULL DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.automod_rule_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "server members can view automod analytics"
  ON public.automod_rule_analytics FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "server owner manages automod analytics"
  ON public.automod_rule_analytics FOR ALL
  USING (public.is_server_owner(server_id));

CREATE OR REPLACE FUNCTION public.increment_automod_rule_hit(p_rule_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_server_id UUID;
BEGIN
  SELECT server_id INTO v_server_id FROM public.automod_rules WHERE id = p_rule_id;
  IF v_server_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.automod_rule_analytics(rule_id, server_id, hit_count, last_triggered_at, updated_at)
  VALUES (p_rule_id, v_server_id, 1, NOW(), NOW())
  ON CONFLICT (rule_id)
  DO UPDATE SET
    hit_count = public.automod_rule_analytics.hit_count + 1,
    last_triggered_at = NOW(),
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_automod_false_positive(p_rule_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.automod_rule_analytics
  SET false_positive_count = false_positive_count + 1,
      updated_at = NOW()
  WHERE rule_id = p_rule_id;
END;
$$;
