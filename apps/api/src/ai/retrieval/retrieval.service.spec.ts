import { ForbiddenException } from "@nestjs/common";
import { RetrievalService } from "./retrieval.service";
import { collapsePermissions } from "../../rbac/permission-collapse";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import { assertProjectVisible } from "../../modules/documents/documents.data-sources";

jest.mock("../../modules/documents/documents.data-sources", () => ({
  assertProjectVisible: jest.fn(),
}));

const mockedAssertProjectVisible = assertProjectVisible as jest.Mock;

function ctx(): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions([]) };
}

function candidateRow(sourceId: string, content = "chunk content") {
  return { id: `e-${sourceId}`, source_type: "document", source_id: sourceId, content };
}

describe("RetrievalService.retrieve", () => {
  let service: RetrievalService;

  beforeEach(() => {
    service = new RetrievalService();
    mockedAssertProjectVisible.mockReset();
  });

  it("Stage 2: drops a candidate whose parent project isn't visible to the actor (same-tenant, different-scope leakage)", async () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([candidateRow("doc-a"), candidateRow("doc-b")]),
      document: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: { id: string } }) =>
          where.id === "doc-a" ? { id: "doc-a", projectId: "proj-a", name: "Doc A" } : { id: "doc-b", projectId: "proj-b", name: "Doc B" },
        ),
      },
    } as unknown as PrismaTx;

    // doc-a's project is visible; doc-b's project is not (a different
    // project the actor isn't scoped to) — this is precisely what Stage 2
    // exists to catch, since Stage 1's tenant filter alone would have let
    // both through.
    mockedAssertProjectVisible.mockImplementation(async (_tx, _ctx, projectId) => {
      if (projectId === "proj-b") throw new ForbiddenException("Not allowed to view this project's documents");
    });

    const results = await service.retrieve(tx, ctx(), [0.1, 0.2, 0.3]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ sourceId: "doc-a", sourceName: "Doc A" });
  });

  it("returns no results when nothing survives Stage 2", async () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([candidateRow("doc-a")]),
      document: { findFirst: jest.fn().mockResolvedValue({ id: "doc-a", projectId: "proj-a", name: "Doc A" }) },
    } as unknown as PrismaTx;
    mockedAssertProjectVisible.mockRejectedValue(new ForbiddenException());

    const results = await service.retrieve(tx, ctx(), [0.1, 0.2, 0.3]);
    expect(results).toEqual([]);
  });

  it("skips a candidate whose document was soft-deleted since Stage 1 ran", async () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([candidateRow("doc-a")]),
      document: { findFirst: jest.fn().mockResolvedValue(null) }, // deletedAt filter excludes it
    } as unknown as PrismaTx;

    const results = await service.retrieve(tx, ctx(), [0.1, 0.2, 0.3]);
    expect(results).toEqual([]);
    expect(mockedAssertProjectVisible).not.toHaveBeenCalled();
  });

  it("stops once the result limit is reached without checking remaining candidates", async () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([candidateRow("doc-a"), candidateRow("doc-b"), candidateRow("doc-c")]),
      document: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => ({ id: where.id, projectId: `proj-${where.id}`, name: where.id })),
      },
    } as unknown as PrismaTx;
    mockedAssertProjectVisible.mockResolvedValue(undefined);

    const results = await service.retrieve(tx, ctx(), [0.1, 0.2, 0.3], undefined, 2);

    expect(results).toHaveLength(2);
    expect(tx.document.findFirst).toHaveBeenCalledTimes(2);
  });

  it("passes tenantId + optional source scoping + the query vector into the Stage 1 raw SQL call", async () => {
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as unknown as PrismaTx;
    await service.retrieve(tx, ctx(), [1, 2, 3], { sourceType: "document", sourceId: "doc-a" });

    const call = (tx.$queryRawUnsafe as jest.Mock).mock.calls[0];
    expect(call[1]).toBe("t1"); // tenantId
    expect(call[2]).toBe("document"); // sourceType filter
    expect(call[3]).toBe("doc-a"); // sourceId filter
    expect(call[4]).toBe("[1,2,3]"); // vector literal
  });
});
