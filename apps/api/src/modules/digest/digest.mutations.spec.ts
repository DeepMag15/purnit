import { collapsePermissions } from "../../rbac/permission-collapse";
import { userUpdateDigestPreferenceMutation } from "./digest.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(userId = "u1") {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions([]) };
}

describe("user.updateDigestPreference", () => {
  it("has no requiredPermission — ownership-only, same treatment as presence.heartbeat", () => {
    expect(userUpdateDigestPreferenceMutation.requiredPermission).toBeUndefined();
  });

  it("only ever touches the caller's own row", async () => {
    const update = jest.fn().mockResolvedValue({ id: "u1", digestOptOut: true });
    const tx = { user: { update } } as unknown as PrismaTx;

    await userUpdateDigestPreferenceMutation.resolve({ optOut: true }, context("u1"), tx);

    expect(update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { digestOptOut: true }, select: { id: true, digestOptOut: true } });
  });

  it("un-opting-out sets digestOptOut back to false", async () => {
    const update = jest.fn().mockResolvedValue({ id: "u2", digestOptOut: false });
    const tx = { user: { update } } as unknown as PrismaTx;

    await userUpdateDigestPreferenceMutation.resolve({ optOut: false }, context("u2"), tx);

    expect(update).toHaveBeenCalledWith({ where: { id: "u2" }, data: { digestOptOut: false }, select: { id: true, digestOptOut: true } });
  });
});
