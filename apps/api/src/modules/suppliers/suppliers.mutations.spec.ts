import { NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { supplierCreateMutation, supplierUpdateStatusMutation } from "./suppliers.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1") {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("supplier.create", () => {
  it("creates a supplier scoped to the tenant, createdById from ctx", async () => {
    const tx = { supplier: { create: jest.fn().mockResolvedValue({ id: "s1" }) } } as unknown as PrismaTx;
    await supplierCreateMutation.resolve({ name: "Acme Corp", contactEmail: "a@acme.test" }, context(["supplier:create:tenant"]), tx);
    const call = (tx as unknown as { supplier: { create: jest.Mock } }).supplier.create.mock.calls[0][0];
    expect(call.data).toMatchObject({ tenantId: "t1", name: "Acme Corp", contactEmail: "a@acme.test", createdById: "u1" });
  });
});

describe("supplier.updateStatus", () => {
  it("throws NotFoundException for a supplier that doesn't exist", async () => {
    const tx = { supplier: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(supplierUpdateStatusMutation.resolve({ id: "ghost", status: "inactive" }, context(["supplier:update:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("updates the status", async () => {
    const tx = {
      supplier: {
        findFirst: jest.fn().mockResolvedValue({ id: "s1", status: "active" }),
        update: jest.fn().mockResolvedValue({ id: "s1", status: "inactive" }),
      },
    } as unknown as PrismaTx;
    await supplierUpdateStatusMutation.resolve({ id: "s1", status: "inactive" }, context(["supplier:update:tenant"]), tx);
    expect((tx as unknown as { supplier: { update: jest.Mock } }).supplier.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { status: "inactive" },
    });
  });
});
