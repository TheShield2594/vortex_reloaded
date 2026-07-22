/**
 * Unified AI provider interface.
 *
 * Every provider adapter implements this interface so callers (summarise,
 * translate, smart-reply, etc.) are completely provider-agnostic.
 */

export interface AiMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface AiCompletionOptions {
  /** Maximum tokens to generate. */
  maxTokens?: number
  /** Temperature (0-2). Lower = more deterministic. */
  temperature?: number
  /** When true, the response MUST be valid JSON. */
  jsonMode?: boolean
}

export interface AiCompletionResult {
  text: string
  /** Provider-reported token usage, when available. */
  usage?: {
    promptTokens?: number
    completionTokens?: number
  }
}

/**
 * Minimal interface every provider adapter must implement.
 * Callers use `complete()` for all text-generation tasks.
 */
export interface AiProviderAdapter {
  readonly name: string
  complete(
    messages: AiMessage[],
    options?: AiCompletionOptions
  ): Promise<AiCompletionResult>
}
