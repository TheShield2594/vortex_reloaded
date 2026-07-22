/**
 * OpenAI-compatible adapter.
 *
 * Also works with any provider that exposes an OpenAI-compatible
 * /v1/chat/completions endpoint (e.g. Groq, OpenRouter, Mistral, local vLLM).
 */
import type { AiProviderAdapter, AiMessage, AiCompletionOptions, AiCompletionResult } from "./types"

interface OpenAiConfig {
  apiKey: string
  baseUrl?: string
  model: string
  /** Extra headers (e.g. OpenRouter HTTP-Referer). */
  extraHeaders?: Record<string, string>
}

type OpenAiResponse = {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export class OpenAiAdapter implements AiProviderAdapter {
  readonly name: string
  private readonly config: OpenAiConfig

  constructor(config: OpenAiConfig, name = "openai") {
    this.config = config
    this.name = name
  }

  async complete(
    messages: AiMessage[],
    options: AiCompletionOptions = {}
  ): Promise<AiCompletionResult> {
    const baseUrl = (this.config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }

    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
    if (options.temperature !== undefined) body.temperature = options.temperature
    if (options.jsonMode) body.response_format = { type: "json_object" }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      ...this.config.extraHeaders,
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error")
        throw new Error(`${this.name} API error ${response.status}: ${errorText}`)
      }

      const result = (await response.json()) as OpenAiResponse
      const text = result.choices?.[0]?.message?.content ?? ""

      return {
        text,
        usage: {
          promptTokens: result.usage?.prompt_tokens,
          completionTokens: result.usage?.completion_tokens,
        },
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
