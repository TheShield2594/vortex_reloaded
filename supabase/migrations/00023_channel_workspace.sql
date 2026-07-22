-- Channel workspace: tasks + docs + unified search helpers
CREATE TABLE IF NOT EXISTS public.channel_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'blocked')),
  due_date TIMESTAMPTZ,
  assignee_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  updated_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_vector TSVECTOR
);

CREATE TABLE IF NOT EXISTS public.channel_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  updated_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_vector TSVECTOR
);

CREATE TABLE IF NOT EXISTS public.workspace_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('task', 'doc')),
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_tasks_channel ON public.channel_tasks(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_docs_channel ON public.channel_docs(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_updates_channel ON public.workspace_updates(channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_tasks_fts ON public.channel_tasks USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_channel_docs_fts ON public.channel_docs USING gin(search_vector);

CREATE OR REPLACE FUNCTION public.workspace_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channel_tasks_touch_updated_at ON public.channel_tasks;
CREATE TRIGGER channel_tasks_touch_updated_at
  BEFORE UPDATE ON public.channel_tasks
  FOR EACH ROW EXECUTE FUNCTION public.workspace_touch_updated_at();

DROP TRIGGER IF EXISTS channel_docs_touch_updated_at ON public.channel_docs;
CREATE TRIGGER channel_docs_touch_updated_at
  BEFORE UPDATE ON public.channel_docs
  FOR EACH ROW EXECUTE FUNCTION public.workspace_touch_updated_at();

CREATE OR REPLACE FUNCTION public.channel_tasks_search_vector_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channel_tasks_search_vector_trigger ON public.channel_tasks;
CREATE TRIGGER channel_tasks_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, description ON public.channel_tasks
  FOR EACH ROW EXECUTE FUNCTION public.channel_tasks_search_vector_update();

CREATE OR REPLACE FUNCTION public.channel_docs_search_vector_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.title, '') || ' ' || coalesce(NEW.content, ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channel_docs_search_vector_trigger ON public.channel_docs;
CREATE TRIGGER channel_docs_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, content ON public.channel_docs
  FOR EACH ROW EXECUTE FUNCTION public.channel_docs_search_vector_update();

ALTER TABLE public.channel_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view channel tasks"
  ON public.channel_tasks FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "members with send_messages can create channel tasks"
  ON public.channel_tasks FOR INSERT
  WITH CHECK (public.has_permission(server_id, 2) OR public.has_permission(server_id, 64));

CREATE POLICY "members with send_messages can update channel tasks"
  ON public.channel_tasks FOR UPDATE
  USING (public.has_permission(server_id, 2) OR public.has_permission(server_id, 64));

CREATE POLICY "members with manage_messages can delete channel tasks"
  ON public.channel_tasks FOR DELETE
  USING (public.has_permission(server_id, 4) OR public.has_permission(server_id, 64));

CREATE POLICY "members can view channel docs"
  ON public.channel_docs FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "members with send_messages can create channel docs"
  ON public.channel_docs FOR INSERT
  WITH CHECK (public.has_permission(server_id, 2) OR public.has_permission(server_id, 64));

CREATE POLICY "members with send_messages can update channel docs"
  ON public.channel_docs FOR UPDATE
  USING (public.has_permission(server_id, 2) OR public.has_permission(server_id, 64));

CREATE POLICY "members with manage_messages can delete channel docs"
  ON public.channel_docs FOR DELETE
  USING (public.has_permission(server_id, 4) OR public.has_permission(server_id, 64));

CREATE POLICY "members can view workspace updates"
  ON public.workspace_updates FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "members can create workspace updates"
  ON public.workspace_updates FOR INSERT
  WITH CHECK (public.is_server_member(server_id));

-- Notifications for task/doc updates into channel as lightweight system messages.
CREATE OR REPLACE FUNCTION public.insert_workspace_update_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bot_id UUID;
  content_text TEXT;
  action_name TEXT;
BEGIN
  SELECT id INTO bot_id FROM public.users WHERE username = 'vortex-system' LIMIT 1;
  IF bot_id IS NULL THEN
    RETURN NEW;
  END IF;

  action_name := CASE TG_OP
    WHEN 'INSERT' THEN 'created'
    WHEN 'UPDATE' THEN 'updated'
    WHEN 'DELETE' THEN 'deleted'
    ELSE lower(TG_OP)
  END;

  IF TG_TABLE_NAME = 'channel_tasks' THEN
    content_text := format('Workspace update: Task "%s" %s. [task:%s]', coalesce(COALESCE(NEW.title, OLD.title), 'Untitled'), action_name, COALESCE(NEW.id, OLD.id));
  ELSE
    content_text := format('Workspace update: Doc "%s" %s. [doc:%s]', coalesce(COALESCE(NEW.title, OLD.title), 'Untitled'), action_name, COALESCE(NEW.id, OLD.id));
  END IF;

  INSERT INTO public.messages (channel_id, author_id, content)
  VALUES (COALESCE(NEW.channel_id, OLD.channel_id), bot_id, content_text);

  INSERT INTO public.workspace_updates (server_id, channel_id, actor_id, entity_type, entity_id, action, metadata)
  VALUES (
    COALESCE(NEW.server_id, OLD.server_id),
    COALESCE(NEW.channel_id, OLD.channel_id),
    COALESCE(NEW.updated_by, OLD.updated_by, NEW.created_by, OLD.created_by, bot_id),
    CASE WHEN TG_TABLE_NAME = 'channel_tasks' THEN 'task' ELSE 'doc' END,
    COALESCE(NEW.id, OLD.id),
    action_name,
    jsonb_build_object('title', COALESCE(NEW.title, OLD.title))
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS channel_tasks_update_message_trigger ON public.channel_tasks;
CREATE TRIGGER channel_tasks_update_message_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.channel_tasks
  FOR EACH ROW EXECUTE FUNCTION public.insert_workspace_update_message();

DROP TRIGGER IF EXISTS channel_docs_update_message_trigger ON public.channel_docs;
CREATE TRIGGER channel_docs_update_message_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.channel_docs
  FOR EACH ROW EXECUTE FUNCTION public.insert_workspace_update_message();
