-- ============================================================
-- Migration: Auto-assign role on server join
-- Adds join_role_id to servers table so owners can configure
-- a role to be automatically assigned when a new member joins.
-- Also updates the join_server_by_invite RPC to honour it.
-- ============================================================

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS join_role_id UUID REFERENCES public.roles(id) ON DELETE SET NULL;

-- ============================================================
-- Update join_server_by_invite to auto-assign the join role
-- ============================================================
CREATE OR REPLACE FUNCTION public.join_server_by_invite(p_invite_code TEXT)
RETURNS public.servers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_server public.servers%ROWTYPE;
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Reject empty, too-short, or non-alphanumeric codes to limit brute-force enumeration.
  -- Default codes are 12 hex chars; accept 6+ alphanumeric to allow custom codes.
  IF p_invite_code IS NULL OR length(p_invite_code) < 6 OR p_invite_code !~ '^[a-zA-Z0-9]+$' THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  -- Look up server by invite code (bypasses RLS via SECURITY DEFINER)
  SELECT * INTO v_server FROM public.servers WHERE invite_code = p_invite_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  -- Insert member (ignore if already a member)
  INSERT INTO public.server_members (server_id, user_id)
  VALUES (v_server.id, v_user_id)
  ON CONFLICT DO NOTHING;

  -- Auto-assign the configured join role if one is set
  IF v_server.join_role_id IS NOT NULL THEN
    INSERT INTO public.member_roles (server_id, user_id, role_id)
    VALUES (v_server.id, v_user_id, v_server.join_role_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_server;
END;
$$;
