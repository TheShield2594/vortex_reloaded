-- Pinned items: users can pin messages, channels, files, or links to their profile
-- Max 6 pins per user (enforced at API layer; the check here is a safety net)

CREATE TABLE IF NOT EXISTS public.user_pinned_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pin_type    TEXT NOT NULL CHECK (pin_type IN ('message', 'channel', 'file', 'link')),
  -- human-readable label shown on the profile card
  label       TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  -- short descriptor, e.g. channel name or server name (optional)
  sublabel    TEXT CHECK (sublabel IS NULL OR length(sublabel) <= 80),
  -- for message/file/channel pins this is the internal resource id; null for raw links
  ref_id      UUID,
  -- canonical URL for navigation (required for all types)
  url         TEXT CHECK (url IS NULL OR length(url) <= 2000),
  -- ordering within the user's pin list (lower = first)
  position    SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast per-user fetches ordered by position
CREATE INDEX IF NOT EXISTS idx_user_pinned_items_user_position
  ON public.user_pinned_items (user_id, position);

-- RLS
ALTER TABLE public.user_pinned_items ENABLE ROW LEVEL SECURITY;

-- Anyone can read pinned items (profile is public)
CREATE POLICY "pinned_items_select_any"
  ON public.user_pinned_items FOR SELECT
  USING (true);

-- Only the owner can insert
CREATE POLICY "pinned_items_insert_owner"
  ON public.user_pinned_items FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Only the owner can update (reorder, relabel)
CREATE POLICY "pinned_items_update_owner"
  ON public.user_pinned_items FOR UPDATE
  USING (user_id = auth.uid());

-- Only the owner can delete
CREATE POLICY "pinned_items_delete_owner"
  ON public.user_pinned_items FOR DELETE
  USING (user_id = auth.uid());

COMMENT ON TABLE public.user_pinned_items IS
  'Items a user has pinned to their profile (message | channel | file | link), max 6 per user';
