import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Scope } from "@antigravity/manifest-schema";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";

/** Who (if anyone) should be notified of an assignee-affecting task change.
 * `null` covers both "no assignee" and "the actor is the assignee" —
 * telling someone about their own action isn't a notification. Extracted
 * as a pure function (same reasoning as `projectsWhere`) so the branching
 * is unit-testable without mocking Prisma. */
export function notificationRecipientFor(assigneeId: string | null | undefined, actorId: string): string | null {
  if (!assigneeId || assigneeId === actorId) return null;
  return assigneeId;
}

/** A task's assignee must be the project's owner or an existing
 * `ProjectMember` — the "Project Manager assigns tasks to people who are
 * part of the project" boundary, left soft (UI-only) when `ProjectMember`
 * was first built, now enforced server-side. Deliberately not required for
 * self-assignment (a creator/reassigner assigning to *themselves* already
 * has authorization via task:create/task:update scope, regardless of formal
 * project membership). */
async function assertAssigneeIsProjectMember(tx: PrismaTx, projectId: string, projectOwnerId: string | null, assigneeId: string) {
  if (assigneeId === projectOwnerId) return;
  const isMember = await tx.projectMember.findFirst({ where: { projectId, userId: assigneeId } });
  if (!isMember) throw new BadRequestException(`User "${assigneeId}" is not a member of this project`);
}

/** Shared scope-check for row-level task mutations (`task.updateStatus`,
 * `task.reassign`) — Task's "owner" for scope purposes is its assignee (no
 * `ownerId` column on Task); department comes from the owning Project (no
 * `departmentId` on Task either) — same adaptation as `tasksWhere`. */
async function requireTaskInScope(tx: PrismaTx, ctx: { tenantId: string; userId: string; userDepartmentId: string | null; effective: { has: (r: string, a: string) => Scope | null } }, taskId: string) {
  const existing = await tx.task.findFirst({
    where: { id: taskId, tenantId: ctx.tenantId, deletedAt: null },
    include: { project: { select: { id: true, ownerId: true, departmentId: true } } },
  });
  if (!existing) throw new NotFoundException(`No task "${taskId}"`);

  const scope = ctx.effective.has("task", "update");
  // Only resolved when actually needed — the common case (department/team/
  // tenant/own scope) never pays for this query. See department-subtree.ts.
  const departmentSubtreeIds =
    scope === "department-subtree" && ctx.userDepartmentId ? await getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : undefined;
  const inScope =
    scope &&
    isRowInScope(
      scope,
      { ownerId: existing.assigneeId, departmentId: existing.project.departmentId },
      { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds },
    );
  if (!inScope) throw new ForbiddenException("Not allowed to update this task");

  return existing;
}

const CreateInputSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeId: z.string().optional(),
  priority: z.string().optional(),
  dueDate: z.string().optional(), // ISO date string
});

export const taskCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "task.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "task:create",
  async resolve(input, ctx, tx) {
    const project = await tx.project.findFirst({ where: { id: input.projectId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!project) throw new NotFoundException(`No project "${input.projectId}"`);

    // Self-assign by default — matches ProjectBoard's create-becomes-owner
    // pattern in projects.mutations.ts.
    const assigneeId = input.assigneeId ?? ctx.userId;
    if (assigneeId !== ctx.userId) {
      await assertAssigneeIsProjectMember(tx, input.projectId, project.ownerId, assigneeId);
    }

    const task = await tx.task.create({
      data: {
        tenantId: ctx.tenantId,
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        assigneeId,
        priority: input.priority ?? "medium",
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      },
    });

    const recipient = notificationRecipientFor(assigneeId, ctx.userId);
    if (recipient) {
      await tx.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId: recipient,
          type: "task.assigned",
          title: "New task assigned to you",
          body: task.title,
          data: { taskId: task.id, projectId: task.projectId },
        },
      });
    }

    return task;
  },
};

const UpdateStatusInputSchema = z.object({
  id: z.string(),
  status: z.string().min(1),
});

export const taskUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "task.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "task:update",
  async resolve(input, ctx, tx) {
    const existing = await requireTaskInScope(tx, ctx, input.id);
    const updated = await tx.task.update({ where: { id: input.id }, data: { status: input.status } });

    const recipient = notificationRecipientFor(existing.assigneeId, ctx.userId);
    if (recipient) {
      await tx.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId: recipient,
          type: "task.status_changed",
          title: "Task status updated",
          body: `"${updated.title}" is now ${updated.status}`,
          data: { taskId: updated.id, projectId: updated.projectId },
        },
      });
    }

    return updated;
  },
};

const ReassignInputSchema = z.object({
  id: z.string(),
  assigneeId: z.string(),
});

// "Team Lead: distribute and reassign tasks within their team" — no
// mutation ever changed `assigneeId` after creation before this;
// `task.updateStatus` only ever touches `status`.
export const taskReassignMutation: MutationDefinition<z.infer<typeof ReassignInputSchema>> = {
  name: "task.reassign",
  inputSchema: ReassignInputSchema,
  requiredPermission: "task:update",
  async resolve(input, ctx, tx) {
    const existing = await requireTaskInScope(tx, ctx, input.id);
    if (input.assigneeId !== ctx.userId) {
      await assertAssigneeIsProjectMember(tx, existing.projectId, existing.project.ownerId, input.assigneeId);
    }

    const updated = await tx.task.update({ where: { id: input.id }, data: { assigneeId: input.assigneeId } });

    const recipient = notificationRecipientFor(input.assigneeId, ctx.userId);
    if (recipient) {
      await tx.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId: recipient,
          type: "task.assigned",
          title: "Task reassigned to you",
          body: updated.title,
          data: { taskId: updated.id, projectId: updated.projectId },
        },
      });
    }

    return updated;
  },
};
