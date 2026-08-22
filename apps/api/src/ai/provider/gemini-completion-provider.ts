import { GoogleGenAI } from "@google/genai";
import type { CompletionProvider, CompletionRequest, CompletionResult } from "./completion-provider";

function mapFinishReason(reason: string | undefined): CompletionResult["stopReason"] {
  if (reason === "STOP") return "end_turn";
  if (reason === "MAX_TOKENS") return "max_tokens";
  if (reason === "SAFETY" || reason === "PROHIBITED_CONTENT" || reason === "RECITATION") return "refused";
  return "error";
}

/** A second adapter, added ahead of the original phased schedule (which
 * called for Anthropic-only in this phase) because a real Gemini API key
 * was available to test against immediately, while an Anthropic key was
 * not yet — see CONTEXT.md's AI Assistant Phase A record. Proves the
 * `CompletionProvider` abstraction is genuinely swappable from day one,
 * not just in principle.
 *
 * ⚠️ Two real, live-verification-caught findings, not assumed from docs:
 * (1) the default model this codebase first tried, "gemini-2.5-flash", is
 * retired for new API keys ("no longer available to new users") — confirmed
 * live, not from stale documentation. (2) `thinkingConfig.thinkingBudget: 0`
 * (the documented way to disable Gemini's extended-thinking mode) is
 * REJECTED as an invalid argument by gemini-3.6-flash specifically —
 * confirmed by a minimal isolated repro outside this codebase entirely.
 * Thinking is therefore left enabled here; `maxOutputTokens` is sized with
 * real headroom (§ai-assistant.mutations.ts's MAX_RESPONSE_TOKENS) since
 * thinking tokens count against that same budget and a too-tight budget is
 * a genuine documented failure mode (empty responses, finishReason
 * "MAX_TOKENS") this codebase has not hit, but only because of that
 * headroom, not because the risk doesn't exist. */
export class GeminiCompletionProvider implements CompletionProvider {
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const response = await this.client.models.generateContent({
      model: this.model,
      // "tool" has no native Gemini role — replayed as a plain "user" turn
      // instead, same disclosed v1 scope cut as the Anthropic adapter.
      contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      config: {
        systemInstruction: req.systemPrompt,
        maxOutputTokens: req.maxTokens,
        // `parametersJsonSchema` (not the older OpenAPI-flavored
        // `parameters`) accepts raw JSON Schema directly — confirmed live
        // against the real API with a z.toJSONSchema() output before this
        // was built, not assumed from docs.
        tools: req.tools?.length
          ? [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema })) }]
          : undefined,
      },
    });

    const candidate = response.candidates?.[0];
    // Gemini has no dedicated finish reason for function calling (still
    // reports "STOP") — synthesized here from functionCalls presence
    // instead, first call only (Phase D's disclosed v1 scope cut).
    const functionCall = response.functionCalls?.[0];
    return {
      content: response.text ?? "",
      toolCall: functionCall?.name ? { name: functionCall.name, input: functionCall.args ?? {} } : undefined,
      stopReason: functionCall?.name ? "tool_use" : mapFinishReason(candidate?.finishReason),
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
