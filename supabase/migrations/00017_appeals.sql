-- Appeal workflow for moderation bans.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.moderation_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL,
  user_id UUID NOT NULL,
  linked_action TEXT NOT NULL DEFAULT 'member_ban',
  appellant_statement TEXT NOT NULL CHECK (char_length(appellant_statement) BETWEEN 20 AND 4000),
  evidence_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewing', 'approved', 'denied', 'closed')),
  assigned_reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  decision_template_id UUID,
  decision_reason TEXT,
  anti_abuse_score SMALLINT NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT moderation_appeals_ban_fk
    FOREIGN KEY (server_id, user_id)
    REFERENCES public.server_bans(server_id, user_id)
    ON DELETE CASCADE
);

DROP TRIGGER IF EXISTS moderation_appeals_set_updated_at ON public.moderation_appeals;
CREATE TRIGGER moderation_appeals_set_updated_at
  BEFORE UPDATE ON public.moderation_appeals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS moderation_appeals_open_unique_idx
  ON public.moderation_appeals(server_id, user_id)
  WHERE status IN ('submitted', 'reviewing');

CREATE INDEX IF NOT EXISTS moderation_appeals_triage_idx
  ON public.moderation_appeals(server_id, status, submitted_at ASC);

CREATE INDEX IF NOT EXISTS moderation_appeals_user_idx
  ON public.moderation_appeals(user_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.moderation_decision_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 10 AND 3000),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'denied', 'closed')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(server_id, title)
);

