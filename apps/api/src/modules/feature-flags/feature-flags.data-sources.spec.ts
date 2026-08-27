import { featureFlagsListDataSource } from "./feature-flags.data-sources";

function makeCtx() {
  return { tenantId: "t1" } as any;
}

describe("featureFlags.list", () => {
  it("scopes to the actor's tenant, ordered by key", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { featureFlag: { findMany } } as any;

    await featureFlagsListDataSource.resolve({}, makeCtx(), tx);

    expect(findMany).toHaveBeenCalledWith({ where: { tenantId: "t1" }, orderBy: { key: "asc" } });
  });

  it("returns the rows as-is", async () => {
    const rows = [{ id: "f1", tenantId: "t1", key: "leave", enabled: false, createdAt: new Date() }];
    const findMany = jest.fn().mockResolvedValue(rows);
    const tx = { featureFlag: { findMany } } as any;

    const result = await featureFlagsListDataSource.resolve({}, makeCtx(), tx);

    expect(result).toEqual(rows);
  });
});
