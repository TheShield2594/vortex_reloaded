-- ============================================================
-- Atomic role assignment + audit log RPCs
--
-- Wraps role insert/delete and audit log insert in a single
-- transaction so both succeed or both fail together (#582).
-- ============================================================

-- Assign a role to a member and log the action atomically.
-- Returns TRUE if the role was newly assigned, FALSE if it
-- was already present (idempotent, like ON CONFLICT DO NOTHING).
CREATE OR REPLACE FUNCTION public.assign_member_role(
  p_server_id UUID,
  p_user_id UUID,
  p_role_id UUID,
  p_actor_id UUID,
  p_role_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_count INTEGER;
BEGIN
  -- Attempt to insert; do nothing if the assignment already exists (23505)
  INSERT INTO public.member_roles (server_id, user_id, role_id)
  VALUES (p_server_id, p_user_id, p_role_id)
  ON CONFLICT (server_id, user_id, role_id) DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  -- Only log when the role was actually newly assigned
  IF v_row_count > 0 THEN
    INSERT INTO public.audit_logs (server_id, actor_id, action, target_id, target_type, changes)
    VALUES (
      p_server_id,
      p_actor_id,
      'role_assigned',
      p_user_id,
      'user',
      jsonb_build_object(
        'role_id', p_role_id,
        'role_name', COALESCE(p_role_name, NULL),
        'before', jsonb_build_object('has_role', FALSE),
        'after', jsonb_build_object('has_role', TRUE)
      )
    );
  END IF;

  RETURN v_row_count > 0;
END;
$$;

-- Remove a role from a member and log the action atomically.
CREATE OR REPLACE FUNCTION public.remove_member_role(
  p_server_id UUID,
  p_user_id UUID,
  p_role_id UUID,
  p_actor_id UUID,
  p_role_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.member_roles
  WHERE server_id = p_server_id
    AND user_id = p_user_id
    AND role_id = p_role_id;

  INSERT INTO public.audit_logs (server_id, actor_id, action, target_id, target_type, changes)
  VALUES (
    p_server_id,
    p_actor_id,
    'role_removed',
    p_user_id,
    'user',
    jsonb_build_object(
      'role_id', p_role_id,
      'role_name', COALESCE(p_role_name, NULL),
      'before', jsonb_build_object('has_role', TRUE),
      'after', jsonb_build_object('has_role', FALSE)
    )
  );
END;
$$;
