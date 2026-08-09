import { collapsePermissions } from "../../rbac/permission-collapse";
import { documentsPendingApprovalsMetric } from "./documents.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("documentsPendingApprovalsMetric (Phase F)", () => {
  it("requires project:read and has no snapshot", () => {
    expect(documentsPendingApprovalsMetric.requiredPermission).toBe("project:read");
    expect(documentsPendingApprovalsMetric.kind).toBe("breakdown");
  });

  it("returns [] when the actor has no project:read grant at all", async () => {
    const tx = { project: { findMany: jest.fn() }, document: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await documentsPendingApprovalsMetric.computeLive(context([]), tx)).toEqual([]);
    expect((tx as unknown as { project: { findMany: jest.Mock } }).project.findMany).not.toHaveBeenCalled();
  });

  it("returns [] when there are no visible projects", async () => {
    const tx = {
      project: { findMany: jest.fn().mockResolvedValue([]) },
      document: { findMany: jest.fn() },
    } as unknown as PrismaTx;
    expect(await documentsPendingApprovalsMetric.computeLive(context(["project:read:tenant"]), tx)).toEqual([]);
    expect((tx as unknown as { document: { findMany: jest.Mock } }).document.findMany).not.toHaveBeenCalled();
  });

  it("returns pending documents scoped to visible projects, formatted with the parent project name and computed daysPending", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    const tx = {
      project: { findMany: jest.fn().mockResolvedValue([{ id: "p1" }]) },
      document: {
        findMany: jest.fn().mockResolvedValue([{ id: "d1", name: "Budget.pdf", updatedAt: threeDaysAgo, project: { name: "Alpha" } }]),
      },
    } as unknown as PrismaTx;

    const rows = await documentsPendingApprovalsMetric.computeLive(context(["project:read:tenant"]), tx);
    expect(rows).toEqual([{ document: "Budget.pdf (Alpha)", daysPending: 3 }]);
    const call = (tx as unknown as { document: { findMany: jest.Mock } }).document.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1", projectId: { in: ["p1"] }, approvalStatus: "pending", deletedAt: null });
  });
});
