const mockGenerateContent = jest.fn();
jest.mock("@google/genai", () => ({
  __esModule: true,
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } })),
}));

import { GeminiCompletionProvider } from "./gemini-completion-provider";
import type { CompletionRequest } from "./completion-provider";

function baseRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return { systemPrompt: "You are helpful.", messages: [{ role: "user", content: "hi" }], maxTokens: 100, ...overrides };
}

describe("GeminiCompletionProvider", () => {
  beforeEach(() => mockGenerateContent.mockReset());

  it("sends no tools config when none are requested — today's behavior, byte-for-byte, unaffected by Phase D", async () => {
    mockGenerateContent.mockResolvedValue({
      text: "Hello!",
      functionCalls: undefined,
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    });
    const provider = new GeminiCompletionProvider("key", "gemini-x");
    const result = await provider.complete(baseRequest());

    expect(mockGenerateContent.mock.calls[0]![0].config.tools).toBeUndefined();
    expect(result).toEqual({ content: "Hello!", toolCall: undefined, stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 2 } });
  });

  it("maps tool declarations to functionDeclarations using the raw-JSON-Schema parametersJsonSchema field", async () => {
    mockGenerateContent.mockResolvedValue({ text: "ok", functionCalls: undefined, candidates: [{ finishReason: "STOP" }], usageMetadata: {} });
    const provider = new GeminiCompletionProvider("key", "gemini-x");
    await provider.complete(
      baseRequest({ tools: [{ name: "task.create", description: "Create a task.", inputSchema: { type: "object", properties: { title: { type: "string" } } } }] }),
    );

    expect(mockGenerateContent.mock.calls[0]![0].config.tools).toEqual([
      { functionDeclarations: [{ name: "task.create", description: "Create a task.", parametersJsonSchema: { type: "object", properties: { title: { type: "string" } } } }] },
    ]);
  });

  it("extracts the first functionCall and synthesizes stopReason 'tool_use' — Gemini has no dedicated finish reason for it", async () => {
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      functionCalls: [{ name: "task.create", args: { title: "Buy milk" } }],
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
    });
    const provider = new GeminiCompletionProvider("key", "gemini-x");
    const result = await provider.complete(baseRequest());

    expect(result.content).toBe("");
    expect(result.toolCall).toEqual({ name: "task.create", input: { title: "Buy milk" } });
    expect(result.stopReason).toBe("tool_use");
  });

  it("keeps only the first functionCall when the model proposes more than one — Phase D's disclosed v1 scope cut", async () => {
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      functionCalls: [
        { name: "task.create", args: { title: "First" } },
        { name: "leave.submit", args: {} },
      ],
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {},
    });
    const provider = new GeminiCompletionProvider("key", "gemini-x");
    const result = await provider.complete(baseRequest());

    expect(result.toolCall).toEqual({ name: "task.create", input: { title: "First" } });
  });

  it("maps a 'tool' NormalizedMessage to a plain 'user' turn — no native Gemini role for it", async () => {
    mockGenerateContent.mockResolvedValue({ text: "ok", functionCalls: undefined, candidates: [{ finishReason: "STOP" }], usageMetadata: {} });
    const provider = new GeminiCompletionProvider("key", "gemini-x");
    await provider.complete(baseRequest({ messages: [{ role: "tool", content: "Tool executed." }] }));

    expect(mockGenerateContent.mock.calls[0]![0].contents).toEqual([{ role: "user", parts: [{ text: "Tool executed." }] }]);
  });
});
