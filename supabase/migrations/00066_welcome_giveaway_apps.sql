-- Welcome App & Giveaway App: config tables, slash commands, and updated catalog entries.

---------------------------------------------------------------------------
-- 1. Welcome App Config (per-server, tied to an installed app)
---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.welcome_app_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  welcome_message TEXT NOT NULL DEFAULT 'Welcome to the server, {user}! We''re glad to have you here.',
  rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  embed_color TEXT NOT NULL DEFAULT '#5865F2',
  dm_on_join BOOLEAN NOT NULL DEFAULT FALSE,
  dm_message TEXT,
  auto_role_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id)
);

ALTER TABLE public.welcome_app_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read welcome config"
  ON public.welcome_app_configs FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "owners manage welcome config"
  ON public.welcome_app_configs FOR ALL
  USING (public.is_server_owner(server_id))
  WITH CHECK (public.is_server_owner(server_id));

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION public.welcome_config_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

CREATE TRIGGER welcome_config_update_ts
BEFORE UPDATE ON public.welcome_app_configs
FOR EACH ROW EXECUTE FUNCTION public.welcome_config_set_updated_at();

---------------------------------------------------------------------------
-- 2. Giveaway App Config & Tables
---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.giveaway_app_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id)
);

CREATE TABLE IF NOT EXISTS public.giveaways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  prize TEXT NOT NULL,
  winners_count INTEGER NOT NULL DEFAULT 1 CHECK (winners_count >= 1 AND winners_count <= 20),
  ends_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),
  winner_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.giveaway_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id UUID NOT NULL REFERENCES public.giveaways(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (giveaway_id, user_id)
);

ALTER TABLE public.giveaway_app_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.giveaways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.giveaway_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read giveaway config"
  ON public.giveaway_app_configs FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "owners manage giveaway config"
  ON public.giveaway_app_configs FOR ALL
  USING (public.is_server_owner(server_id))
  WITH CHECK (public.is_server_owner(server_id));

CREATE POLICY "members read giveaways"
  ON public.giveaways FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "owners manage giveaways"
  ON public.giveaways FOR ALL
  USING (public.is_server_owner(server_id))
  WITH CHECK (public.is_server_owner(server_id));

CREATE POLICY "members read giveaway entries"
  ON public.giveaway_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.giveaways g
    WHERE g.id = giveaway_entries.giveaway_id
      AND public.is_server_member(g.server_id)
  ));

CREATE POLICY "members enter giveaways"
  ON public.giveaway_entries FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.giveaways g
      WHERE g.id = giveaway_entries.giveaway_id
        AND g.status = 'active'
        AND g.ends_at > NOW()
        AND public.is_server_member(g.server_id)
    )
  );

CREATE POLICY "members delete own entries"
  ON public.giveaway_entries FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update timestamps
CREATE TRIGGER giveaway_config_update_ts
BEFORE UPDATE ON public.giveaway_app_configs
FOR EACH ROW EXECUTE FUNCTION public.welcome_config_set_updated_at();

CREATE OR REPLACE FUNCTION public.giveaway_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

CREATE TRIGGER giveaway_update_ts
BEFORE UPDATE ON public.giveaways
FOR EACH ROW EXECUTE FUNCTION public.giveaway_set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_giveaways_server_id ON public.giveaways(server_id);
CREATE INDEX IF NOT EXISTS idx_giveaways_status ON public.giveaways(status);
CREATE INDEX IF NOT EXISTS idx_giveaway_entries_giveaway_id ON public.giveaway_entries(giveaway_id);

---------------------------------------------------------------------------
-- 3. Update app catalog — replace welcome-guide placeholder, add giveaway-bot
---------------------------------------------------------------------------

UPDATE public.app_catalog
SET
  name = 'Welcome Bot',
  description = 'Greet new members with custom messages, server rules, and auto-role assignment. Set a welcome channel, customize the greeting, and optionally DM newcomers.',
  category = 'community',
  permissions = ARRAY['SEND_MESSAGES','MANAGE_ROLES','READ_MESSAGES'],
  identity = '{"publisher":"VortexChat"}'::jsonb,
  trust_badge = 'verified'
WHERE slug = 'welcome-guide';

INSERT INTO public.app_catalog (slug, name, description, category, install_scopes, permissions, trust_badge, identity)
VALUES (
  'giveaway-bot',
  'Giveaway Bot',
  'Run giveaways in your server! Set a giveaway channel, create timed giveaways with prizes, and automatically draw winners.',
  'community',
  ARRAY['server','channel'],
  ARRAY['SEND_MESSAGES','READ_MESSAGES'],
  'verified',
  '{"publisher":"VortexChat"}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Ensure rate limits exist for giveaway-bot
INSERT INTO public.app_rate_limits (app_id, requests_per_minute, burst)
SELECT id, 120, 30 FROM public.app_catalog WHERE slug = 'giveaway-bot'
ON CONFLICT (app_id) DO NOTHING;

---------------------------------------------------------------------------
-- 4. Seed slash commands for Welcome Bot & Giveaway Bot
---------------------------------------------------------------------------

-- Welcome Bot commands
INSERT INTO public.app_commands (app_id, command_name, description, schema)
SELECT
  ac.id,
  cmd.name,
  cmd.description,
  cmd.schema::jsonb
FROM public.app_catalog ac
CROSS JOIN (VALUES
  ('welcome', 'Show the welcome message preview for this server', '{"args":[]}'),
  ('setwelcome', 'Set the welcome channel to the current channel', '{"args":[]}'),
  ('setrules', 'Set server rules (comma-separated list)', '{"args":[{"name":"rules","type":"string","required":true}]}'),
  ('welcomemsg', 'Set a custom welcome message. Use {user} for the member name', '{"args":[{"name":"message","type":"string","required":true}]}')
) AS cmd(name, description, schema)
WHERE ac.slug = 'welcome-guide'
ON CONFLICT (app_id, command_name) DO NOTHING;

-- Giveaway Bot commands
INSERT INTO public.app_commands (app_id, command_name, description, schema)
SELECT
  ac.id,
  cmd.name,
  cmd.description,
  cmd.schema::jsonb
FROM public.app_catalog ac
CROSS JOIN (VALUES
  ('giveaway', 'Create a new giveaway in the giveaway channel', '{"args":[{"name":"prize","type":"string","required":true},{"name":"duration","type":"string","required":true},{"name":"winners","type":"number","required":false}]}'),
  ('gend', 'End a giveaway early and draw winners', '{"args":[{"name":"giveaway_id","type":"string","required":true}]}'),
  ('gcancel', 'Cancel an active giveaway', '{"args":[{"name":"giveaway_id","type":"string","required":true}]}'),
  ('glist', 'List all active giveaways in this server', '{"args":[]}'),
  ('genter', 'Enter an active giveaway', '{"args":[{"name":"giveaway_id","type":"string","required":true}]}'),
  ('greroll', 'Re-roll winners for a completed giveaway', '{"args":[{"name":"giveaway_id","type":"string","required":true}]}')
) AS cmd(name, description, schema)
WHERE ac.slug = 'giveaway-bot'
ON CONFLICT (app_id, command_name) DO NOTHING;
