import { collapsePermissions } from "../../rbac/permission-collapse";
import { assignmentsDueSoonCountMetric } from "./assignments.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("assignments metrics", () => {
  it("assignmentsDueSoonCountMetric requires assignment:read", () => {
    expect(assignmentsDueSoonCountMetric.requiredPermission).toBe("assignment:read");
  });

  it("assignmentsDueSoonCountMetric.computeLive filters on a now->+7-day dueDate window via assignmentsWhere", async () => {
    const tx = { assignment: { count: jest.fn().mockResolvedValue(2) } } as unknown as PrismaTx;
    const value = await assignmentsDueSoonCountMetric.computeLive(context(["assignment:read:tenant"]), tx);
    expect(value).toBe(2);
    const call = (tx as unknown as { assignment: { count: jest.Mock } }).assignment.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1" });
    const dueDate = call.where.dueDate as { gte: Date; lte: Date };
    expect(dueDate.lte.getTime() - dueDate.gte.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("assignmentsDueSoonCountMetric.computeLive returns 0 with no assignment:read grant (e.g. Registrar)", async () => {
    const tx = { assignment: { count: jest.fn() } } as unknown as PrismaTx;
    expect(await assignmentsDueSoonCountMetric.computeLive(context(["enrollment:read:tenant"]), tx)).toBe(0);
    expect((tx as unknown as { assignment: { count: jest.Mock } }).assignment.count).not.toHaveBeenCalled();
  });

  it("assignmentsDueSoonCountMetric.computeLive narrows to the teacher's own courses at :own scope", async () => {
    const tx = {
      assignment: { count: jest.fn().mockResolvedValue(1) },
      course: { findMany: jest.fn().mockResolvedValue([{ id: "c1" }]) },
    } as unknown as PrismaTx;
    await assignmentsDueSoonCountMetric.computeLive(context(["assignment:read:own"]), tx);
    const call = (tx as unknown as { assignment: { count: jest.Mock } }).assignment.count.mock.calls[0][0];
    expect(call.where.courseId).toEqual({ in: ["c1"] });
  });
});
