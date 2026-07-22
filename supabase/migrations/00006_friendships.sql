-- Friendships table
CREATE TABLE IF NOT EXISTS public.friendships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  addressee_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT friendships_unique UNIQUE (requester_id, addressee_id),
  -- Prevent self-friending
  CONSTRAINT friendships_no_self CHECK (requester_id <> addressee_id)
);

-- Index for fast lookups from either direction
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON public.friendships(requester_id);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON public.friendships(addressee_id);

-- Enable RLS
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- Users can see their own friendship rows (either side)
CREATE POLICY "users can view own friendships"
  ON public.friendships FOR SELECT
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- Only the requester can send a friend request
CREATE POLICY "users can send friend requests"
  ON public.friendships FOR INSERT
  WITH CHECK (requester_id = auth.uid());

-- The addressee can accept/decline; either party can block; either can delete
CREATE POLICY "users can update own friendships"
  ON public.friendships FOR UPDATE
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

CREATE POLICY "users can delete own friendships"
  ON public.friendships FOR DELETE
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_friendship_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_friendship_updated
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.handle_friendship_updated_at();
