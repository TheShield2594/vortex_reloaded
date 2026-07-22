-- Add interests/tags array and activity visibility to users table
-- interests: up to 15 short tags, e.g. ["gaming", "ai", "self-hosting"]
-- activity_visibility: controls who sees the recent activity feed

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS interests TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS activity_visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (activity_visibility IN ('public', 'friends', 'private'));

-- Helper function to validate all interest tags (subqueries not allowed in CHECK constraints)
CREATE OR REPLACE FUNCTION public.validate_interests(tags TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    bool_and(length(tag) <= 30 AND tag ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]?$'),
    true
  )
  FROM unnest(tags) AS tag;
$$;

-- Enforce max 15 tags per user, each tag ≤ 30 chars and slug-like
ALTER TABLE public.users
  ADD CONSTRAINT users_interests_max_count
    CHECK (cardinality(interests) <= 15),
  ADD CONSTRAINT users_interests_tag_length
    CHECK (public.validate_interests(interests));

COMMENT ON COLUMN public.users.interests IS 'Interest tags displayed on the user profile, max 15, slug format';
COMMENT ON COLUMN public.users.activity_visibility IS 'Who can see the recent activity feed: public | friends | private';
