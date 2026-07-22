-- Curated app sections for the discover page (Featured, Trending, Staff Picks)
CREATE TABLE IF NOT EXISTS public.app_curated_sections (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT        NOT NULL UNIQUE,
  title       TEXT        NOT NULL,
  description TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Junction table: which apps belong to which curated section
CREATE TABLE IF NOT EXISTS public.app_curated_entries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id  UUID        NOT NULL REFERENCES public.app_curated_sections(id) ON DELETE CASCADE,
  app_id      UUID        NOT NULL REFERENCES public.app_catalog(id) ON DELETE CASCADE,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (section_id, app_id)
);

-- RLS: public read, admin write
ALTER TABLE public.app_curated_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_curated_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read curated sections"
  ON public.app_curated_sections FOR SELECT
  USING (true);

CREATE POLICY "Public read curated entries"
  ON public.app_curated_entries FOR SELECT
  USING (true);

-- Seed default sections
INSERT INTO public.app_curated_sections (slug, title, description, sort_order) VALUES
  ('featured',    'Featured Apps',        'Hand-picked apps to supercharge your server',   0),
  ('trending',    'Trending This Week',   'Most installed apps over the past 7 days',      1),
  ('staff-picks', 'Staff Picks',          'Recommended by the VortexChat team',            2)
ON CONFLICT (slug) DO NOTHING;
