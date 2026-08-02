import { collapsePermissions } from "../../rbac/permission-collapse";
import { meetingsWhere } from "./meetings.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

describe("meetingsWhere", () => {
  it("returns the participant floor alone when the actor has no meeting:read grant (e.g. an Intern)", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await meetingsWhere(tx, context(), {});
    expect(where).toEqual({ tenantId: "t1", OR: [{ organizerId: "u1" }, { participants: { some: { userId: "u1" } } }] });
  });

  it("widens with a department condition alongside the floor at team/department scope", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await meetingsWhere(tx, context(["meeting:read:department"], "d1"), {});
    expect(where).toEqual({
      tenantId: "t1",
      OR: [{ organizerId: "u1" }, { participants: { some: { userId: "u1" } } }, { departmentId: "d1" }],
    });
  });

  it("widens with the resolved subtree at department-subtree scope", async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: "d1" }, { id: "d2" }]) } as unknown as PrismaTx;
    const where = await meetingsWhere(tx, context(["meeting:read:department-subtree"], "d1"), {});
    expect(where).toEqual({
      tenantId: "t1",
      OR: [{ organizerId: "u1" }, { participants: { some: { userId: "u1" } } }, { departmentId: { in: ["d1", "d2"] } }],
    });
  });

  it("drops the OR entirely (sees everything) at tenant scope", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await meetingsWhere(tx, context(["meeting:read:tenant"]), {});
    expect(where).toEqual({ tenantId: "t1" });
  });

  it("merges in extra where-clause fields passed by the caller", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await meetingsWhere(tx, context(), { cancelledAt: null });
    expect(where).toEqual({
      tenantId: "t1",
      cancelledAt: null,
      OR: [{ organizerId: "u1" }, { participants: { some: { userId: "u1" } } }],
    });
  });
});
