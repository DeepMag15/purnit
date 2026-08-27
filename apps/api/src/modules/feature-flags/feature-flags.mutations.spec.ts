import { ZodError } from "zod";
import { featureFlagSetMutation } from "./feature-flags.mutations";

function makeCtx() {
  return { tenantId: "t1" } as any;
}

describe("featureFlag.set", () => {
  it("upserts by the [tenantId, key] compound unique key", async () => {
    const upsert = jest.fn().mockResolvedValue({ id: "f1", tenantId: "t1", key: "leave", enabled: false });
    const tx = { featureFlag: { upsert } } as any;

    await featureFlagSetMutation.resolve({ key: "leave", enabled: false }, makeCtx(), tx);

    expect(upsert).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: "t1", key: "leave" } },
      create: { tenantId: "t1", key: "leave", enabled: false },
      update: { enabled: false },
    });
  });

  it("accepts lowercase, numbers, and hyphens", () => {
    expect(featureFlagSetMutation.inputSchema.safeParse({ key: "inventory-items-2", enabled: true }).success).toBe(true);
  });

  it("rejects uppercase or invalid characters in the key", () => {
    expect(featureFlagSetMutation.inputSchema.safeParse({ key: "Leave", enabled: true }).success).toBe(false);
    expect(featureFlagSetMutation.inputSchema.safeParse({ key: "leave_mgmt", enabled: true }).success).toBe(false);
    expect(featureFlagSetMutation.inputSchema.safeParse({ key: "", enabled: true }).success).toBe(false);
  });

  it("throws a ZodError, not a silent pass-through, for a malformed key", () => {
    expect(() => featureFlagSetMutation.inputSchema.parse({ key: "Bad Key!", enabled: true })).toThrow(ZodError);
  });
});
