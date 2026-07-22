// ── AI Provider & Function Routing Types ─────────────────────────────────────
// Shared between frontend settings UI, API routes, and the AI adapter layer.

/** Supported AI providers. */
export const AI_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "mistral",
  "openrouter",
  "ollama",
] as const

export type AiProvider = (typeof AI_PROVIDERS)[number]

/** Human-readable metadata for each provider. */
export const AI_PROVIDER_META: Record<
  AiProvider,
  { label: string; defaultModel: string; requiresApiKey: boolean; supportsBaseUrl: boolean; placeholder: string }
> = {
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o",
    requiresApiKey: true,
    supportsBaseUrl: true,
    placeholder: "sk-...",
  },
  anthropic: {
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-20250514",
    requiresApiKey: true,
    supportsBaseUrl: true,
    placeholder: "sk-ant-...",
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    requiresApiKey: true,
    supportsBaseUrl: false,
    placeholder: "AIza...",
  },
  groq: {
    label: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    requiresApiKey: true,
    supportsBaseUrl: false,
    placeholder: "gsk_...",
  },
  mistral: {
    label: "Mistral",
    defaultModel: "mistral-large-latest",
    requiresApiKey: true,
    supportsBaseUrl: false,
    placeholder: "",
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "anthropic/claude-sonnet-4-20250514",
    requiresApiKey: true,
    supportsBaseUrl: false,
    placeholder: "sk-or-...",
  },
  ollama: {
    label: "Ollama (Local)",
    defaultModel: "llama3.2",
    requiresApiKey: false,
    supportsBaseUrl: true,
    placeholder: "",
  },
}

/** AI functions that can be independently routed to different providers. */
export const AI_FUNCTIONS = [
  "chat_summary",
  "voice_summary",
  "translation",
  "smart_reply",
  "semantic_search",
  "persona",
] as const

export type AiFunction = (typeof AI_FUNCTIONS)[number]

/** Human-readable metadata for each AI function. */
export const AI_FUNCTION_META: Record<AiFunction, { label: string; description: string }> = {
  chat_summary: {
    label: "Channel Summaries",
    description: "AI-powered catch-up summaries of channel conversations",
  },
  voice_summary: {
    label: "Voice Call Recaps",
    description: "Post-call summaries with highlights, decisions, and action items",
  },
  translation: {
    label: "Translation",
    description: "Auto-translate messages and voice subtitles",
  },
  smart_reply: {
    label: "Smart Replies",
    description: "Contextual reply suggestions in the message composer",
  },
  semantic_search: {
    label: "Semantic Search",
    description: "AI-powered search across message history by meaning",
  },
  persona: {
    label: "AI Personas",
    description: "Custom AI bots that respond in channels with configurable personalities",
  },
}

/** Shape of a provider config row from the database. */
export interface AiProviderConfig {
  id: string
  server_id: string
  provider: AiProvider
  label: string | null
  api_key: string | null
  base_url: string | null
  model: string | null
  is_default: boolean
  created_at: string
  updated_at: string
}

/** Shape of a function routing row from the database. */
export interface AiFunctionRouting {
  server_id: string
  ai_function: AiFunction
  provider_config_id: string
  created_at: string
  updated_at: string
}

/** Request body for creating/updating a provider config. */
export interface AiProviderConfigInput {
  provider: AiProvider
  label?: string | null
  apiKey?: string | null
  baseUrl?: string | null
  model?: string | null
  isDefault?: boolean
}

/** Request body for updating function routing. */
export interface AiFunctionRoutingInput {
  aiFunction: AiFunction
  providerConfigId: string | null  // null = clear routing (use default)
}

/** The resolved config needed to make an AI call for a specific function. */
export interface ResolvedAiProvider {
  provider: AiProvider
  apiKey: string | null
  baseUrl: string | null
  model: string
}
