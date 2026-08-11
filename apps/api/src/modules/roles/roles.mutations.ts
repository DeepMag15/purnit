import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import { isKnownPermission } from "../../rbac/permission-catalog";
import { assertPermissionsGrantableByActor } from "../../rbac/permission-grant-check";
import { describeDeleteBlockers } from "../hr/hr.mutations";

/** Catalog-membership check, shared by create/update/clone — kept separate
 * from `assertPermissionsGrantableByActor` (escalation) since the two are
 * different failure modes: an unknown permission is a 400 (malformed
 * request), an ungranted-by-the-actor permission is a 403 (authorization). */
export function assertKnownPermissions(permissions: readonly string[]): void {
  for (const raw of permissions) {
    const [resource, action] = raw.split(":");
    if (!resource || !action || !isKnownPermission(resource, action)) {
      throw new BadRequestException(`"${raw}" is not a recognized permission`);
    }
  }
}

const CreateCustomRoleInputSchema = z.object({
  label: z.string().min(1),
  permissions: z.array(z.string()),
});

/** Custom roles are always flat/standalone (`extendsRoleId: null`) — see
 * ARCHITECTURE.md's Roles & Permissions section for why: it's a deliberate
 * v1 narrowing of the fuller "roles with their own extends+delta shape"
 * future item, not an oversight. Direct, natural consequence:
 * `isRoleAssignableBy`'s existing chain-walk (role-hierarchy.ts) will never
 * find a standalone role as an ancestor of any non-Admin actor's own chain,
 * so only Company Admin can assign a custom role via `user.changeRole` —
 * not a new restriction, the existing mechanism applied to a parentless
 * role. */
export const roleCreateCustomMutation: MutationDefinition<z.infer<typeof CreateCustomRoleInputSchema>> = {
  name: "role.createCustom",
  inputSchema: CreateCustomRoleInputSchema,
  requiredPermission: "role:manage",
  async resolve(input, ctx, tx) {
    assertKnownPermissions(input.permissions);
    assertPermissionsGrantableByActor(ctx.effective, input.permissions);

    // Appends at the end of the tenant's current display order, never
    // touching where existing roles (including any manually reordered by
    // the admin) already sit.
    const { _max } = await tx.role.aggregate({ where: { tenantId: ctx.tenantId }, _max: { rank: true } });

    return tx.role.create({
      data: {
        tenantId: ctx.tenantId,
        label: input.label,
        sourceBlueprintRoleId: null,
        extendsRoleId: null,
        permissions: input.permissions,
        rank: (_max.rank ?? -1) + 1,
      },
    });
  },
};

const UpdateCustomRoleInputSchema = z.object({
  roleId: z.string(),
  label: z.string().min(1).optional(),
  permissions: z.array(z.string()).optional(),
});

/** Blueprint-derived roles (`sourceBlueprintRoleId != null`) are view-only —
 * rejected here even for Company Admin. Editing one in-app would silently
 * vanish on the next `prisma db seed` run: `materializeBlueprintRoles`
 * (auth/materialize-roles.ts) unconditionally overwrites `label`/
 * `permissions`/`extendsRoleId` for every role it manages, on every reseed.
 * "Clone into a custom role, then customize the clone" (`role.clone` below)
 * is the supported path. Whole-field replace when `permissions` is given,
 * not a delta — matching `materializeBlueprintRoles`'s own semantics. */
export const roleUpdateCustomMutation: MutationDefinition<z.infer<typeof UpdateCustomRoleInputSchema>> = {
  name: "role.updateCustom",
  inputSchema: UpdateCustomRoleInputSchema,
  requiredPermission: "role:manage",
  async resolve(input, ctx, tx) {
    const role = await tx.role.findFirst({ where: { id: input.roleId, tenantId: ctx.tenantId } });
    if (!role) throw new NotFoundException(`No role "${input.roleId}"`);
    if (role.sourceBlueprintRoleId !== null) {
      throw new BadRequestException("Blueprint roles cannot be edited — clone it into a custom role first");
    }

    if (input.permissions) {
      assertKnownPermissions(input.permissions);
      assertPermissionsGrantableByActor(ctx.effective, input.permissions);
    }

    return tx.role.update({
      where: { id: input.roleId },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
      },
    });
  },
};

