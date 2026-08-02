import Anthropic from "@anthropic-ai/sdk";
import type { CompletionProvider, CompletionRequest, CompletionResult } from "./completion-provider";

function mapStopReason(reason: string | null): CompletionResult["stopReason"] {
  if (reason === "end_turn" || reason === "stop_sequence") return "end_turn";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "refusal") return "refused";
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
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const textBlock = response.content.find((block) => block.type === "text");
    return {
      content: textBlock?.type === "text" ? textBlock.text : "",
      stopReason: mapStopReason(response.stop_reason),
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }
}
