/**
 * Google Gemini adapter.
 * Uses the Gemini REST API (generativelanguage.googleapis.com).
 */
import type { AiProviderAdapter, AiMessage, AiCompletionOptions, AiCompletionResult } from "./types"

interface GeminiConfig {
  apiKey: string
  model: string
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

export class GeminiAdapter implements AiProviderAdapter {
  readonly name = "gemini"
  private readonly config: GeminiConfig

  constructor(config: GeminiConfig) {
    this.config = config
  }

  async complete(
    messages: AiMessage[],
    options: AiCompletionOptions = {}
  ): Promise<AiCompletionResult> {
    const systemMessages = messages.filter((m) => m.role === "system")
    const conversationMessages = messages.filter((m) => m.role !== "system")

    const body: Record<string, unknown> = {
      contents: conversationMessages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 1024,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    }

    if (systemMessages.length > 0) {
      ;(body as Record<string, unknown>).systemInstruction = {
        parts: [{ text: systemMessages.map((m) => m.content).join("\n\n") }],
      }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.config.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error")
        throw new Error(`Gemini API error ${response.status}: ${errorText}`)
      }

      const result = (await response.json()) as GeminiResponse
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? ""

      return {
        text,
        usage: {
          promptTokens: result.usageMetadata?.promptTokenCount,
          completionTokens: result.usageMetadata?.candidatesTokenCount,
        },
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
