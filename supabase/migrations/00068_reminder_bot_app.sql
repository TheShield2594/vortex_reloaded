-- Reminder Bot: config table, reminders table, catalog entry, and slash commands.
-- Users can set personal or channel reminders up to 24 hours in the future.

---------------------------------------------------------------------------
-- 1. Reminder App Config (per-server)
---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reminder_app_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  max_reminders_per_user INTEGER NOT NULL DEFAULT 10,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id)
);

---------------------------------------------------------------------------
-- 2. Reminders table
---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (char_length(message) <= 500),
  remind_at TIMESTAMPTZ NOT NULL,
  delivered BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

---------------------------------------------------------------------------
-- 3. RLS
---------------------------------------------------------------------------

ALTER TABLE public.reminder_app_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read reminder config"
  ON public.reminder_app_configs FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "owners manage reminder config"
  ON public.reminder_app_configs FOR ALL
  USING (public.is_server_owner(server_id))
  WITH CHECK (public.is_server_owner(server_id));

CREATE POLICY "members read own reminders"
  ON public.reminders FOR SELECT
  USING (auth.uid() = user_id AND public.is_server_member(server_id));

CREATE POLICY "members create reminders"
  ON public.reminders FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_server_member(server_id)
    AND remind_at <= NOW() + INTERVAL '24 hours'
    AND remind_at > NOW()
  );

CREATE POLICY "members delete own reminders"
  ON public.reminders FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "members update own reminders"
  ON public.reminders FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

---------------------------------------------------------------------------
-- 4. Indexes
---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_reminders_server_id ON public.reminders(server_id);
CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON public.reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON public.reminders(remind_at)
  WHERE delivered = FALSE;

---------------------------------------------------------------------------
-- 5. Auto-update timestamp
---------------------------------------------------------------------------

CREATE TRIGGER reminder_config_update_ts
BEFORE UPDATE ON public.reminder_app_configs
FOR EACH ROW EXECUTE FUNCTION public.welcome_config_set_updated_at();

---------------------------------------------------------------------------
-- 6. Catalog entry
---------------------------------------------------------------------------

INSERT INTO public.app_catalog (slug, name, description, category, install_scopes, permissions, trust_badge, identity)
VALUES (
  'reminder-bot',
  'Reminder Bot',
  'Set personal reminders up to 24 hours in advance. Use /reminder to schedule a reminder with a message and time, and get notified when it''s due.',
  'productivity',
  ARRAY['server','channel'],
  ARRAY['SEND_MESSAGES','READ_MESSAGES'],
  'verified',
  '{"publisher":"VortexChat"}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Rate limits
INSERT INTO public.app_rate_limits (app_id, requests_per_minute, burst)
SELECT id, 120, 30 FROM public.app_catalog WHERE slug = 'reminder-bot'
ON CONFLICT (app_id) DO NOTHING;

---------------------------------------------------------------------------
-- 7. Slash commands
---------------------------------------------------------------------------

INSERT INTO public.app_commands (app_id, command_name, description, schema)
SELECT
  ac.id, cmd.name, cmd.description, cmd.schema::jsonb
FROM public.app_catalog ac
CROSS JOIN (VALUES
  ('reminder', 'Set a reminder (e.g. /reminder 2h Review the PR)', '{"args":[{"name":"time","type":"string","required":true},{"name":"message","type":"string","required":true}]}'),
  ('reminders', 'List your active reminders', '{"args":[]}'),
  ('rcancel', 'Cancel a reminder by ID', '{"args":[{"name":"reminder_id","type":"string","required":true}]}')
) AS cmd(name, description, schema)
WHERE ac.slug = 'reminder-bot'
ON CONFLICT (app_id, command_name) DO NOTHING;