ALTER TABLE public.moderation_appeals
  ADD CONSTRAINT moderation_appeals_template_fk
  FOREIGN KEY (decision_template_id)
  REFERENCES public.moderation_decision_templates(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.moderation_appeal_internal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appeal_id UUID NOT NULL REFERENCES public.moderation_appeals(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS moderation_appeal_notes_idx
  ON public.moderation_appeal_internal_notes(appeal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.moderation_appeal_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appeal_id UUID NOT NULL REFERENCES public.moderation_appeals(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  previous_status TEXT CHECK (previous_status IS NULL OR previous_status IN ('submitted', 'reviewing', 'approved', 'denied', 'closed')),
  new_status TEXT NOT NULL CHECK (new_status IN ('submitted', 'reviewing', 'approved', 'denied', 'closed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS moderation_appeal_status_events_idx
  ON public.moderation_appeal_status_events(appeal_id, created_at DESC);

ALTER TABLE public.moderation_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_decision_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_appeal_internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_appeal_status_events ENABLE ROW LEVEL SECURITY;

-- Appellant may only view their own appeals.
CREATE POLICY "Appeal owner can view own appeals"
  ON public.moderation_appeals FOR SELECT
  USING (auth.uid() = user_id);

-- Server moderators can triage appeals.
CREATE POLICY "Server moderators can view appeals"
  ON public.moderation_appeals FOR SELECT
  USING (public.has_permission(server_id, 16) OR public.has_permission(server_id, 128));

-- Inserts/updates are expected via API + service-role.

CREATE POLICY "Moderators can manage decision templates"
  ON public.moderation_decision_templates FOR ALL
  USING (public.has_permission(server_id, 16) OR public.has_permission(server_id, 128));

CREATE POLICY "Moderators can manage internal notes"
  ON public.moderation_appeal_internal_notes FOR ALL
  USING (public.has_permission(server_id, 16) OR public.has_permission(server_id, 128));

CREATE POLICY "Appeal owner can view status events"
  ON public.moderation_appeal_status_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.moderation_appeals ma
      WHERE ma.id = moderation_appeal_status_events.appeal_id
        AND ma.user_id = auth.uid()
    )
  );

CREATE POLICY "Moderators can view status events"
  ON public.moderation_appeal_status_events FOR SELECT
  USING (public.has_permission(server_id, 16) OR public.has_permission(server_id, 128));

-- ============================================================
-- Server template import/export helpers
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_server_template(
  p_server_id UUID,
  p_template JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_default_role_id UUID;
  v_default_role_name TEXT;
  v_default_permissions BIGINT := 3;
  v_default_color TEXT := '#99AAB5';
  v_role JSONB;
  v_category JSONB;
  v_channel JSONB;
  v_perm JSONB;
  v_role_id UUID;
  v_channel_id UUID;
  v_parent_id UUID;
  v_deleted_channels INTEGER := 0;
BEGIN
  SELECT owner_id INTO v_owner FROM public.servers WHERE id = p_server_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Server not found';
  END IF;

  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Only server owner can import templates';
  END IF;

  IF jsonb_typeof(p_template) <> 'object' THEN
    RAISE EXCEPTION 'Template must be an object';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_role_map(name TEXT PRIMARY KEY, role_id UUID) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS tmp_category_map(name TEXT PRIMARY KEY, channel_id UUID) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS tmp_channel_map(name TEXT PRIMARY KEY, channel_id UUID) ON COMMIT DROP;
  TRUNCATE tmp_role_map, tmp_category_map, tmp_channel_map;

  SELECT id INTO v_default_role_id
  FROM public.roles
  WHERE server_id = p_server_id AND is_default = TRUE
  LIMIT 1;

  SELECT COALESCE(r->>'name', '@everyone'),
         COALESCE((r->>'permissions')::BIGINT, 3),
         COALESCE(r->>'color', '#99AAB5')
  INTO v_default_role_name, v_default_permissions, v_default_color
  FROM jsonb_array_elements(COALESCE(p_template->'roles', '[]'::jsonb)) r
  WHERE COALESCE((r->>'is_default')::BOOLEAN, FALSE) = TRUE
  LIMIT 1;

  IF v_default_role_id IS NULL THEN
    INSERT INTO public.roles (server_id, name, color, position, permissions, is_default)
    VALUES (p_server_id, v_default_role_name, v_default_color, 0, v_default_permissions, TRUE)
    RETURNING id INTO v_default_role_id;
  ELSE
    UPDATE public.roles
    SET name = v_default_role_name,
        color = v_default_color,
        permissions = v_default_permissions,
        is_hoisted = FALSE,
        mentionable = FALSE
    WHERE id = v_default_role_id;
  END IF;

  INSERT INTO tmp_role_map(name, role_id)
  VALUES (LOWER(v_default_role_name), v_default_role_id)
  ON CONFLICT (name) DO UPDATE SET role_id = EXCLUDED.role_id;

  DELETE FROM public.member_roles
  WHERE server_id = p_server_id
    AND role_id IN (SELECT id FROM public.roles WHERE server_id = p_server_id AND is_default = FALSE);

  DELETE FROM public.roles
  WHERE server_id = p_server_id AND is_default = FALSE;

  FOR v_role IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_template->'roles', '[]'::jsonb))
  LOOP
    IF COALESCE((v_role->>'is_default')::BOOLEAN, FALSE) = TRUE THEN
      CONTINUE;
    END IF;

    INSERT INTO public.roles (server_id, name, color, position, permissions, is_hoisted, mentionable, is_default)
    VALUES (
      p_server_id,
      COALESCE(v_role->>'name', 'new role'),
      COALESCE(v_role->>'color', '#99AAB5'),
      COALESCE((v_role->>'position')::INTEGER, 0),
      COALESCE((v_role->>'permissions')::BIGINT, 0),
      COALESCE((v_role->>'is_hoisted')::BOOLEAN, FALSE),
      COALESCE((v_role->>'mentionable')::BOOLEAN, FALSE),
      FALSE
    )
    RETURNING id INTO v_role_id;

    INSERT INTO tmp_role_map(name, role_id)
    VALUES (LOWER(COALESCE(v_role->>'name', 'new role')), v_role_id)
    ON CONFLICT (name) DO UPDATE SET role_id = EXCLUDED.role_id;
  END LOOP;

  DELETE FROM public.channels WHERE server_id = p_server_id;
  GET DIAGNOSTICS v_deleted_channels = ROW_COUNT;

  FOR v_category IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_template->'categories', '[]'::jsonb))
  LOOP
    INSERT INTO public.channels (server_id, name, type, position)
    VALUES (
      p_server_id,
      COALESCE(v_category->>'name', 'category'),
      'category',
      COALESCE((v_category->>'position')::INTEGER, 0)
    )
    RETURNING id INTO v_channel_id;

    INSERT INTO tmp_category_map(name, channel_id)
    VALUES (LOWER(COALESCE(v_category->>'name', 'category')), v_channel_id)
    ON CONFLICT (name) DO UPDATE SET channel_id = EXCLUDED.channel_id;
  END LOOP;

  FOR v_channel IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_template->'channels', '[]'::jsonb))
  LOOP
    SELECT channel_id INTO v_parent_id
    FROM tmp_category_map
    WHERE name = LOWER(COALESCE(v_channel->>'category', ''));

    INSERT INTO public.channels (
      server_id, name, type, position, topic, parent_id, slowmode_delay, nsfw, forum_guidelines
    )
    VALUES (
      p_server_id,
      COALESCE(v_channel->>'name', 'channel'),
      COALESCE(v_channel->>'type', 'text'),
      COALESCE((v_channel->>'position')::INTEGER, 0),
      NULLIF(v_channel->>'topic', ''),
      v_parent_id,
      COALESCE((v_channel->>'slowmode_delay')::INTEGER, 0),
      COALESCE((v_channel->>'nsfw')::BOOLEAN, FALSE),
      NULLIF(v_channel->>'forum_guidelines', '')
    )
    RETURNING id INTO v_channel_id;

    INSERT INTO tmp_channel_map(name, channel_id)
    VALUES (LOWER(COALESCE(v_channel->>'name', 'channel')), v_channel_id)
    ON CONFLICT (name) DO UPDATE SET channel_id = EXCLUDED.channel_id;

    FOR v_perm IN
      SELECT value FROM jsonb_array_elements(COALESCE(v_channel->'permissions', '[]'::jsonb))
    LOOP
      SELECT role_id INTO v_role_id
      FROM tmp_role_map
      WHERE name = LOWER(COALESCE(v_perm->>'role', ''));

      IF v_role_id IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.channel_permissions (channel_id, role_id, allow_permissions, deny_permissions)
      VALUES (
        v_channel_id,
        v_role_id,
        COALESCE((v_perm->>'allow')::BIGINT, 0),
        COALESCE((v_perm->>'deny')::BIGINT, 0)
      )
      ON CONFLICT (channel_id, role_id)
      DO UPDATE SET
        allow_permissions = EXCLUDED.allow_permissions,
        deny_permissions = EXCLUDED.deny_permissions;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_channels', v_deleted_channels,
    'roles_count', (SELECT COUNT(*) FROM public.roles WHERE server_id = p_server_id),
    'channels_count', (SELECT COUNT(*) FROM public.channels WHERE server_id = p_server_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.export_server_template(p_server_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT owner_id INTO v_owner FROM public.servers WHERE id = p_server_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Server not found';
  END IF;

  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Only server owner can export templates';
  END IF;

  RETURN jsonb_build_object(
    'name', (SELECT name FROM public.servers WHERE id = p_server_id),
    'description', (SELECT description FROM public.servers WHERE id = p_server_id),
    'metadata', jsonb_build_object('source', 'export', 'version', '1.0.0', 'created_by', auth.uid()::TEXT),
    'roles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', r.name,
        'color', r.color,
        'position', r.position,
        'permissions', r.permissions,
        'is_hoisted', r.is_hoisted,
        'mentionable', r.mentionable,
        'is_default', r.is_default
      ) ORDER BY r.position DESC)
      FROM public.roles r
      WHERE r.server_id = p_server_id
    ), '[]'::jsonb),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', c.name, 'position', c.position) ORDER BY c.position ASC)
      FROM public.channels c
      WHERE c.server_id = p_server_id AND c.type = 'category'
    ), '[]'::jsonb),
    'channels', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', c.name,
        'type', c.type,
        'position', c.position,
        'category', parent.name,
        'topic', c.topic,
        'slowmode_delay', c.slowmode_delay,
        'nsfw', c.nsfw,
        'forum_guidelines', c.forum_guidelines,
        'permissions', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'role', r.name,
            'allow', cp.allow_permissions,
            'deny', cp.deny_permissions
          ))
          FROM public.channel_permissions cp
          JOIN public.roles r ON r.id = cp.role_id
          WHERE cp.channel_id = c.id
        ), '[]'::jsonb)
      ) ORDER BY c.position ASC)
      FROM public.channels c
      LEFT JOIN public.channels parent ON parent.id = c.parent_id
      WHERE c.server_id = p_server_id AND c.type <> 'category'
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_server_template(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_server_template(UUID, JSONB) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.export_server_template(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_server_template(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_server_from_template(
  p_name TEXT,
  p_description TEXT,
  p_icon_url TEXT,
  p_template JSONB
)
RETURNS public.servers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_server public.servers;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO public.servers (name, description, icon_url, owner_id)
  VALUES (p_name, NULLIF(p_description, ''), NULLIF(p_icon_url, ''), auth.uid())
  RETURNING * INTO v_server;

  PERFORM public.apply_server_template(v_server.id, p_template);

  SELECT * INTO v_server FROM public.servers WHERE id = v_server.id;
  RETURN v_server;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_server_from_template(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_server_from_template(TEXT, TEXT, TEXT, JSONB) TO authenticated;
