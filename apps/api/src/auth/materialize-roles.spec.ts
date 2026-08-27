import { materializeBlueprintRoles } from "./materialize-roles";
import type { PrismaTx } from "../tenancy/tenant-prisma.service";
import type { BlueprintRoleDef } from "@purnit/manifest-schema";

function tx(existing: { id: string; sourceBlueprintRoleId: string }[] = []) {
  const create = jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: `new-${data.sourceBlueprintRoleId}`, ...data }));
  const update = jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
    Promise.resolve({ id: where.id, ...data }),
  );
  const findMany = jest.fn().mockResolvedValue(existing);
  return { role: { findMany, create, update } } as unknown as PrismaTx;
}

describe("materializeBlueprintRoles", () => {
  it("sets rank from the blueprint def's explicit rank on create", async () => {
    const roles: BlueprintRoleDef[] = [
      { id: "role.intern", label: "Intern", permissions: [], rank: 8 },
      { id: "role.admin", label: "Company Admin", permissions: [], rank: 0 },
    ];
    const t = tx();

    await materializeBlueprintRoles(t, "t1", roles);

    const create = (t as unknown as { role: { create: jest.Mock } }).role.create;
    expect(create.mock.calls[0][0].data.rank).toBe(8);
    expect(create.mock.calls[1][0].data.rank).toBe(0);
  });

  it("falls back to array/resolved position when a def has no explicit rank", async () => {
    const roles: BlueprintRoleDef[] = [
      { id: "role.a", label: "A", permissions: [] },
      { id: "role.b", label: "B", permissions: [] },
    ];
    const t = tx();

    await materializeBlueprintRoles(t, "t1", roles);

    const create = (t as unknown as { role: { create: jest.Mock } }).role.create;
    expect(create.mock.calls[0][0].data.rank).toBe(0);
    expect(create.mock.calls[1][0].data.rank).toBe(1);
  });

  it("never includes rank in the update data for an already-existing role — a reseed must not reset a Company Admin's manual reordering", async () => {
    const roles: BlueprintRoleDef[] = [{ id: "role.admin", label: "Company Admin", permissions: ["settings:manage:tenant"], rank: 0 }];
    const t = tx([{ id: "existing-row-id", sourceBlueprintRoleId: "role.admin" }]);

    await materializeBlueprintRoles(t, "t1", roles);

    const update = (t as unknown as { role: { update: jest.Mock } }).role.update;
    expect(update).toHaveBeenCalledWith({
      where: { id: "existing-row-id" },
      data: { label: "Company Admin", permissions: ["settings:manage:tenant"], extendsRoleId: null },
    });
    expect(update.mock.calls[0][0].data).not.toHaveProperty("rank");
  });
});
