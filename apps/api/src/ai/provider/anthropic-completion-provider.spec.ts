const mockAnthropicCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockAnthropicCreate } })),
}));

import { AnthropicCompletionProvider } from "./anthropic-completion-provider";
import type { CompletionRequest } from "./completion-provider";

function baseRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return { systemPrompt: "You are helpful.", messages: [{ role: "user", content: "hi" }], maxTokens: 100, ...overrides };
}

describe("AnthropicCompletionProvider", () => {
  beforeEach(() => mockAnthropicCreate.mockReset());

  it("sends no tools param when none are requested — today's behavior, byte-for-byte, unaffected by Phase D", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    const provider = new AnthropicCompletionProvider("key", "claude-x");
    const result = await provider.complete(baseRequest());

    expect(mockAnthropicCreate.mock.calls[0]![0].tools).toBeUndefined();
    expect(result).toEqual({ content: "Hello!", toolCall: undefined, stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 2 } });
  });

  it("maps tool declarations to Anthropic's input_schema shape", async () => {
    mockAnthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    const provider = new AnthropicCompletionProvider("key", "claude-x");
    await provider.complete(
      baseRequest({ tools: [{ name: "task.create", description: "Create a task.", inputSchema: { type: "object", properties: { title: { type: "string" } } } }] }),
    );

    expect(mockAnthropicCreate.mock.calls[0]![0].tools).toEqual([
      { name: "task.create", description: "Create a task.", input_schema: { type: "object", properties: { title: { type: "string" } } } },
    ]);
  });

  it("extracts a tool_use block alongside a text block, and maps stop_reason 'tool_use'", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [
        { type: "text", text: "Sure, creating that now." },
        { type: "tool_use", id: "call_1", name: "task.create", input: { title: "Buy milk" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 8 },
    });
    const provider = new AnthropicCompletionProvider("key", "claude-x");
    const result = await provider.complete(baseRequest());

    expect(result.content).toBe("Sure, creating that now.");
    expect(result.toolCall).toEqual({ name: "task.create", input: { title: "Buy milk" } });
    expect(result.stopReason).toBe("tool_use");
  });

  it("keeps only the first tool_use block when the model proposes more than one — Phase D's disclosed v1 scope cut", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [
        { type: "tool_use", id: "call_1", name: "task.create", input: { title: "First" } },
        { type: "tool_use", id: "call_2", name: "leave.submit", input: {} },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const provider = new AnthropicCompletionProvider("key", "claude-x");
    const result = await provider.complete(baseRequest());

    expect(result.toolCall).toEqual({ name: "task.create", input: { title: "First" } });
  });

  it("maps a 'tool' NormalizedMessage to a plain 'user' turn — no native Anthropic role for it", async () => {
    mockAnthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    const provider = new AnthropicCompletionProvider("key", "claude-x");
    await provider.complete(baseRequest({ messages: [{ role: "tool", content: "Tool executed." }] }));

    expect(mockAnthropicCreate.mock.calls[0]![0].messages).toEqual([{ role: "user", content: "Tool executed." }]);
  });
});
