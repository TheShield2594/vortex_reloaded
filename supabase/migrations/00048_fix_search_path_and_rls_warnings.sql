-- Fix security warnings:
-- 1. Function Search Path Mutable (0011): add SET search_path = '' to all public functions
-- 2. RLS Policy Always True (0024): restrict system INSERT/UPDATE policies to service_role

-- ============================================================
-- FIX FUNCTION SEARCH PATHS
-- Setting search_path = '' forces fully-qualified name usage,
-- preventing search_path injection attacks.
-- All functions below already use public.* qualified references.
-- ============================================================

ALTER FUNCTION public.handle_updated_at() SET search_path = '';
ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.handle_new_server() SET search_path = '';

ALTER FUNCTION public.is_server_member(UUID, UUID) SET search_path = '';
ALTER FUNCTION public.is_server_owner(UUID, UUID) SET search_path = '';
ALTER FUNCTION public.get_member_permissions(UUID, UUID) SET search_path = '';
ALTER FUNCTION public.has_permission(UUID, BIGINT, UUID) SET search_path = '';

ALTER FUNCTION public.handle_message_mentions() SET search_path = '';
ALTER FUNCTION public.handle_friendship_updated_at() SET search_path = '';
ALTER FUNCTION public.sync_member_count() SET search_path = '';
ALTER FUNCTION public.is_dm_channel_member(UUID) SET search_path = '';
ALTER FUNCTION public.dm_message_bump_updated() SET search_path = '';
ALTER FUNCTION public.mark_dm_read(UUID) SET search_path = '';
ALTER FUNCTION public.messages_search_vector_update() SET search_path = '';
ALTER FUNCTION public.mark_channel_read(UUID) SET search_path = '';

ALTER FUNCTION public.handle_thread_message() SET search_path = '';
ALTER FUNCTION public.mark_thread_read(UUID) SET search_path = '';
ALTER FUNCTION public.create_thread_from_message(UUID, TEXT) SET search_path = '';

ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.handle_auth_security_policy_updated_at() SET search_path = '';

ALTER FUNCTION public.get_thread_counts_by_channel(UUID) SET search_path = '';

ALTER FUNCTION public.workspace_touch_updated_at() SET search_path = '';
ALTER FUNCTION public.channel_tasks_search_vector_update() SET search_path = '';
ALTER FUNCTION public.channel_docs_search_vector_update() SET search_path = '';

ALTER FUNCTION public.app_catalog_set_updated_at() SET search_path = '';

ALTER FUNCTION public.dm_channel_keys_prune_trigger() SET search_path = '';
ALTER FUNCTION public.dm_channel_rotate_on_member_change() SET search_path = '';

ALTER FUNCTION public.set_user_connections_updated_at() SET search_path = '';

-- ============================================================
-- FIX RLS POLICIES THAT ARE ALWAYS TRUE FOR WRITE OPERATIONS
-- Restrict system-only INSERT/UPDATE policies to service_role.
-- These policies are used by backend/edge functions running as
-- service_role and should not be accessible to regular users.
-- ============================================================

-- audit_logs: restrict system insert to service_role
DROP POLICY IF EXISTS "system can insert audit logs" ON public.audit_logs;
CREATE POLICY "system can insert audit logs"
  ON public.audit_logs FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

-- attachment_scan_metrics: restrict system insert to service_role
DROP POLICY IF EXISTS "system insert attachment scan metrics" ON public.attachment_scan_metrics;
CREATE POLICY "system insert attachment scan metrics"
  ON public.attachment_scan_metrics FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

-- invites: restrict system update to service_role
DROP POLICY IF EXISTS "system can update invites" ON public.invites;
CREATE POLICY "system can update invites"
  ON public.invites FOR UPDATE
  TO service_role
  USING (TRUE);
