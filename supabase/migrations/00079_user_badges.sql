-- Badge definitions and user badge assignments for the profile achievements system.

-- Badge catalog: defines all available badges with metadata
CREATE TABLE IF NOT EXISTS public.badge_definitions (
  id          TEXT        PRIMARY KEY,  -- e.g. 'early_adopter', 'bug_hunter'
  name        TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  icon        TEXT        NOT NULL DEFAULT 'award',  -- Lucide icon name
  color       TEXT        NOT NULL DEFAULT '#00e5ff',  -- Hex color for rendering
  category    TEXT        NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'activity', 'moderation', 'special', 'server')),
  rarity      TEXT        NOT NULL DEFAULT 'common'
    CHECK (rarity IN ('common', 'uncommon', 'rare', 'legendary')),
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User badge assignments: tracks which badges each user has earned
CREATE TABLE IF NOT EXISTS public.user_badges (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  badge_id    TEXT        NOT NULL REFERENCES public.badge_definitions(id) ON DELETE CASCADE,
  awarded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  awarded_by  UUID        REFERENCES public.users(id) ON DELETE SET NULL,  -- NULL = system-awarded
  metadata    JSONB,  -- Optional context (e.g., server_id for server-specific badges)
  UNIQUE (user_id, badge_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON public.user_badges (user_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_badge_id ON public.user_badges (badge_id);

-- RLS policies
ALTER TABLE public.badge_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

-- Anyone can read badge definitions (they're a public catalog)
CREATE POLICY "anyone can view badge definitions"
  ON public.badge_definitions FOR SELECT
  USING (true);

-- Anyone can view user badges (shown on public profiles)
CREATE POLICY "anyone can view user badges"
  ON public.user_badges FOR SELECT
  USING (true);

-- Only service role can insert/update/delete badge definitions
CREATE POLICY "service role manages badge definitions"
  ON public.badge_definitions FOR ALL
  USING (auth.role() = 'service_role');

-- Only service role can award badges (via API with permission checks)
CREATE POLICY "service role manages user badges"
  ON public.user_badges FOR ALL
  USING (auth.role() = 'service_role');

-- Seed default badge definitions
INSERT INTO public.badge_definitions (id, name, description, icon, color, category, rarity, sort_order) VALUES
  ('early_adopter',    'Early Adopter',     'Joined VortexChat during the beta period',           'rocket',     '#f59e0b', 'special',    'rare',      1),
  ('bug_hunter',       'Bug Hunter',        'Reported a verified bug',                            'bug',        '#ef4444', 'special',    'uncommon',  2),
  ('server_owner',     'Server Owner',      'Created and manages a VortexChat server',            'crown',      '#f59e0b', 'general',    'common',    3),
  ('moderator',        'Moderator',         'Serves as a moderator in a server',                  'shield',     '#6366f1', 'moderation', 'common',    4),
  ('message_veteran',  'Message Veteran',   'Sent over 10,000 messages',                          'message-circle', '#10b981', 'activity', 'uncommon', 5),
  ('voice_regular',    'Voice Regular',     'Spent over 100 hours in voice channels',             'headphones', '#8b5cf6', 'activity',   'uncommon',  6),
  ('streak_master',    'Streak Master',     'Maintained a 30-day activity streak',                'flame',      '#f97316', 'activity',   'rare',      7),
  ('event_host',       'Event Host',        'Hosted 10 or more server events',                    'calendar',   '#ec4899', 'activity',   'uncommon',  8),
  ('community_star',   'Community Star',    'Recognized for outstanding community contributions', 'star',       '#eab308', 'special',    'legendary', 9),
  ('verified',         'Verified',          'Verified account',                                   'check-circle','#00e5ff','special',    'rare',      10)
ON CONFLICT (id) DO NOTHING;
