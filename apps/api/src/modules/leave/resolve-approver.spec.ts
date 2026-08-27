import { resolveApprover } from "./resolve-approver";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

describe("resolveApprover", () => {
  it("returns the requester's managerId when set", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue({ managerId: "m1" }) } } as unknown as PrismaTx;
    const result = await resolveApprover(tx, "t1", "u1");
    expect(result).toBe("m1");
    expect((tx as unknown as { user: { findFirst: jest.Mock } }).user.findFirst).toHaveBeenCalledWith({
      where: { id: "u1", tenantId: "t1" },
      select: { managerId: true },
    });
  });

  it("returns null when the requester has no manager set", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue({ managerId: null }) } } as unknown as PrismaTx;
    const result = await resolveApprover(tx, "t1", "u1");
    expect(result).toBeNull();
  });

  it("returns null when the requester row itself isn't found", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    const result = await resolveApprover(tx, "t1", "ghost");
    expect(result).toBeNull();
  });
});
