-- Fix: Add missing DELETE policy on messages table
-- Without this, hard deletes (used in forum/announcement/media channels and threads)
-- are blocked by RLS for all users.

-- Also add a WITH CHECK to the soft-delete UPDATE policy to ensure moderators
-- can set deleted_at on other users' messages without being blocked.

-- Hard delete: authors can remove own messages, moderators/owners can remove any
DROP POLICY IF EXISTS "Authors and moderators can hard delete messages" ON public.messages;
CREATE POLICY "Authors and moderators can hard delete messages"
  ON public.messages FOR DELETE
  USING (
    author_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id AND public.has_permission(c.server_id, 4) -- MANAGE_MESSAGES
    )
  );

-- The existing "Authors and moderators can delete messages" UPDATE policy lacks
-- a WITH CHECK, and the "Authors can edit own messages" policy's WITH CHECK
-- (author_id = auth.uid()) can block moderator soft-deletes in some Postgres
-- versions. Replace both UPDATE policies with a single unified one.

DROP POLICY IF EXISTS "Authors can edit own messages" ON public.messages;
DROP POLICY IF EXISTS "Authors and moderators can delete messages" ON public.messages;
DROP POLICY IF EXISTS "Authors and moderators can soft delete messages" ON public.messages;

CREATE POLICY "Authors can edit own messages"
  ON public.messages FOR UPDATE
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Authors and moderators can soft delete messages"
  ON public.messages FOR UPDATE
  USING (
    author_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id AND public.has_permission(c.server_id, 4) -- MANAGE_MESSAGES
    )
  )
  WITH CHECK (
    author_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id AND public.has_permission(c.server_id, 4) -- MANAGE_MESSAGES
    )
  );
