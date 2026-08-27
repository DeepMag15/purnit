import OpenAI from "openai";
import type { CompletionProvider, CompletionRequest, CompletionResult } from "./completion-provider";

function mapFinishReason(reason: string | null): CompletionResult["stopReason"] {
  if (reason === "stop") return "end_turn";
  if (reason === "length") return "max_tokens";
  if (reason === "tool_calls") return "tool_use";
  if (reason === "content_filter") return "refused";
  return "error";
}

/**
 * A third adapter (AI Assistant Phase F), added once a real gap was
 * confirmed against the original architecture doc's own intent (OpenAI
 * named alongside Anthropic/Gemini/Ollama from day one — see
 * `completion-provider.ts`'s own history). Uses the Chat Completions API
 * (`client.chat.completions.create`), not the newer Responses API — same
 * "boring, most stable, best-documented endpoint" reasoning that made
 * Anthropic's Messages API and Gemini's `generateContent` the safe choices
 * for the first two adapters.
 *
 * ⚠️ No `OPENAI_API_KEY` exists in this project (confirmed via `.env`), so
 * this adapter is verified only against the real, installed `openai@7.5.0`
 * package's own TypeScript types — never against a live call. Same
 * disclosed-limitation category as Anthropic's own still-unverified
 * tool-calling path (Phase D). Two mapping details confirmed directly from
 * the installed types, not memory, since this codebase has been burned
 * twice trusting a remembered vendor default (`gemini-2.5-flash`
 * retirement, `thinkingBudget: 0` rejection):
 * (1) `max_tokens` is deprecated in favor of `max_completion_tokens` in the
 * installed SDK's `ChatCompletionCreateParamsBase` — using the deprecated
 * field still works today but `max_completion_tokens` is used here as the
 * current, non-deprecated field.
 * (2) `tool_calls[].function.arguments` is a JSON *string*, unlike
 * Anthropic's `tool_use.input`/Gemini's `functionCall.args` which the SDK
 * already parses into an object — must be `JSON.parse()`d before building
 * `ProposedToolCall.input`, or a well-formed tool call would silently fail
 * `MutationRegistry`'s `inputSchema.safeParse()` downstream and the
 * proposal would just never surface, no error thrown anywhere.
 */
export class OpenAiCompletionProvider implements CompletionProvider {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: req.maxTokens,
      messages: [
        { role: "system", content: req.systemPrompt },
        // "tool" has no native OpenAI role reachable without a tool_call_id
        // to link back to — replayed as a plain "user" turn instead, same
        // disclosed v1 scope cut `NormalizedMessage` already forces on the
        // Anthropic/Gemini adapters.
        ...req.messages.map((m) => ({ role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user", content: m.content })),
      ],
      tools: req.tools?.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
    });

    const message = response.choices[0]?.message;
    // First function tool call only — Phase D's disclosed v1 scope cut,
    // even if the model proposed several in one turn. `type === "function"`
    // narrows away the SDK's newer "custom tool call" variant, which this
    // codebase never registers (every allowlisted tool is a plain function).
    const toolCall = message?.tool_calls?.find((tc) => tc.type === "function");

    return {
      content: message?.content ?? "",
      toolCall: toolCall ? { name: toolCall.function.name, input: JSON.parse(toolCall.function.arguments) } : undefined,
      stopReason: mapFinishReason(response.choices[0]?.finish_reason ?? null),
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}
