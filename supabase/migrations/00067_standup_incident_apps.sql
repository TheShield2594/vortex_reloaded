-- Standup Assistant & Incident Bot: config tables, data tables, and slash commands.

---------------------------------------------------------------------------
-- 1. Standup Assistant
---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.standup_app_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  reminder_time TIME NOT NULL DEFAULT '09:00:00',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  questions JSONB NOT NULL DEFAULT '["What did you do yesterday?","What are you working on today?","Any blockers?"]'::jsonb,
  days_active INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],  -- 1=Mon..7=Sun
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id)
);

CREATE TABLE IF NOT EXISTS public.standup_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  standup_date DATE NOT NULL DEFAULT CURRENT_DATE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id, user_id, standup_date)
);

ALTER TABLE public.standup_app_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standup_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read standup config"
  ON public.standup_app_configs FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "owners manage standup config"
  ON public.standup_app_configs FOR ALL
  USING (public.is_server_owner(server_id))
  WITH CHECK (public.is_server_owner(server_id));

CREATE POLICY "members read standup entries"
  ON public.standup_entries FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "members manage own entries"
  ON public.standup_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.is_server_member(server_id));

CREATE POLICY "members update own entries"
  ON public.standup_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_standup_entries_server_date
  ON public.standup_entries(server_id, standup_date DESC);

-- Auto-update timestamp
CREATE TRIGGER standup_config_update_ts
BEFORE UPDATE ON public.standup_app_configs
FOR EACH ROW EXECUTE FUNCTION public.welcome_config_set_updated_at();

---------------------------------------------------------------------------
-- 2. Incident Bot
---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.incident_app_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  severity_labels JSONB NOT NULL DEFAULT '["SEV1 - Critical","SEV2 - Major","SEV3 - Minor","SEV4 - Low"]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id)
);

CREATE TABLE IF NOT EXISTS public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'SEV3 - Minor',
  status TEXT NOT NULL DEFAULT 'investigating' CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  commander_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.incident_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.incident_app_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read incident config"
  ON public.incident_app_configs FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "owners manage incident config"
  ON public.incident_app_configs FOR ALL
  USING (public.is_server_owner(server_id))
  WITH CHECK (public.is_server_owner(server_id));

CREATE POLICY "members read incidents"
  ON public.incidents FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "members create incidents"
  ON public.incidents FOR INSERT
  WITH CHECK (auth.uid() = created_by AND public.is_server_member(server_id));

CREATE POLICY "owners manage incidents"
  ON public.incidents FOR ALL
  USING (public.is_server_owner(server_id))
  WITH CHECK (public.is_server_owner(server_id));

CREATE POLICY "members read incident updates"
  ON public.incident_updates FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.incidents i
    WHERE i.id = incident_updates.incident_id
      AND public.is_server_member(i.server_id)
  ));

CREATE POLICY "members create incident updates"
  ON public.incident_updates FOR INSERT
  WITH CHECK (
    auth.uid() = author_id
    AND EXISTS (
      SELECT 1 FROM public.incidents i
      WHERE i.id = incident_updates.incident_id
        AND public.is_server_member(i.server_id)
    )
  );

CREATE INDEX IF NOT EXISTS idx_incidents_server_id ON public.incidents(server_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.incidents(status);
CREATE INDEX IF NOT EXISTS idx_incident_updates_incident_id ON public.incident_updates(incident_id);

-- Auto-update timestamps
CREATE TRIGGER incident_config_update_ts
BEFORE UPDATE ON public.incident_app_configs
FOR EACH ROW EXECUTE FUNCTION public.welcome_config_set_updated_at();

CREATE TRIGGER incident_update_ts
BEFORE UPDATE ON public.incidents
FOR EACH ROW EXECUTE FUNCTION public.giveaway_set_updated_at();

---------------------------------------------------------------------------
-- 3. Update catalog entries
---------------------------------------------------------------------------

UPDATE public.app_catalog
SET
  name = 'Standup Assistant',
  description = 'Collect asynchronous daily standups with customizable questions and reminders. Set a standup channel, configure questions, and review team responses.',
  permissions = ARRAY['SEND_MESSAGES','READ_MESSAGES'],
  identity = '{"publisher":"VortexChat"}'::jsonb,
  trust_badge = 'verified'
WHERE slug = 'standup-assistant';

UPDATE public.app_catalog
SET
  name = 'Incident Bot',
  description = 'Track and manage incidents with severity levels, status updates, timeline tracking, and resolution. Keep your team informed during outages.',
  permissions = ARRAY['SEND_MESSAGES','MANAGE_MESSAGES','READ_MESSAGES'],
  identity = '{"publisher":"VortexChat"}'::jsonb,
  trust_badge = 'verified'
WHERE slug = 'incident-bot';

---------------------------------------------------------------------------
-- 4. Seed slash commands
---------------------------------------------------------------------------

-- Standup Assistant commands
INSERT INTO public.app_commands (app_id, command_name, description, schema)
SELECT
  ac.id, cmd.name, cmd.description, cmd.schema::jsonb
FROM public.app_catalog ac
CROSS JOIN (VALUES
  ('standup', 'Submit your daily standup', '{"args":[]}'),
  ('standupconfig', 'Configure standup questions and schedule', '{"args":[]}'),
  ('standupview', 'View today''s standup entries from the team', '{"args":[{"name":"date","type":"string","required":false}]}'),
  ('standupremind', 'Send a reminder to members who haven''t submitted', '{"args":[]}')
) AS cmd(name, description, schema)
WHERE ac.slug = 'standup-assistant'
ON CONFLICT (app_id, command_name) DO NOTHING;

-- Incident Bot commands
INSERT INTO public.app_commands (app_id, command_name, description, schema)
SELECT
  ac.id, cmd.name, cmd.description, cmd.schema::jsonb
FROM public.app_catalog ac
CROSS JOIN (VALUES
  ('incident', 'Open a new incident', '{"args":[{"name":"title","type":"string","required":true},{"name":"severity","type":"string","required":false}]}'),
  ('iupdate', 'Post a status update to an incident', '{"args":[{"name":"incident_id","type":"string","required":true},{"name":"message","type":"string","required":true},{"name":"status","type":"string","required":false}]}'),
  ('iresolve', 'Mark an incident as resolved', '{"args":[{"name":"incident_id","type":"string","required":true},{"name":"message","type":"string","required":false}]}'),
  ('ilist', 'List active incidents', '{"args":[]}'),
  ('itimeline', 'Show the full timeline for an incident', '{"args":[{"name":"incident_id","type":"string","required":true}]}')
) AS cmd(name, description, schema)
WHERE ac.slug = 'incident-bot'
ON CONFLICT (app_id, command_name) DO NOTHING;
