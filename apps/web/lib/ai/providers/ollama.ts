/**
 * Ollama (local model) adapter.
 * Uses the Ollama REST API at the configured base URL.
 */
import type { AiProviderAdapter, AiMessage, AiCompletionOptions, AiCompletionResult } from "./types"

interface OllamaConfig {
  baseUrl: string  // e.g. "http://localhost:11434"
  model: string
}

type OllamaResponse = {
  message?: { content?: string }
  prompt_eval_count?: number
  eval_count?: number
}

export class OllamaAdapter implements AiProviderAdapter {
  readonly name = "ollama"
  private readonly config: OllamaConfig

  constructor(config: OllamaConfig) {
    this.config = config
  }

  async complete(
    messages: AiMessage[],
    options: AiCompletionOptions = {}
  ): Promise<AiCompletionResult> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "")

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        ...(options.maxTokens !== undefined ? { num_predict: options.maxTokens } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
    }

    if (options.jsonMode) {
      body.format = "json"
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error")
        throw new Error(`Ollama API error ${response.status}: ${errorText}`)
      }

      const result = (await response.json()) as OllamaResponse
      const text = result.message?.content ?? ""

      return {
        text,
        usage: {
          promptTokens: result.prompt_eval_count,
          completionTokens: result.eval_count,
        },
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
