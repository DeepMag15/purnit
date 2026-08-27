import { RetrievalService } from "./retrieval.service";
import { RagSourceRegistry, type RagSourceHandler } from "./rag-source-registry.service";
import { collapsePermissions } from "../../rbac/permission-collapse";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";

function ctx(): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions([]) };
}

function candidateRow(sourceId: string, sourceType = "document", content = "chunk content") {
  return { id: `e-${sourceId}`, source_type: sourceType, source_id: sourceId, content };
}

/** A real `RagSourceRegistry` (cheap, plain class) with one fake "document"
 * handler registered — replaces the old `jest.mock("...documents.data-sources")`
 * approach, since `RetrievalService` no longer imports Documents (or any
 * feature module) directly at all — it only ever talks to the registry. */
function registryWithDocumentHandler(checkVisibilityAndGetName: jest.Mock) {
  const registry = new RagSourceRegistry();
  registry.register({
    sourceType: "document",
    checkVisibilityAndGetName,
    extractText: jest.fn(),
  } satisfies RagSourceHandler);
  return registry;
}

describe("RetrievalService.retrieve", () => {
  it("Stage 2: drops a candidate the registered handler says isn't visible (same-tenant, different-scope leakage)", async () => {
    const checkVisibilityAndGetName = jest.fn().mockImplementation((_tx, _ctx, sourceId: string) =>
      sourceId === "doc-a" ? Promise.resolve("Doc A") : Promise.reject(new Error("Not allowed to view this project's documents")),
    );
    const service = new RetrievalService(registryWithDocumentHandler(checkVisibilityAndGetName));
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([candidateRow("doc-a"), candidateRow("doc-b")]) } as unknown as PrismaTx;

    const results = await service.retrieve(tx, ctx(), [0.1, 0.2, 0.3]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ sourceId: "doc-a", sourceName: "Doc A" });
  });

  it("returns no results when nothing survives Stage 2", async () => {
    const checkVisibilityAndGetName = jest.fn().mockRejectedValue(new Error("not visible"));
    const service = new RetrievalService(registryWithDocumentHandler(checkVisibilityAndGetName));
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([candidateRow("doc-a")]) } as unknown as PrismaTx;

    const results = await service.retrieve(tx, ctx(), [0.1, 0.2, 0.3]);
    expect(results).toEqual([]);
  });

  it("skips a candidate whose sourceType has no registered RagSourceHandler", async () => {
    const service = new RetrievalService(new RagSourceRegistry()); // nothing registered
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([candidateRow("doc-a")]) } as unknown as PrismaTx;

    const results = await service.retrieve(tx, ctx(), [0.1, 0.2, 0.3]);
    expect(results).toEqual([]);
  });

  it("truncates the returned results to the limit, in original candidate order, even though every candidate's visibility is now resolved up front (AI Assistant Phase F — a disclosed, intentional trade-off vs. the old per-candidate early-exit)", async () => {
    const checkVisibilityAndGetName = jest.fn().mockImplementation((_tx, _ctx, sourceId: string) => Promise.resolve(sourceId));
    const service = new RetrievalService(registryWithDocumentHandler(checkVisibilityAndGetName));
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([candidateRow("doc-a"), candidateRow("doc-b"), candidateRow("doc-c")]),
    } as unknown as PrismaTx;

    const results = await service.retrieve(tx, ctx(), [0.1, 0.2, 0.3], undefined, 2);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.sourceId)).toEqual(["doc-a", "doc-b"]);
    // No batch method on this handler — every candidate still resolves via
    // the unchanged per-id sequential path, now for all 3, not just 2.
    expect(checkVisibilityAndGetName).toHaveBeenCalledTimes(3);
  });

  it("calls a handler's batch method once for N same-type candidates, not once per candidate", async () => {
    const checkVisibilityAndGetNames = jest.fn().mockResolvedValue(new Map([["doc-a", "Doc A"], ["doc-b", "Doc B"]]));
    const registry = new RagSourceRegistry();
    registry.register({
      sourceType: "document",
      checkVisibilityAndGetName: jest.fn(),
      checkVisibilityAndGetNames,
      extractText: jest.fn(),
    } satisfies RagSourceHandler);
    const service = new RetrievalService(registry);
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([candidateRow("doc-a"), candidateRow("doc-b")]) } as unknown as PrismaTx;
    const c = ctx();

    const results = await service.retrieve(tx, c, [0.1, 0.2, 0.3]);

    expect(checkVisibilityAndGetNames).toHaveBeenCalledTimes(1);
    expect(checkVisibilityAndGetNames).toHaveBeenCalledWith(tx, c, ["doc-a", "doc-b"]);
    expect(results).toEqual([
      { sourceType: "document", sourceId: "doc-a", sourceName: "Doc A", content: "chunk content" },
      { sourceType: "document", sourceId: "doc-b", sourceName: "Doc B", content: "chunk content" },
    ]);
  });

  it("treats a candidate missing from the batch method's returned Map as not-visible, same as a null single-id return", async () => {
    const checkVisibilityAndGetNames = jest.fn().mockResolvedValue(new Map([["doc-a", "Doc A"]])); // doc-b omitted
    const registry = new RagSourceRegistry();
    registry.register({
      sourceType: "document",
      checkVisibilityAndGetName: jest.fn(),
      checkVisibilityAndGetNames,
      extractText: jest.fn(),
    } satisfies RagSourceHandler);
    const service = new RetrievalService(registry);
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([candidateRow("doc-a"), candidateRow("doc-b")]) } as unknown as PrismaTx;

    const results = await service.retrieve(tx, ctx(), [0.1, 0.2, 0.3]);
    expect(results).toEqual([{ sourceType: "document", sourceId: "doc-a", sourceName: "Doc A", content: "chunk content" }]);
  });

  it("a handler without a batch method still goes through the unchanged per-candidate sequential path, untouched by this phase", async () => {
    const checkVisibilityAndGetName = jest.fn().mockResolvedValue("Doc A");
    const service = new RetrievalService(registryWithDocumentHandler(checkVisibilityAndGetName));
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([candidateRow("doc-a")]) } as unknown as PrismaTx;
    const c = ctx();

    await service.retrieve(tx, c, [0.1, 0.2, 0.3]);
    expect(checkVisibilityAndGetName).toHaveBeenCalledWith(tx, c, "doc-a");
  });

  it("a batch-group exception fails only that group closed, without affecting a different group's results", async () => {
    const checkVisibilityAndGetNames = jest.fn().mockRejectedValue(new Error("boom"));
    const checkVisibilityAndGetNameForTask = jest.fn().mockResolvedValue("Task A");
    const registry = new RagSourceRegistry();
    registry.register({
      sourceType: "document",
      checkVisibilityAndGetName: jest.fn(),
      checkVisibilityAndGetNames,
      extractText: jest.fn(),
    } satisfies RagSourceHandler);
    registry.register({
      sourceType: "task",
      checkVisibilityAndGetName: checkVisibilityAndGetNameForTask,
      extractText: jest.fn(),
    } satisfies RagSourceHandler);
    const service = new RetrievalService(registry);
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([candidateRow("doc-a", "document"), candidateRow("task-a", "task")]),
    } as unknown as PrismaTx;

    const results = await service.retrieve(tx, ctx(), [0.1, 0.2, 0.3]);
    expect(results).toEqual([{ sourceType: "task", sourceId: "task-a", sourceName: "Task A", content: "chunk content" }]);
  });

  it("passes tenantId + optional source scoping + the query vector into the Stage 1 raw SQL call", async () => {
    const service = new RetrievalService(new RagSourceRegistry());
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as unknown as PrismaTx;
    await service.retrieve(tx, ctx(), [1, 2, 3], { sourceType: "document", sourceId: "doc-a" });

    const call = (tx.$queryRawUnsafe as jest.Mock).mock.calls[0];
    expect(call[1]).toBe("t1"); // tenantId
    expect(call[2]).toBe("document"); // sourceType filter
    expect(call[3]).toBe("doc-a"); // sourceId filter
    expect(call[4]).toBe("[1,2,3]"); // vector literal
  });
});
