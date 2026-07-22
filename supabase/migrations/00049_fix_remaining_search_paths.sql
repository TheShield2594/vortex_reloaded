-- Fix search_path for all SECURITY DEFINER functions not covered by migration 00048.
-- Setting search_path = '' (empty) forces fully-qualified name usage and prevents
-- search_path injection attacks where an attacker-controlled schema shadows pg builtins.
--
-- Functions previously set to "search_path = public" in earlier hardening migrations
-- are upgraded here to the stricter empty value. All affected functions already use
-- fully-qualified "public.*" references in their bodies, so behaviour is unchanged.

-- ── Temporary channels ────────────────────────────────────────────────────────
ALTER FUNCTION public.delete_expired_channels()
  SET search_path = '';

-- ── Member timeouts (from 00014c_moderation) ─────────────────────────────────
ALTER FUNCTION public.set_member_timeout(UUID, UUID, TIMESTAMPTZ, UUID, TEXT)
  SET search_path = '';

-- ── Moderation helpers (from 00014c_moderation) ──────────────────────────────
ALTER FUNCTION public.is_member_timed_out(UUID, UUID)
  SET search_path = '';

ALTER FUNCTION public.has_passed_screening(UUID, UUID)
  SET search_path = '';

-- ── Automod rule engine (from 00020_automod_rule_engine) ─────────────────────
ALTER FUNCTION public.increment_automod_rule_hit(UUID)
  SET search_path = '';

ALTER FUNCTION public.mark_automod_false_positive(UUID)
  SET search_path = '';

-- ── Login attempt tracking (from 00035, previously set to search_path = public
--    in 00041_hardening_policy_fixes) ─────────────────────────────────────────
ALTER FUNCTION public.is_login_locked_out(TEXT)
  SET search_path = '';

ALTER FUNCTION public.record_login_attempt(TEXT, TEXT)
  SET search_path = '';

ALTER FUNCTION public.clear_login_attempts(TEXT)
  SET search_path = '';

ALTER FUNCTION public.cleanup_old_login_attempts()
  SET search_path = '';

-- ── Server templates (from 00017_server_templates) ───────────────────────────
ALTER FUNCTION public.apply_server_template(UUID, JSONB)
  SET search_path = '';

ALTER FUNCTION public.export_server_template(UUID)
  SET search_path = '';

ALTER FUNCTION public.create_server_from_template(TEXT, TEXT, TEXT, JSONB)
  SET search_path = '';

-- ── App platform trigger (from 00021_apps_platform) ──────────────────────────
ALTER FUNCTION public.on_app_review_change()
  SET search_path = '';
