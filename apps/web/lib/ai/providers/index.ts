/**
 * Provider adapter factory.
 *
 * Given a ResolvedAiProvider (provider name + credentials), returns the
 * correct adapter instance ready to call `.complete()`.
 */
import type { ResolvedAiProvider } from "@vortex/shared"
import type { AiProviderAdapter } from "./types"
import { OpenAiAdapter } from "./openai"
import { AnthropicAdapter } from "./anthropic"
import { GeminiAdapter } from "./gemini"
import { OllamaAdapter } from "./ollama"

export type { AiProviderAdapter, AiMessage, AiCompletionOptions, AiCompletionResult } from "./types"

/**
 * Create the appropriate adapter for a resolved provider config.
 * Throws if required credentials are missing.
 */
export function createAdapter(config: ResolvedAiProvider): AiProviderAdapter {
  switch (config.provider) {
    case "openai":
      if (!config.apiKey) throw new Error("OpenAI requires an API key")
      return new OpenAiAdapter({ apiKey: config.apiKey, baseUrl: config.baseUrl ?? undefined, model: config.model })

    case "anthropic":
      if (!config.apiKey) throw new Error("Anthropic requires an API key")
      return new AnthropicAdapter({ apiKey: config.apiKey, baseUrl: config.baseUrl ?? undefined, model: config.model })

    case "gemini":
      if (!config.apiKey) throw new Error("Gemini requires an API key")
      return new GeminiAdapter({ apiKey: config.apiKey, model: config.model })

    case "groq":
      if (!config.apiKey) throw new Error("Groq requires an API key")
      // Groq exposes an OpenAI-compatible endpoint
      return new OpenAiAdapter(
        { apiKey: config.apiKey, baseUrl: "https://api.groq.com/openai/v1", model: config.model },
        "groq"
      )

    case "mistral":
      if (!config.apiKey) throw new Error("Mistral requires an API key")
      return new OpenAiAdapter(
        { apiKey: config.apiKey, baseUrl: "https://api.mistral.ai/v1", model: config.model },
        "mistral"
      )

    case "openrouter":
      if (!config.apiKey) throw new Error("OpenRouter requires an API key")
      return new OpenAiAdapter(
        {
          apiKey: config.apiKey,
          baseUrl: "https://openrouter.ai/api/v1",
          model: config.model,
          extraHeaders: { "HTTP-Referer": "https://vortexchat.app" },
        },
        "openrouter"
      )

    case "ollama":
      if (!config.baseUrl) throw new Error("Ollama requires a base URL (e.g. http://localhost:11434)")
      return new OllamaAdapter({ baseUrl: config.baseUrl, model: config.model })

    default: {
      const _exhaustive: never = config.provider
      throw new Error(`Unknown AI provider: ${_exhaustive}`)
    }
  }
}
