-- ============================================================
-- Atomic server deletion RPC
--
-- Wraps server deletion in a single transaction. All child
-- tables use ON DELETE CASCADE, so deleting the server row
-- automatically removes: server_members, roles, member_roles,
-- channels, messages, reactions, channel_permissions, invites,
-- automod_rules, screening_configs, webhooks, server_emojis,
-- server_app_installs, events, audit_logs, member_timeouts,
-- member_screening, etc.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_server_cascade(p_server_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.servers WHERE id = p_server_id;
END;
$$;
