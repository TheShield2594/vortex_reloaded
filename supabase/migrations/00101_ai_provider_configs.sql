-- Multi-provider AI configuration with per-function routing.
--
-- Allows server owners to configure multiple AI providers (OpenAI, Anthropic,
-- Gemini, Groq, Mistral, OpenRouter, Ollama/local) and assign specific
-- providers to individual AI functions (e.g. "use OpenAI for summaries but
-- Gemini for translation").
--
-- Backwards-compatible: the existing server_secrets.gemini_api_key column
-- remains untouched so current Gemini-only servers keep working until they
-- migrate to the new system.

-- ── AI provider configurations per server ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_provider_configs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id   UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,  -- 'openai' | 'anthropic' | 'gemini' | 'groq' | 'mistral' | 'openrouter' | 'ollama'
  label       TEXT,           -- optional user-facing label, e.g. "My Local Ollama"
  api_key     TEXT,           -- encrypted at rest by Supabase; NULL for keyless providers (ollama)
  base_url    TEXT,           -- custom endpoint for local/self-hosted models (ollama, vllm, etc.)
  model       TEXT,           -- preferred model id, e.g. 'gpt-4o', 'claude-sonnet-4-20250514', 'gemini-2.5-flash'
  is_default  BOOLEAN NOT NULL DEFAULT false,  -- if true, used as the server's fallback provider
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_provider_configs_provider_check CHECK (
    provider IN ('openai', 'anthropic', 'gemini', 'groq', 'mistral', 'openrouter', 'ollama')
  ),
  -- One default per server at most (enforced via partial unique index below)
  CONSTRAINT ai_provider_configs_server_provider_unique UNIQUE (server_id, id)
);

-- Only one default provider per server
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_configs_one_default
  ON public.ai_provider_configs (server_id)
  WHERE is_default = true;

-- Fast lookups by server
CREATE INDEX IF NOT EXISTS ai_provider_configs_server_idx
  ON public.ai_provider_configs (server_id);

ALTER TABLE public.ai_provider_configs ENABLE ROW LEVEL SECURITY;

-- Owner-only access (same pattern as server_secrets)
CREATE POLICY "Server owners can view their AI provider configs"
  ON public.ai_provider_configs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = ai_provider_configs.server_id
        AND servers.owner_id = auth.uid()
    )
  );

CREATE POLICY "Server owners can insert AI provider configs"
  ON public.ai_provider_configs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = ai_provider_configs.server_id
        AND servers.owner_id = auth.uid()
    )
  );

CREATE POLICY "Server owners can update AI provider configs"
  ON public.ai_provider_configs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = ai_provider_configs.server_id
        AND servers.owner_id = auth.uid()
    )
  );

CREATE POLICY "Server owners can delete AI provider configs"
  ON public.ai_provider_configs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = ai_provider_configs.server_id
        AND servers.owner_id = auth.uid()
    )
  );

-- ── Per-function provider routing ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_function_routing (
  server_id    UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  ai_function  TEXT NOT NULL,  -- 'chat_summary' | 'voice_summary' | 'translation' | 'smart_reply' | 'semantic_search' | 'persona'
  provider_config_id UUID NOT NULL REFERENCES public.ai_provider_configs(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (server_id, ai_function),

  CONSTRAINT ai_function_routing_function_check CHECK (
    ai_function IN ('chat_summary', 'voice_summary', 'translation', 'smart_reply', 'semantic_search', 'persona')
  )
);

ALTER TABLE public.ai_function_routing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Server owners can view their AI function routing"
  ON public.ai_function_routing FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = ai_function_routing.server_id
        AND servers.owner_id = auth.uid()
    )
  );

CREATE POLICY "Server owners can insert AI function routing"
  ON public.ai_function_routing FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = ai_function_routing.server_id
        AND servers.owner_id = auth.uid()
    )
  );

CREATE POLICY "Server owners can update AI function routing"
  ON public.ai_function_routing FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = ai_function_routing.server_id
        AND servers.owner_id = auth.uid()
    )
  );

CREATE POLICY "Server owners can delete AI function routing"
  ON public.ai_function_routing FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE servers.id = ai_function_routing.server_id
        AND servers.owner_id = auth.uid()
    )
  );

COMMENT ON TABLE public.ai_provider_configs IS
  'Per-server AI provider configurations. Server owners can configure multiple providers and assign them to different AI functions.';

COMMENT ON TABLE public.ai_function_routing IS
  'Maps AI functions to specific provider configs per server. Enables per-function provider selection (e.g. OpenAI for summaries, Gemini for translation).';
