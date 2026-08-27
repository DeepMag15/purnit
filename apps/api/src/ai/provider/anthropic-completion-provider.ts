import Anthropic from "@anthropic-ai/sdk";
import type { CompletionProvider, CompletionRequest, CompletionResult } from "./completion-provider";

function mapStopReason(reason: string | null): CompletionResult["stopReason"] {
  if (reason === "end_turn" || reason === "stop_sequence") return "end_turn";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "refusal") return "refused";
  if (reason === "tool_use") return "tool_use";
  return "error";
}

/** The default, and only, adapter shipped in Phase A — OpenAI/Gemini/Ollama
 * adapters follow later, once this interface is proven against one real
 * vendor (see the AI Assistant architecture's phased roadmap). */
export class AnthropicCompletionProvider implements CompletionProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.systemPrompt,
      // "tool" has no native Anthropic role — replayed as a plain "user"
      // turn instead (see completion-provider.ts's own doc comment on why
      // NormalizedMessage stays flat rather than gaining real tool_result
      // content-block linkage in v1).
      messages: req.messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      tools: req.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
    });

    const textBlock = response.content.find((block) => block.type === "text");
    // First tool_use block only — Phase D's disclosed v1 scope cut, even if
    // the model proposed several in one turn.
    const toolUseBlock = response.content.find((block) => block.type === "tool_use");
    return {
      content: textBlock?.type === "text" ? textBlock.text : "",
      toolCall: toolUseBlock?.type === "tool_use" ? { name: toolUseBlock.name, input: toolUseBlock.input } : undefined,
      stopReason: mapStopReason(response.stop_reason),
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }
}
