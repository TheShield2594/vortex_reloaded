-- Row Level Security Policies
-- Enable RLS on all tables

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_states ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Check if user is member of a server
CREATE OR REPLACE FUNCTION public.is_server_member(p_server_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.server_members
    WHERE server_id = p_server_id AND user_id = p_user_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if user is server owner
CREATE OR REPLACE FUNCTION public.is_server_owner(p_server_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.servers
    WHERE id = p_server_id AND owner_id = p_user_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Get effective permissions for a user in a server
CREATE OR REPLACE FUNCTION public.get_member_permissions(p_server_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BIGINT AS $$
DECLARE
  v_permissions BIGINT := 0;
  v_role_perm BIGINT;
BEGIN
  -- Owner has all permissions
  IF public.is_server_owner(p_server_id, p_user_id) THEN
    RETURN 2147483647; -- All bits set
  END IF;

  -- Get permissions from all assigned roles + @everyone role
  FOR v_role_perm IN
    SELECT r.permissions
    FROM public.roles r
    LEFT JOIN public.member_roles mr ON mr.role_id = r.id AND mr.user_id = p_user_id
    WHERE r.server_id = p_server_id
      AND (r.is_default = TRUE OR mr.user_id IS NOT NULL)
  LOOP
    v_permissions := v_permissions | v_role_perm;
  END LOOP;

  RETURN v_permissions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check specific permission
CREATE OR REPLACE FUNCTION public.has_permission(p_server_id UUID, p_permission BIGINT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
  SELECT (public.get_member_permissions(p_server_id, p_user_id) & p_permission) != 0
    OR public.is_server_owner(p_server_id, p_user_id);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- USERS POLICIES
-- ============================================================
CREATE POLICY "Users can view all profiles"
  ON public.users FOR SELECT
  USING (TRUE);

CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON public.users FOR INSERT
  WITH CHECK (id = auth.uid());

-- ============================================================
-- SERVERS POLICIES
-- ============================================================
CREATE POLICY "Members can view servers they belong to"
  ON public.servers FOR SELECT
  USING (public.is_server_member(id));

CREATE POLICY "Authenticated users can create servers"
  ON public.servers FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Server owners can update their servers"
  ON public.servers FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Server owners can delete their servers"
  ON public.servers FOR DELETE
  USING (owner_id = auth.uid());

-- ============================================================
-- SERVER MEMBERS POLICIES
-- ============================================================
CREATE POLICY "Members can view server members"
  ON public.server_members FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "Users can join servers (insert own membership)"
  ON public.server_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owners and admins can kick members"
  ON public.server_members FOR DELETE
  USING (
    user_id = auth.uid() OR -- leave server
    public.is_server_owner(server_id) OR
    public.has_permission(server_id, 8) -- KICK_MEMBERS
  );

CREATE POLICY "Members can update own nickname"
  ON public.server_members FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- ROLES POLICIES
-- ============================================================
CREATE POLICY "Members can view roles"
  ON public.roles FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "Users with MANAGE_ROLES can create roles"
  ON public.roles FOR INSERT
  WITH CHECK (public.has_permission(server_id, 32));

CREATE POLICY "Users with MANAGE_ROLES can update roles"
  ON public.roles FOR UPDATE
  USING (public.has_permission(server_id, 32));

CREATE POLICY "Users with MANAGE_ROLES can delete roles"
  ON public.roles FOR DELETE
  USING (public.has_permission(server_id, 32) AND is_default = FALSE);

-- ============================================================
-- MEMBER ROLES POLICIES
-- ============================================================
CREATE POLICY "Members can view member roles"
  ON public.member_roles FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "Users with MANAGE_ROLES can assign roles"
  ON public.member_roles FOR INSERT
  WITH CHECK (public.has_permission(server_id, 32));

CREATE POLICY "Users with MANAGE_ROLES can remove roles"
  ON public.member_roles FOR DELETE
  USING (public.has_permission(server_id, 32));

-- ============================================================
-- CHANNELS POLICIES
-- ============================================================
CREATE POLICY "Members can view channels"
  ON public.channels FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "Users with MANAGE_CHANNELS can create channels"
  ON public.channels FOR INSERT
  WITH CHECK (public.has_permission(server_id, 64));

CREATE POLICY "Users with MANAGE_CHANNELS can update channels"
  ON public.channels FOR UPDATE
  USING (public.has_permission(server_id, 64));

CREATE POLICY "Users with MANAGE_CHANNELS can delete channels"
  ON public.channels FOR DELETE
  USING (public.has_permission(server_id, 64));

-- ============================================================
-- CHANNEL PERMISSIONS POLICIES
-- ============================================================
CREATE POLICY "Members can view channel permissions"
  ON public.channel_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id AND public.is_server_member(c.server_id)
    )
  );

CREATE POLICY "Users with MANAGE_CHANNELS can manage channel permissions"
  ON public.channel_permissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id AND public.has_permission(c.server_id, 64)
    )
  );

