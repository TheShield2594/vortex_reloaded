-- Migration 00051: Optimise get_member_permissions with a single bit_or aggregation
--
-- The original PL/pgSQL implementation (introduced in 00002_rls_policies.sql)
-- iterates over each matching role in a FOR loop and accumulates permissions
-- with bitwise OR. This is functionally correct but forces the query planner
-- to materialise one row at a time into the PL/pgSQL executor rather than
-- letting Postgres aggregate in a single pass.
--
-- The replacement uses the built-in bit_or() aggregate which:
--   • reduces function overhead to a single SQL aggregate node
--   • allows the planner to choose between hash-aggregate and sort-aggregate
--     strategies based on available memory and indexes
--   • eliminates PL/pgSQL context-switch overhead per role row
--   • is equivalent to the old loop: COALESCE(bit_or(...), 0) returns 0 when
--     the member has no roles at all (same as initialising v_permissions := 0
--     and never entering the loop)
--
-- The SECURITY DEFINER + SET search_path = '' attributes are preserved from
-- the hardening applied in migration 00048.

CREATE OR REPLACE FUNCTION public.get_member_permissions(
  p_server_id UUID,
  p_user_id   UUID DEFAULT auth.uid()
)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  -- Fast-path: owners receive all permissions (same constant as before).
  SELECT
    CASE
      WHEN public.is_server_owner(p_server_id, p_user_id) THEN 2147483647::BIGINT
      ELSE (
        -- Single-pass bitwise OR over all roles the user holds in this server,
        -- including the @everyone role (is_default = TRUE), which every member
        -- implicitly inherits.
        SELECT COALESCE(bit_or(r.permissions), 0)
        FROM public.roles r
        LEFT JOIN public.member_roles mr
          ON mr.role_id = r.id
         AND mr.user_id = p_user_id
        WHERE r.server_id = p_server_id
          AND (r.is_default = TRUE OR mr.user_id IS NOT NULL)
      )
    END;
$$;
