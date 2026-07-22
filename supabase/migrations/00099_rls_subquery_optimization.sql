-- Migration: Optimize RLS policies with subquery rewrites (#658)
--
-- Replaces per-row function calls (is_server_member, has_permission) with
-- IN (subquery) patterns that PostgreSQL can materialize once and hash-join.
-- Expected: 40-60% reduction in RLS overhead for permission-heavy queries.

-- ============================================================
-- CHANNEL PERMISSIONS POLICIES — rewrite with subquery
-- ============================================================
DROP POLICY IF EXISTS "Members can view channel permissions" ON public.channel_permissions;
DROP POLICY IF EXISTS "Users with MANAGE_CHANNELS can manage channel permissions" ON public.channel_permissions;

-- SELECT: materialize user's server memberships once
CREATE POLICY "Members can view channel permissions" ON public.channel_permissions
  FOR SELECT USING (
    channel_id IN (
      SELECT c.id
      FROM public.channels c
      JOIN public.server_members sm ON sm.server_id = c.server_id
      WHERE sm.user_id = auth.uid()
    )
  );

-- ALL (insert/update/delete): materialize servers where user has MANAGE_CHANNELS
CREATE POLICY "Users with MANAGE_CHANNELS can manage channel permissions" ON public.channel_permissions
  FOR ALL USING (
    channel_id IN (
      SELECT c.id
      FROM public.channels c
      JOIN public.server_members sm ON sm.server_id = c.server_id
      WHERE sm.user_id = auth.uid()
        AND public.has_permission(c.server_id, 64)
    )
  );

-- ============================================================
-- MESSAGES POLICIES — rewrite SELECT with subquery
-- ============================================================
DROP POLICY IF EXISTS "Members can view non-deleted messages" ON public.messages;
DROP POLICY IF EXISTS "Members can send messages" ON public.messages;

-- SELECT: single subquery for accessible channel_ids
CREATE POLICY "Members can view non-deleted messages" ON public.messages
  FOR SELECT USING (
    deleted_at IS NULL
    AND channel_id IN (
      SELECT c.id
      FROM public.channels c
      JOIN public.server_members sm ON sm.server_id = c.server_id
      WHERE sm.user_id = auth.uid()
    )
  );

-- INSERT: single subquery for channels where user can send
CREATE POLICY "Members can send messages" ON public.messages
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND channel_id IN (
      SELECT c.id
      FROM public.channels c
      JOIN public.server_members sm ON sm.server_id = c.server_id
      WHERE sm.user_id = auth.uid()
        AND public.has_permission(c.server_id, 2)
    )
  );