-- ============================================================
-- MESSAGES POLICIES
-- ============================================================
CREATE POLICY "Members can view non-deleted messages"
  ON public.messages FOR SELECT
  USING (
    deleted_at IS NULL AND
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id AND public.is_server_member(c.server_id)
    )
  );

CREATE POLICY "Members can send messages"
  ON public.messages FOR INSERT
  WITH CHECK (
    author_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id AND public.has_permission(c.server_id, 2) -- SEND_MESSAGES
    )
  );

CREATE POLICY "Authors can edit own messages"
  ON public.messages FOR UPDATE
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- Soft delete: authors and moderators can set deleted_at
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

-- Hard delete: authors can remove own messages, moderators can remove any
CREATE POLICY "Authors and moderators can hard delete messages"
  ON public.messages FOR DELETE
  USING (
    author_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id AND public.has_permission(c.server_id, 4) -- MANAGE_MESSAGES
    )
  );

-- ============================================================
-- ATTACHMENTS POLICIES
-- ============================================================
CREATE POLICY "Members can view attachments"
  ON public.attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      JOIN public.channels c ON c.id = m.channel_id
      WHERE m.id = message_id AND public.is_server_member(c.server_id)
    )
  );

CREATE POLICY "Authors can add attachments to own messages"
  ON public.attachments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_id AND m.author_id = auth.uid()
    )
  );

-- ============================================================
-- REACTIONS POLICIES
-- ============================================================
CREATE POLICY "Members can view reactions"
  ON public.reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      JOIN public.channels c ON c.id = m.channel_id
      WHERE m.id = message_id AND public.is_server_member(c.server_id)
    )
  );

CREATE POLICY "Members can add reactions"
  ON public.reactions FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.messages m
      JOIN public.channels c ON c.id = m.channel_id
      WHERE m.id = message_id AND public.is_server_member(c.server_id)
    )
  );

CREATE POLICY "Users can remove own reactions"
  ON public.reactions FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================
-- DIRECT MESSAGES POLICIES
-- ============================================================
CREATE POLICY "Users can view their DMs"
  ON public.direct_messages FOR SELECT
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY "Users can send DMs"
  ON public.direct_messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "Senders can edit own DMs"
  ON public.direct_messages FOR UPDATE
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- ============================================================
-- DM ATTACHMENTS POLICIES
-- ============================================================
CREATE POLICY "DM participants can view DM attachments"
  ON public.dm_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.direct_messages dm
      WHERE dm.id = dm_id AND (dm.sender_id = auth.uid() OR dm.receiver_id = auth.uid())
    )
  );

CREATE POLICY "Senders can add DM attachments"
  ON public.dm_attachments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.direct_messages dm
      WHERE dm.id = dm_id AND dm.sender_id = auth.uid()
    )
  );

-- ============================================================
-- VOICE STATES POLICIES
-- ============================================================
CREATE POLICY "Members can view voice states"
  ON public.voice_states FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "Users can manage own voice state"
  ON public.voice_states FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- REALTIME PUBLICATIONS
-- ============================================================
-- Enable Realtime for relevant tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_states;
ALTER PUBLICATION supabase_realtime ADD TABLE public.server_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
