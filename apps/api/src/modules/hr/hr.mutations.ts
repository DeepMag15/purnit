import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";
import { isRoleAssignableBy } from "../../rbac/role-hierarchy";
import { logAudit } from "../../audit/log-audit";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

/** Pure, exported, unit-testable — `ownSubtreeIds` is the department-being-
 * reparented's own subtree (its id plus every descendant, per
 * `getDepartmentSubtreeIds`'s own contract). A candidate new parent creates
 * a cycle iff it's that department itself or anywhere within its subtree. */
export function wouldCreateCycle(candidateParentId: string, ownSubtreeIds: string[]): boolean {
  return ownSubtreeIds.includes(candidateParentId);
}

const CreateDepartmentInputSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().optional(),
  type: z.string().optional(),
});

export const departmentCreateMutation: MutationDefinition<z.infer<typeof CreateDepartmentInputSchema>> = {
  name: "department.create",
  inputSchema: CreateDepartmentInputSchema,
  requiredPermission: "department:manage",
  async resolve(input, ctx, tx) {
    const scope = ctx.effective.has("department", "manage");
    // "own" (Department Head) doesn't mean anything for *creating* a
    // brand-new department — reject outright rather than silently
    // narrowing to some department. An Executive (department-subtree) may
    // create a department anywhere within their own subtree; only a
    // tenant-wide grant may create anywhere at all.
    if (scope === "department-subtree") {
      if (!input.parentId || !ctx.userDepartmentId) {
        throw new ForbiddenException("Executives may only create departments within their own subtree");
      }
      const subtreeIds = await getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId);
      if (!subtreeIds.includes(input.parentId)) {
        throw new ForbiddenException("Not allowed to create a department outside your own subtree");
      }
    } else if (scope !== "tenant") {
      throw new ForbiddenException("Not allowed to create departments");
    }
    if (input.parentId) {
      const parent = await tx.department.findFirst({ where: { id: input.parentId, tenantId: ctx.tenantId } });
      if (!parent) throw new BadRequestException(`No department "${input.parentId}" in this tenant`);
    }
    const department = await tx.department.create({ data: { tenantId: ctx.tenantId, name: input.name, parentId: input.parentId, type: input.type } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "department", department.id); // AI RAG Phase C
    return department;
  },
};

/** Shared authorization for any mutation that targets one *existing*
 * department by id — the create-time scope logic above is about where a
 * *new* department may be placed; this is about which *existing*
 * departments an actor may act on at all. `"own"` means exactly the one
 * department the actor themselves belongs to (Department Head); unlike
 * `department.create`, editing/archiving/deleting your own department is
 * meaningful, so `"own"` is accepted here, not rejected. */
async function assertCanManageDepartment(tx: PrismaTx, ctx: { tenantId: string; userDepartmentId: string | null; effective: { has(resource: string, action: string): string | null } }, departmentId: string): Promise<void> {
  const scope = ctx.effective.has("department", "manage");
  if (scope === "tenant") return;
  if (scope === "own") {
    if (departmentId === ctx.userDepartmentId) return;
    throw new ForbiddenException("Not allowed to manage a department other than your own");
  }
  if (scope === "department-subtree" && (await isWithinActorsSubtree(tx, ctx.tenantId, ctx.userDepartmentId, departmentId))) {
    return;
  }
  throw new ForbiddenException("Not allowed to manage this department");
}

const UpdateDepartmentInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  type: z.string().optional(),
  parentId: z.string().nullable().optional(),
});

