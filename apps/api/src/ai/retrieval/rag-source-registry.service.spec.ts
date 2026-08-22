import { RagSourceRegistry, type RagSourceHandler } from "./rag-source-registry.service";

function handler(sourceType: string): RagSourceHandler {
  return { sourceType, checkVisibilityAndGetName: jest.fn(), extractText: jest.fn() };
}

describe("RagSourceRegistry", () => {
  it("registers and retrieves a handler by sourceType", () => {
    const registry = new RagSourceRegistry();
    const h = handler("document");
    registry.register(h);
    expect(registry.get("document")).toBe(h);
  });

  it("throws when registering the same sourceType twice", () => {
    const registry = new RagSourceRegistry();
    registry.register(handler("document"));
    expect(() => registry.register(handler("document"))).toThrow('RAG source "document" is already registered');
  });

  it("get() returns undefined for an unregistered sourceType", () => {
    const registry = new RagSourceRegistry();
    expect(registry.get("ghost")).toBeUndefined();
  });
});
