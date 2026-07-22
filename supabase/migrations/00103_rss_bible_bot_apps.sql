-- RSS Feed Bot & Bible Bot: config tables, feed/verse data, catalog entries, and slash commands.
-- RSS Feed Bot: transforms RSS feed URLs into embed messages in channels.
-- Bible Bot: delivers daily Bible verses using scripture.api.bible.

---------------------------------------------------------------------------
-- 1. RSS Feed Bot Config (per-server)
---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rss_feed_app_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  max_feeds INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id)
);

---------------------------------------------------------------------------
-- 2. RSS Feeds table (per-server feed subscriptions)
---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rss_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  feed_url TEXT NOT NULL CHECK (char_length(feed_url) <= 2048),
  feed_title TEXT CHECK (char_length(feed_title) <= 256),
  last_fetched_at TIMESTAMPTZ,
  last_entry_id TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

---------------------------------------------------------------------------
-- 3. Bible Bot Config (per-server)
---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bible_app_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  api_key TEXT CHECK (char_length(api_key) <= 512),
  bible_id TEXT NOT NULL DEFAULT 'de4e12af7f28f599-02',
  daily_verse_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  daily_verse_time TIME NOT NULL DEFAULT '08:00:00',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  embed_color TEXT NOT NULL DEFAULT '#C4A747',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id)
);

-- Note: bible_id default 'de4e12af7f28f599-02' is the King James Version on scripture.api.bible

COMMENT ON COLUMN public.bible_app_configs.api_key IS
  'Third-party API key for scripture.api.bible. Stored plain-text for server-side retrieval only; never returned by GET endpoints.';

---------------------------------------------------------------------------
-- 4. RLS
---------------------------------------------------------------------------

ALTER TABLE public.rss_feed_app_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rss_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bible_app_configs ENABLE ROW LEVEL SECURITY;

-- RSS Feed configs
CREATE POLICY "members read rss config"
  ON public.rss_feed_app_configs FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "owners manage rss config"
  ON public.rss_feed_app_configs FOR ALL
  USING (public.is_server_owner(server_id))
  WITH CHECK (public.is_server_owner(server_id));

-- RSS Feeds
CREATE POLICY "members read rss feeds"
  ON public.rss_feeds FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "owners manage rss feeds"
  ON public.rss_feeds FOR ALL
  USING (public.is_server_owner(server_id))
  WITH CHECK (public.is_server_owner(server_id));

-- Bible configs
CREATE POLICY "members read bible config"
  ON public.bible_app_configs FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "owners manage bible config"
  ON public.bible_app_configs FOR ALL
  USING (public.is_server_owner(server_id))
  WITH CHECK (public.is_server_owner(server_id));

---------------------------------------------------------------------------
-- 5. Indexes
---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_rss_feeds_server_id ON public.rss_feeds(server_id);
CREATE INDEX IF NOT EXISTS idx_rss_feeds_last_fetched ON public.rss_feeds(last_fetched_at);
CREATE INDEX IF NOT EXISTS idx_bible_configs_daily ON public.bible_app_configs(daily_verse_time)
  WHERE daily_verse_enabled = TRUE AND enabled = TRUE;

---------------------------------------------------------------------------
-- 6. Auto-update timestamps
---------------------------------------------------------------------------

CREATE TRIGGER rss_config_update_ts
BEFORE UPDATE ON public.rss_feed_app_configs
FOR EACH ROW EXECUTE FUNCTION public.welcome_config_set_updated_at();

CREATE TRIGGER bible_config_update_ts
BEFORE UPDATE ON public.bible_app_configs
FOR EACH ROW EXECUTE FUNCTION public.welcome_config_set_updated_at();

---------------------------------------------------------------------------
-- 7. Catalog entries
---------------------------------------------------------------------------

