/**
 * Anthropic (Claude) adapter.
 * Uses the Anthropic Messages API directly.
 */
import type { AiProviderAdapter, AiMessage, AiCompletionOptions, AiCompletionResult } from "./types"

interface AnthropicConfig {
  apiKey: string
  baseUrl?: string
  model: string
}

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

export class AnthropicAdapter implements AiProviderAdapter {
  readonly name = "anthropic"
  private readonly config: AnthropicConfig

  constructor(config: AnthropicConfig) {
    this.config = config
  }

  async complete(
    messages: AiMessage[],
    options: AiCompletionOptions = {}
  ): Promise<AiCompletionResult> {
    const baseUrl = (this.config.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "")

    // Separate system message from conversation
    const systemMessages = messages.filter((m) => m.role === "system")
    const conversationMessages = messages.filter((m) => m.role !== "system")

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: conversationMessages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: options.maxTokens ?? 1024,
    }

    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content).join("\n\n")
    }
    if (options.temperature !== undefined) body.temperature = options.temperature

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error")
        throw new Error(`Anthropic API error ${response.status}: ${errorText}`)
      }

      const result = (await response.json()) as AnthropicResponse
      const text = result.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("") ?? ""

      return {
        text,
        usage: {
          promptTokens: result.usage?.input_tokens,
          completionTokens: result.usage?.output_tokens,
        },
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
