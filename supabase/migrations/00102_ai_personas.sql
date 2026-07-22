-- AI Personas — custom AI bots that respond in channels.
--
-- Server owners create personas with a name, avatar, system prompt, and
-- optionally restrict them to specific channels. Members invoke personas
-- via @mention or /ask slash command.

CREATE TABLE IF NOT EXISTS public.ai_personas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id    UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  avatar_url   TEXT,
  system_prompt TEXT NOT NULL,
  description  TEXT,               -- short description shown in autocomplete
  provider_config_id UUID REFERENCES public.ai_provider_configs(id) ON DELETE SET NULL,
  allowed_channel_ids UUID[] DEFAULT '{}',  -- empty = all channels
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_personas_name_length CHECK (char_length(name) BETWEEN 1 AND 32),
  CONSTRAINT ai_personas_prompt_length CHECK (char_length(system_prompt) <= 4000)
);

-- Fast lookups by server
CREATE INDEX IF NOT EXISTS ai_personas_server_idx
  ON public.ai_personas (server_id) WHERE is_active = true;

-- Unique name per server
CREATE UNIQUE INDEX IF NOT EXISTS ai_personas_server_name_unique
  ON public.ai_personas (server_id, lower(name));

ALTER TABLE public.ai_personas ENABLE ROW LEVEL SECURITY;

-- All server members can see active personas (needed for autocomplete/mention)
CREATE POLICY "Server members can view active AI personas"
  ON public.ai_personas FOR SELECT
  USING (
    is_active = true AND
    EXISTS (
      SELECT 1 FROM public.members
      WHERE members.server_id = ai_personas.server_id
        AND members.user_id = auth.uid()
    )
  );

-- Only server owners can manage personas
CREATE POLICY "Server owners can insert AI personas"
  ON public.ai_personas FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = ai_personas.server_id
        AND servers.owner_id = auth.uid()
    )
  );

CREATE POLICY "Server owners can update AI personas"
  ON public.ai_personas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = ai_personas.server_id
        AND servers.owner_id = auth.uid()
    )
  );

CREATE POLICY "Server owners can delete AI personas"
  ON public.ai_personas FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = ai_personas.server_id
        AND servers.owner_id = auth.uid()
    )
  );

COMMENT ON TABLE public.ai_personas IS
  'Custom AI personas (bots) that respond in channels. Server owners configure name, avatar, and system prompt.';
