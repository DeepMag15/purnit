import { collapsePermissions } from "../../rbac/permission-collapse";
import { bomLinesWhere } from "./bom-lines.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = []) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("bomLinesWhere (AI RAG Phase C)", () => {
  it("returns null with no bomLine:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await bomLinesWhere(tx, context([]))).toBeNull();
  });

  it("is tenant-wide once granted — no :own tier exists for this resource", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await bomLinesWhere(tx, context(["bomLine:read:tenant"]))).toEqual({ tenantId: "t1" });
  });

  it("merges caller-supplied extra filters", async () => {
    const tx = {} as unknown as PrismaTx;
    const result = await bomLinesWhere(tx, context(["bomLine:read:tenant"]), { parentItemId: "item-1" });
    expect(result).toEqual({ tenantId: "t1", parentItemId: "item-1" });
  });
});
