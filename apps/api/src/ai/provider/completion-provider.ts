export interface NormalizedMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  systemPrompt: string;
  messages: NormalizedMessage[];
  maxTokens: number;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  content: string;
  stopReason: "end_turn" | "max_tokens" | "refused" | "error";
  usage: CompletionUsage;
}

/** The one seam every module talks to a model through — no module ever
 * imports a vendor SDK directly. Phase A ships a single adapter
 * (AnthropicCompletionProvider); `tools`/`stream` are deliberately absent
 * from this interface until tool-calling/streaming are actually built
 * (later phases), rather than speculatively shaped in now. */
export interface CompletionProvider {
  complete(req: CompletionRequest): Promise<CompletionResult>;
}
