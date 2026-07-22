-- Migration: Fix issues found during migration verification audit
-- Addresses:
-- 1. SECURITY DEFINER functions missing SET search_path = '' (regression from 00048/00049 hardening)
-- 2. NULL in CHECK IN-list (dead code) in user_activity_log.ref_type
-- 3. Deprecated auth.users columns in system bot migration (moved to 00015_system_bot.sql)

-- ============================================================
-- 1. Fix search_path on SECURITY DEFINER functions
-- 00053: reorder_channels – uses SET search_path = public (should be '')
-- 00054: join_server_by_invite – uses SET search_path = public (should be '')
-- 00065: auto_archive_inactive_threads – missing SET search_path entirely
-- 00065: create_thread_from_message – missing SET search_path entirely
-- 00058: prune_activity_log – missing SET search_path (trigger function hardening)
-- ============================================================

ALTER FUNCTION public.reorder_channels(UUID, JSONB) SET search_path = '';
ALTER FUNCTION public.join_server_by_invite(TEXT) SET search_path = '';
ALTER FUNCTION public.auto_archive_inactive_threads() SET search_path = '';
ALTER FUNCTION public.create_thread_from_message(UUID, TEXT, INTEGER) SET search_path = '';

-- ============================================================
-- 2. Fix NULL in CHECK IN-list on user_activity_log.ref_type
-- NULL inside IN(...) is dead code; replace with proper OR IS NULL
-- ============================================================

ALTER TABLE public.user_activity_log
  DROP CONSTRAINT IF EXISTS user_activity_log_ref_type_check;

ALTER TABLE public.user_activity_log
  ADD CONSTRAINT user_activity_log_ref_type_check
  CHECK (ref_type IS NULL OR ref_type IN ('channel', 'server', 'message', 'file'));

-- ============================================================
-- 3. System bot schema-drift handling (moved to 00015_system_bot.sql)
-- The schema detection and conditional insert logic now lives in 00015
-- so the legacy insert never runs on newer Supabase schemas.
-- No action needed here; 00015 handles both old and new schemas.
-- ============================================================

-- Also fix search_path on prune_activity_log (from 00058, missed by 00048/00049)
ALTER FUNCTION public.prune_activity_log() SET search_path = '';