INSERT INTO public.app_catalog (slug, name, description, category, install_scopes, permissions, trust_badge, identity, is_published)
VALUES (
  'rss-feed-bot',
  'RSS Feed Bot',
  'Subscribe to RSS feeds and automatically post new articles as embed messages in your channels. Add URLs and the bot transforms them into rich embed posts.',
  'productivity',
  ARRAY['server','channel'],
  ARRAY['SEND_MESSAGES','READ_MESSAGES'],
  'verified',
  '{"publisher":"VortexChat"}'::jsonb,
  TRUE
)
ON CONFLICT (slug) DO UPDATE SET
  name           = EXCLUDED.name,
  description    = EXCLUDED.description,
  category       = EXCLUDED.category,
  install_scopes = EXCLUDED.install_scopes,
  permissions    = EXCLUDED.permissions,
  trust_badge    = EXCLUDED.trust_badge,
  identity       = EXCLUDED.identity,
  is_published   = TRUE;

INSERT INTO public.app_catalog (slug, name, description, category, install_scopes, permissions, trust_badge, identity, is_published)
VALUES (
  'bible-bot',
  'Bible Bot',
  'Deliver daily Bible verses to your server channels. Powered by scripture.api.bible — configure your API key, choose a Bible translation, and set a daily delivery time.',
  'community',
  ARRAY['server','channel'],
  ARRAY['SEND_MESSAGES','READ_MESSAGES'],
  'verified',
  '{"publisher":"VortexChat"}'::jsonb,
  TRUE
)
ON CONFLICT (slug) DO UPDATE SET
  name           = EXCLUDED.name,
  description    = EXCLUDED.description,
  category       = EXCLUDED.category,
  install_scopes = EXCLUDED.install_scopes,
  permissions    = EXCLUDED.permissions,
  trust_badge    = EXCLUDED.trust_badge,
  identity       = EXCLUDED.identity,
  is_published   = TRUE;

-- Rate limits
INSERT INTO public.app_rate_limits (app_id, requests_per_minute, burst)
SELECT id, 120, 30 FROM public.app_catalog WHERE slug = 'rss-feed-bot'
ON CONFLICT (app_id) DO NOTHING;

INSERT INTO public.app_rate_limits (app_id, requests_per_minute, burst)
SELECT id, 120, 30 FROM public.app_catalog WHERE slug = 'bible-bot'
ON CONFLICT (app_id) DO NOTHING;

---------------------------------------------------------------------------
-- 8. Slash commands — RSS Feed Bot
---------------------------------------------------------------------------

INSERT INTO public.app_commands (app_id, command_name, description, schema)
SELECT
  ac.id, cmd.name, cmd.description, cmd.schema::jsonb
FROM public.app_catalog ac
CROSS JOIN (VALUES
  ('rssfeed', 'Add an RSS feed URL to watch (e.g. /rssfeed https://blog.example.com/rss)', '{"args":[{"name":"url","type":"string","required":true}]}'),
  ('rsslist', 'List all RSS feeds configured for this server', '{"args":[]}'),
  ('rssremove', 'Remove an RSS feed by ID', '{"args":[{"name":"feed_id","type":"string","required":true}]}'),
  ('rssfetch', 'Manually fetch latest entries from all feeds', '{"args":[]}')
) AS cmd(name, description, schema)
WHERE ac.slug = 'rss-feed-bot'
ON CONFLICT (app_id, command_name) DO NOTHING;

---------------------------------------------------------------------------
-- 9. Slash commands — Bible Bot
---------------------------------------------------------------------------

INSERT INTO public.app_commands (app_id, command_name, description, schema)
SELECT
  ac.id, cmd.name, cmd.description, cmd.schema::jsonb
FROM public.app_catalog ac
CROSS JOIN (VALUES
  ('verse', 'Get a specific Bible verse (e.g. /verse John 3:16)', '{"args":[{"name":"reference","type":"string","required":true}]}'),
  ('dailyverse', 'Get today''s daily verse now', '{"args":[]}'),
  ('bibleconfig', 'View current Bible Bot configuration', '{"args":[]}')
) AS cmd(name, description, schema)
WHERE ac.slug = 'bible-bot'
ON CONFLICT (app_id, command_name) DO NOTHING;