const CloneRoleInputSchema = z.object({
  sourceRoleId: z.string(),
  label: z.string().min(1),
});

/** Source may be blueprint or custom — cloning a blueprint role is the
 * supported "close to Executive but slightly different" path. Copies the
 * source's CURRENT materialized `permissions` array verbatim, a one-time
 * snapshot, not a live `extends` relationship (see role.createCustom's
 * comment). Still runs the escalation check against the copied set: the
 * source role's grants may exceed the actor's own (e.g. cloning role.admin
 * as a non-Admin `role:manage` holder must still be blocked). */
export const roleCloneMutation: MutationDefinition<z.infer<typeof CloneRoleInputSchema>> = {
  name: "role.clone",
  inputSchema: CloneRoleInputSchema,
  requiredPermission: "role:manage",
  async resolve(input, ctx, tx) {
    const source = await tx.role.findFirst({ where: { id: input.sourceRoleId, tenantId: ctx.tenantId } });
    if (!source) throw new NotFoundException(`No role "${input.sourceRoleId}"`);

    const permissions = source.permissions as string[];
    assertPermissionsGrantableByActor(ctx.effective, permissions);

    return tx.role.create({
      data: {
        tenantId: ctx.tenantId,
        label: input.label,
        sourceBlueprintRoleId: null,
        extendsRoleId: null,
        permissions,
      },
    });
  },
};

const DeleteRoleInputSchema = z.object({ roleId: z.string() });

/** Blueprint roles are never reachable here at all — rejected before the
 * assignment count is even checked, same as role.updateCustom. Delete is
 * blocked while the role has active assignments, reusing
 * `describeDeleteBlockers` (hr.mutations.ts) rather than duplicating the
 * exact pattern `department.delete`/`team.delete` already establish. */
export const roleDeleteMutation: MutationDefinition<z.infer<typeof DeleteRoleInputSchema>> = {
  name: "role.delete",
  inputSchema: DeleteRoleInputSchema,
  requiredPermission: "role:manage",
  async resolve(input, ctx, tx) {
    const role = await tx.role.findFirst({ where: { id: input.roleId, tenantId: ctx.tenantId } });
    if (!role) throw new NotFoundException(`No role "${input.roleId}"`);
    if (role.sourceBlueprintRoleId !== null) {
      throw new BadRequestException("Blueprint roles cannot be deleted");
    }

    const blockerMessage = describeDeleteBlockers({
      "assigned user(s)": await tx.roleAssignment.count({ where: { roleId: input.roleId, tenantId: ctx.tenantId } }),
    });
    if (blockerMessage) throw new ConflictException(blockerMessage);

    return tx.role.delete({ where: { id: input.roleId } });
  },
};

const ReorderRolesInputSchema = z.object({ roleIds: z.array(z.string()).min(1) });

/** Unlike role.updateCustom/role.delete, blueprint-sourced roles are fully
 * reorderable here — reordering never touches grants or label, only display
 * position, and letting a Company Admin control exactly this (including for
 * "System" roles like Intern) is the entire point of this mutation.
 * `roleIds` must be the tenant's complete current role-id set, in the
 * desired new order — a partial or mismatched set is rejected outright
 * (400) rather than silently re-ranking a subset. */
export const roleReorderMutation: MutationDefinition<z.infer<typeof ReorderRolesInputSchema>> = {
  name: "role.reorder",
  inputSchema: ReorderRolesInputSchema,
  requiredPermission: "role:manage",
  async resolve(input, ctx, tx) {
    const existing = await tx.role.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true } });
    const existingIds = new Set(existing.map((r) => r.id));
    const givenIds = new Set(input.roleIds);

    if (input.roleIds.length !== existingIds.size || givenIds.size !== existingIds.size || ![...existingIds].every((id) => givenIds.has(id))) {
      throw new BadRequestException("roleIds must exactly match the tenant's current full role set, with no duplicates");
    }

    for (let i = 0; i < input.roleIds.length; i++) {
      await tx.role.update({ where: { id: input.roleIds[i] }, data: { rank: i } });
    }

    return tx.role.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { rank: "asc" } });
  },
};