export const departmentUpdateMutation: MutationDefinition<z.infer<typeof UpdateDepartmentInputSchema>> = {
  name: "department.update",
  inputSchema: UpdateDepartmentInputSchema,
  requiredPermission: "department:manage",
  async resolve(input, ctx, tx) {
    const department = await tx.department.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
    if (!department) throw new NotFoundException(`No department "${input.id}"`);
    await assertCanManageDepartment(tx, ctx, input.id);

    if (input.parentId !== undefined && input.parentId !== null) {
      if (input.parentId === input.id) {
        throw new BadRequestException("A department cannot be its own parent");
      }
      const parent = await tx.department.findFirst({ where: { id: input.parentId, tenantId: ctx.tenantId } });
      if (!parent) throw new BadRequestException(`No department "${input.parentId}" in this tenant`);
      // Reject cycles before they're written — getDepartmentSubtreeIds is a
      // UNION ALL recursive CTE with no cycle guard of its own, and every
      // department-subtree scope check tenant-wide depends on it never
      // looping. Walking *this* department's own subtree and rejecting the
      // new parent if it's a descendant is the one place that has to catch
      // this, since nothing downstream ever will.
      const ownSubtreeIds = await getDepartmentSubtreeIds(tx, ctx.tenantId, input.id);
      if (wouldCreateCycle(input.parentId, ownSubtreeIds)) {
        throw new BadRequestException("Cannot move a department under its own descendant");
      }
      const scope = ctx.effective.has("department", "manage");
      if (scope === "department-subtree" && !(await isWithinActorsSubtree(tx, ctx.tenantId, ctx.userDepartmentId, input.parentId))) {
        throw new ForbiddenException("Not allowed to move a department outside your own subtree");
      }
    }

    const updated = await tx.department.update({
      where: { id: input.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "department", updated.id); // AI RAG Phase C
    return updated;
  },
};

const SetDepartmentArchivedInputSchema = z.object({ id: z.string(), archived: z.boolean() });

export const departmentSetArchivedMutation: MutationDefinition<z.infer<typeof SetDepartmentArchivedInputSchema>> = {
  name: "department.setArchived",
  inputSchema: SetDepartmentArchivedInputSchema,
  requiredPermission: "department:manage",
  async resolve(input, ctx, tx) {
    const department = await tx.department.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
    if (!department) throw new NotFoundException(`No department "${input.id}"`);
    await assertCanManageDepartment(tx, ctx, input.id);

    return tx.department.update({ where: { id: input.id }, data: { archivedAt: input.archived ? new Date() : null } });
  },
};

/** Pure, exported, unit-testable — same convention as `mergeNavigationLabelPatch`
 * elsewhere in this codebase. Turns raw counts into a human-readable blocker
 * list, or `null` if nothing blocks deletion. Kept separate from the counting
 * queries themselves so the message-construction logic has no `tx` to mock. */
export function describeDeleteBlockers(counts: Record<string, number>): string | null {
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`);
  return parts.length > 0 ? `Cannot delete: still has ${parts.join(", ")}. Move or reassign them first.` : null;
}

const DeleteDepartmentInputSchema = z.object({ id: z.string() });

export const departmentDeleteMutation: MutationDefinition<z.infer<typeof DeleteDepartmentInputSchema>> = {
  name: "department.delete",
  inputSchema: DeleteDepartmentInputSchema,
  requiredPermission: "department:manage",
  async resolve(input, ctx, tx) {
    const department = await tx.department.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
    if (!department) throw new NotFoundException(`No department "${input.id}"`);
    await assertCanManageDepartment(tx, ctx, input.id);

    // Hard-blocked, not cascaded — Team.departmentId is NOT NULL and every
    // scope check in this codebase reads User.departmentId directly (no FK
    // at all on that column), so this application-level check is the *only*
    // safeguard for the user case, not defense-in-depth on top of a DB one.
    // Merge/bulk-transfer (reassign everything elsewhere first) is
    // deliberately future work, not solved here.
    const blockerMessage = describeDeleteBlockers({
      "child department(s)": await tx.department.count({ where: { parentId: input.id, tenantId: ctx.tenantId } }),
      "team(s)": await tx.team.count({ where: { departmentId: input.id, tenantId: ctx.tenantId } }),
      "member(s)": await tx.user.count({ where: { departmentId: input.id, tenantId: ctx.tenantId, deletedAt: null } }),
    });
    if (blockerMessage) throw new ConflictException(blockerMessage);

    const deleted = await tx.department.delete({ where: { id: input.id } });

    // Audit Logs (module 6 of 6) — org-structure deletes are one of the
    // bounded, high-value categories this module exists for.
    await logAudit(tx, ctx, { action: "department.delete", resource: "department", resourceId: input.id, before: { name: department.name } });

    return deleted;
  },
};

const CreateTeamInputSchema = z.object({
  name: z.string().min(1),
  departmentId: z.string(),
});

/** Shared by `team.create`'s own-department check and (once needed
 * elsewhere) any other department-subtree-gated mutation — resolves only
 * when the scope actually is `"department-subtree"`. */
async function isWithinActorsSubtree(tx: PrismaTx, tenantId: string, actorDepartmentId: string | null, targetDepartmentId: string): Promise<boolean> {
  if (!actorDepartmentId) return false;
  const subtreeIds = await getDepartmentSubtreeIds(tx, tenantId, actorDepartmentId);
  return subtreeIds.includes(targetDepartmentId);
}

export const teamCreateMutation: MutationDefinition<z.infer<typeof CreateTeamInputSchema>> = {
  name: "team.create",
  inputSchema: CreateTeamInputSchema,
  requiredPermission: "department:manage",
  async resolve(input, ctx, tx) {
    // Department Head's `department:manage:own` may only create teams
    // inside the one department they themselves belong to. An Executive
    // (department-subtree) may create a team anywhere within their subtree.
    const scope = ctx.effective.has("department", "manage");
    if (scope === "own" && input.departmentId !== ctx.userDepartmentId) {
      throw new ForbiddenException("Not allowed to create teams in a different department");
    }
    if (scope === "department-subtree" && !(await isWithinActorsSubtree(tx, ctx.tenantId, ctx.userDepartmentId, input.departmentId))) {
      throw new ForbiddenException("Not allowed to create teams outside your own subtree");
    }

    const department = await tx.department.findFirst({ where: { id: input.departmentId, tenantId: ctx.tenantId } });
    if (!department) throw new BadRequestException(`No department "${input.departmentId}" in this tenant`);
    const team = await tx.team.create({ data: { tenantId: ctx.tenantId, name: input.name, departmentId: input.departmentId } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "team", team.id); // AI RAG Phase C
    return team;
  },
};

/** Same shape as `assertCanManageDepartment`, scoped to an existing team via
 * its own `departmentId` — `"own"` means the team's department is the
 * actor's own department. */
async function assertCanManageTeam(tx: PrismaTx, ctx: { tenantId: string; userDepartmentId: string | null; effective: { has(resource: string, action: string): string | null } }, team: { departmentId: string }): Promise<void> {
  const scope = ctx.effective.has("department", "manage");
  if (scope === "tenant") return;
  if (scope === "own") {
    if (team.departmentId === ctx.userDepartmentId) return;
    throw new ForbiddenException("Not allowed to manage a team outside your own department");
  }
  if (scope === "department-subtree" && (await isWithinActorsSubtree(tx, ctx.tenantId, ctx.userDepartmentId, team.departmentId))) {
    return;
  }
  throw new ForbiddenException("Not allowed to manage this team");
}

const UpdateTeamInputSchema = z.object({ id: z.string(), name: z.string().min(1) });

export const teamUpdateMutation: MutationDefinition<z.infer<typeof UpdateTeamInputSchema>> = {
  name: "team.update",
  inputSchema: UpdateTeamInputSchema,
  requiredPermission: "department:manage",
  async resolve(input, ctx, tx) {
    const team = await tx.team.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
    if (!team) throw new NotFoundException(`No team "${input.id}"`);
    await assertCanManageTeam(tx, ctx, team);

    const updated = await tx.team.update({ where: { id: input.id }, data: { name: input.name } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "team", updated.id); // AI RAG Phase C
    return updated;
  },
};

const MoveTeamInputSchema = z.object({ id: z.string(), departmentId: z.string() });

// Kept separate from `team.update` rather than folded in — a single-purpose
// mutation for a single-purpose UI action, matching the existing
// `team.create`/`department.create` split rather than a combined "PATCH
// anything" mutation. Moving a team never touches any User row — every
// scope check in this codebase reads User.departmentId directly, never
// through Team.departmentId (confirmed during planning), so this is safe
// from a scoping-correctness standpoint on its own.
export const teamMoveToDepartmentMutation: MutationDefinition<z.infer<typeof MoveTeamInputSchema>> = {
  name: "team.moveToDepartment",
  inputSchema: MoveTeamInputSchema,
  requiredPermission: "department:manage",
  async resolve(input, ctx, tx) {
    const team = await tx.team.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
    if (!team) throw new NotFoundException(`No team "${input.id}"`);
    await assertCanManageTeam(tx, ctx, team);

    const destination = await tx.department.findFirst({ where: { id: input.departmentId, tenantId: ctx.tenantId } });
    if (!destination) throw new BadRequestException(`No department "${input.departmentId}" in this tenant`);
    // The *destination* must also be somewhere the actor is allowed to place
    // a team — same rule `team.create` already applies to a brand-new team.
    const scope = ctx.effective.has("department", "manage");
    if (scope === "own" && input.departmentId !== ctx.userDepartmentId) {
      throw new ForbiddenException("Not allowed to move a team into a different department");
    }
    if (scope === "department-subtree" && !(await isWithinActorsSubtree(tx, ctx.tenantId, ctx.userDepartmentId, input.departmentId))) {
      throw new ForbiddenException("Not allowed to move a team outside your own subtree");
    }

    const updated = await tx.team.update({ where: { id: input.id }, data: { departmentId: input.departmentId } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "team", updated.id); // AI RAG Phase C
    return updated;
  },
};

const SetTeamArchivedInputSchema = z.object({ id: z.string(), archived: z.boolean() });

export const teamSetArchivedMutation: MutationDefinition<z.infer<typeof SetTeamArchivedInputSchema>> = {
  name: "team.setArchived",
  inputSchema: SetTeamArchivedInputSchema,
  requiredPermission: "department:manage",
  async resolve(input, ctx, tx) {
    const team = await tx.team.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
    if (!team) throw new NotFoundException(`No team "${input.id}"`);
    await assertCanManageTeam(tx, ctx, team);

    return tx.team.update({ where: { id: input.id }, data: { archivedAt: input.archived ? new Date() : null } });
  },
};

const DeleteTeamInputSchema = z.object({ id: z.string() });

export const teamDeleteMutation: MutationDefinition<z.infer<typeof DeleteTeamInputSchema>> = {
  name: "team.delete",
  inputSchema: DeleteTeamInputSchema,
  requiredPermission: "department:manage",
  async resolve(input, ctx, tx) {
    const team = await tx.team.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
    if (!team) throw new NotFoundException(`No team "${input.id}"`);
    await assertCanManageTeam(tx, ctx, team);

    const blockerMessage = describeDeleteBlockers({
      "member(s)": await tx.user.count({ where: { teamId: input.id, tenantId: ctx.tenantId, deletedAt: null } }),
    });
    if (blockerMessage) throw new ConflictException(blockerMessage);

    const deleted = await tx.team.delete({ where: { id: input.id } });

    await logAudit(tx, ctx, { action: "team.delete", resource: "team", resourceId: input.id, before: { name: team.name } });

    return deleted;
  },
};

/** Resolves the real `Role` a given blueprint tier should map to for a
 * specific department type — checking `DepartmentTypeRoleLabel.overrideRoleId`
 * first (e.g. HR's Manager tier -> role.hr-manager, a genuinely different
 * role, not just a different label) and falling back to the tenant's plain
 * `sourceBlueprintRoleId` role otherwise. Same lookup `users.data-sources.ts`
 * already does for *display labels*, applied here to role *resolution* —
 * without this, assigning a team manager inside an HR-typed department
 * would silently hand out the generic Manager role instead of HR Manager,
 * losing the real bonus permissions that tier is supposed to carry. */
export async function resolveDepartmentTierRole(tx: PrismaTx, tenantId: string, departmentType: string | null, sourceBlueprintRoleId: string) {
  if (departmentType) {
    const overlay = await tx.departmentTypeRoleLabel.findFirst({
      where: { tenantId, departmentType, sourceBlueprintRoleId },
    });
    if (overlay?.overrideRoleId) {
      const overrideRole = await tx.role.findFirst({ where: { id: overlay.overrideRoleId, tenantId } });
      if (overrideRole) return overrideRole;
    }
  }
  const role = await tx.role.findFirst({ where: { tenantId, sourceBlueprintRoleId } });
  if (!role) throw new BadRequestException(`No role materialized for "${sourceBlueprintRoleId}" in this tenant`);
  return role;
}

/** Replaces whichever role(s) a user currently holds with exactly one new
 * role — same single-role-per-user delete+recreate `user.changeRole` uses. */
async function replaceUserRole(tx: PrismaTx, tenantId: string, userId: string, roleId: string): Promise<void> {
  await tx.roleAssignment.deleteMany({ where: { tenantId, userId } });
  await tx.roleAssignment.create({ data: { tenantId, userId, roleId } });
}

const AssignDepartmentHeadInputSchema = z.object({ departmentId: z.string(), userId: z.string() });

// Gated on `department:manage` alone (matching where this action lives —
// Org Structure — and this codebase's one-permission-per-mutation
// convention), with `isRoleAssignableBy` as the hierarchy safety net that
// caps *which* role can actually be handed out. This is a deliberate,
// bounded expansion of what `department:manage` can do: Department
// Head/Executive/HR Manager, none of whom hold `role:assign` today, gain a
// narrow ability to grant the department-head role specifically, scoped to
// departments they already manage. Stated explicitly, not left implicit.
//
// Deliberately does its own direct `tx.user.update` rather than delegating
// to `userAssignDepartmentMutation` — that mutation's own scope check
// resolves `user:manage` at `"own"` for an Executive (who only ever holds
// `user:manage:own`), which would incorrectly reject exactly the case this
// mutation exists for: an Executive assigning a head to a department
// elsewhere in their own subtree, not just their own exact department.
export const departmentAssignHeadMutation: MutationDefinition<z.infer<typeof AssignDepartmentHeadInputSchema>> = {
  name: "department.assignHead",
  inputSchema: AssignDepartmentHeadInputSchema,
  requiredPermission: "department:manage",
  async resolve(input, ctx, tx) {
    const department = await tx.department.findFirst({ where: { id: input.departmentId, tenantId: ctx.tenantId } });
    if (!department) throw new NotFoundException(`No department "${input.departmentId}"`);
    await assertCanManageDepartment(tx, ctx, input.departmentId);

    const user = await tx.user.findFirst({ where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!user) throw new NotFoundException(`No user "${input.userId}"`);

    const role = await resolveDepartmentTierRole(tx, ctx.tenantId, department.type, "role.department-head");
    if (!(await isRoleAssignableBy(tx, ctx.tenantId, ctx.userId, role.id))) {
      throw new ForbiddenException(`Not allowed to assign role "${role.label}"`);
    }

    await tx.user.update({ where: { id: input.userId }, data: { departmentId: input.departmentId, teamId: null } });
    await replaceUserRole(tx, ctx.tenantId, input.userId, role.id);
    return { success: true };
  },
};

const AssignTeamManagerInputSchema = z.object({ teamId: z.string(), userId: z.string() });

// Same reasoning as departmentAssignHeadMutation above.
export const teamAssignManagerMutation: MutationDefinition<z.infer<typeof AssignTeamManagerInputSchema>> = {
  name: "team.assignManager",
  inputSchema: AssignTeamManagerInputSchema,
  requiredPermission: "department:manage",
  async resolve(input, ctx, tx) {
    const team = await tx.team.findFirst({ where: { id: input.teamId, tenantId: ctx.tenantId } });
    if (!team) throw new NotFoundException(`No team "${input.teamId}"`);
    await assertCanManageTeam(tx, ctx, team);

    const user = await tx.user.findFirst({ where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!user) throw new NotFoundException(`No user "${input.userId}"`);

    const department = await tx.department.findFirst({ where: { id: team.departmentId, tenantId: ctx.tenantId } });
    const role = await resolveDepartmentTierRole(tx, ctx.tenantId, department?.type ?? null, "role.project-manager");
    if (!(await isRoleAssignableBy(tx, ctx.tenantId, ctx.userId, role.id))) {
      throw new ForbiddenException(`Not allowed to assign role "${role.label}"`);
    }

    await tx.user.update({ where: { id: input.userId }, data: { departmentId: team.departmentId, teamId: input.teamId } });
    await replaceUserRole(tx, ctx.tenantId, input.userId, role.id);
    return { success: true };
  },
};
