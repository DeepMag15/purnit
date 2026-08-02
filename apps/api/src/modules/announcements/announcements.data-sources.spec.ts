import { collapsePermissions } from "../../rbac/permission-collapse";
import { announcementsWhere } from "./announcements.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions([]) };
}

describe("announcementsWhere", () => {
  it("only tenant-wide posts are visible to a user with no department", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await announcementsWhere(tx, context(null));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null, OR: [{ departmentId: null }] });
  });

  it("widens with the reader's own department when it has no ancestors (a root department)", async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: "d1" }]) } as unknown as PrismaTx;
    const where = await announcementsWhere(tx, context("d1"));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null, OR: [{ departmentId: null }, { departmentId: { in: ["d1"] } }] });
  });

  it("widens with the reader's full ancestor chain for a nested department", async () => {
    // Reader is in "grandchild", whose ancestor chain (self-inclusive) is
    // grandchild -> child -> root — matches an announcement targeting any
    // of those three, since a broadcast cascades down to descendants.
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: "grandchild" }, { id: "child" }, { id: "root" }]) } as unknown as PrismaTx;
    const where = await announcementsWhere(tx, context("grandchild"));
    expect(where).toEqual({
      tenantId: "t1",
      deletedAt: null,
      OR: [{ departmentId: null }, { departmentId: { in: ["grandchild", "child", "root"] } }],
    });
  });
});
