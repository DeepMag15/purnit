import { collapsePermissions } from "../../rbac/permission-collapse";
import { hrDepartmentWhere, hrTeamWhere, hrCapabilitiesDataSource } from "./hr.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

describe("hrDepartmentWhere (AI RAG Phase C)", () => {
  it("returns null with no department:manage grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await hrDepartmentWhere(tx, context([]))).toBeNull();
  });

  it("is unscoped (no id filter) at :tenant", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await hrDepartmentWhere(tx, context(["department:manage:tenant"]))).toEqual({ tenantId: "t1", archivedAt: null });
  });

  it("scopes to just the actor's own department at :own", async () => {
    const tx = {} as unknown as PrismaTx;
    const result = await hrDepartmentWhere(tx, context(["department:manage:own"], "d1"));
    expect(result).toEqual({ tenantId: "t1", archivedAt: null, id: { in: ["d1"] } });
  });

  it("merges caller-supplied extra filters", async () => {
    const tx = {} as unknown as PrismaTx;
    const result = await hrDepartmentWhere(tx, context(["department:manage:tenant"]), { name: "Engineering" });
    expect(result).toEqual({ tenantId: "t1", archivedAt: null, name: "Engineering" });
  });
});

describe("hrTeamWhere (AI RAG Phase C)", () => {
  it("returns null with no department:manage grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await hrTeamWhere(tx, context([]))).toBeNull();
  });

  it("scopes to teams within the actor's own department at :own", async () => {
    const tx = {} as unknown as PrismaTx;
    const result = await hrTeamWhere(tx, context(["department:manage:own"], "d1"));
    expect(result).toEqual({ tenantId: "t1", archivedAt: null, departmentId: { in: ["d1"] } });
  });
});

describe("hr.capabilities", () => {
  const tx = {} as unknown as PrismaTx;

  it("both false with no grants at all", async () => {
    expect(await hrCapabilitiesDataSource.resolve({}, context([]), tx)).toEqual({ canManageDepartment: false, canManageUserAssignment: false });
  });

  it("canManageDepartment true with only department:manage (user:manage absent)", async () => {
    const result = await hrCapabilitiesDataSource.resolve({}, context(["department:manage:tenant"]), tx);
    expect(result).toEqual({ canManageDepartment: true, canManageUserAssignment: false });
  });

  it("canManageUserAssignment true with only user:manage (department:manage absent) — a genuinely different resource, not a fallback of the same grant", async () => {
    const result = await hrCapabilitiesDataSource.resolve({}, context(["user:manage:tenant"]), tx);
    expect(result).toEqual({ canManageDepartment: false, canManageUserAssignment: true });
  });

  it("both true when both grants are held", async () => {
    const result = await hrCapabilitiesDataSource.resolve({}, context(["department:manage:tenant", "user:manage:tenant"]), tx);
    expect(result).toEqual({ canManageDepartment: true, canManageUserAssignment: true });
  });
});
