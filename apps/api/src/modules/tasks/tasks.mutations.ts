import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Scope } from "@purnit/manifest-schema";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";
import { enqueueReminders } from "../calendar/reminder-outbox";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

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
async function requireTaskInScope(
  tx: PrismaTx,
  ctx: { tenantId: string; userId: string; userDepartmentId: string | null; effective: { has: (r: string, a: string) => Scope | null } },
  taskId: string,
  // Which authority is being exercised. Defaults to "update" so every existing
  // caller is unchanged; `task.review` passes "review", because a reviewer
  // holding task:review but not task:update was otherwise refused with
  // "Not allowed to update this task" — wrong permission, wrong message.
  action: "update" | "review" = "update",
) {
  const existing = await tx.task.findFirst({
    where: { id: taskId, tenantId: ctx.tenantId, deletedAt: null },
    include: { project: { select: { id: true, ownerId: true, departmentId: true } } },
  });
  if (!existing) throw new NotFoundException(`No task "${taskId}"`);

  const scope = ctx.effective.has("task", action);
  // Only resolved when actually needed — the common case (department/team/
  // tenant/own scope) never pays for this query. See department-subtree.ts.
  const departmentSubtreeIds =
    scope === "department-subtree" && ctx.userDepartmentId ? await getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : undefined;
  let inScope =
    scope &&
    isRowInScope(
      scope,
      { ownerId: existing.assigneeId, departmentId: existing.project.departmentId },
      { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds },
    );

  // ⚠️ The membership floor `projectsWhere` has had for a long time, missing
  // here until the Projects ecosystem review surfaced it.
  //
  // At team/department scope `isRowInScope` matches on the task's project
  // departmentId — and `project.create` leaves that null by default. So a Lead
  // holding task:review:team was refused on their own team's work with
  // "Not allowed to review this task", purely because the project had no
  // department. Exactly the bug projectsWhere's own comment describes for a
  // Member who could not see a project they had tasks in.
  //
  // Owning or being a member of the project is its own way to be in scope,
  // independent of department, for update and review alike.
  if (!inScope && scope && scope !== "own") {
    if (existing.project.ownerId === ctx.userId) {
      inScope = true;
    } else {
      const membership = await tx.projectMember.findFirst({ where: { projectId: existing.project.id, userId: ctx.userId } });
      if (membership) inScope = true;
    }
  }

  // ⚠️ And the assignee's OWN department, not just the project's.
  //
  // "Review my team's work" is defined by who the person is, but the check
  // above reads `project.departmentId` — so a Lead and their direct report,
  // both in Ops, were out of scope for each other whenever the task sat on a
  // project with no department (which is what `project.create` produces by
  // default). Verified live: an IT Lead holding task:review:team was refused
  // on their own team member's submitted work.
  //
  // Only consulted when the project-based check has already failed, so this
  // widens nothing for a task whose project does carry a department.
  if (!inScope && scope && scope !== "own" && scope !== "tenant" && existing.assigneeId && ctx.userDepartmentId) {
    const assignee = await tx.user.findFirst({ where: { id: existing.assigneeId, tenantId: ctx.tenantId }, select: { departmentId: true } });
    if (assignee?.departmentId) {
      inScope = isRowInScope(
        scope,
        { ownerId: existing.assigneeId, departmentId: assignee.departmentId },
        { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds },
      );
    }
  }

  if (!inScope) throw new ForbiddenException(`Not allowed to ${action} this task`);

  return existing;
}

const CreateInputSchema = z
  .object({
    projectId: z.string(),
    title: z.string().min(1),
    description: z.string().optional(),
    assigneeId: z.string().optional(),
    priority: z.string().optional(),
    dueDate: z.string().optional(), // ISO date string
    // Calendar & Scheduling (Core Workspace Phase 3) — only settable at
    // create time. Enqueues one CalendarReminder row targeting the assignee.
    // ⚠️ Analytics Phase G added task.updateDueDate (a real post-creation
    // dueDate edit, for GanttChart's click-to-reschedule interaction), but
    // it does NOT retarget/re-enqueue this reminder — a dueDate changed
    // after creation leaves any already-enqueued reminder pointed at the
    // original date, the same disclosed "reminder retargeting on task
    // reassignment" gap already tracked in CHANGELOG's deferred-items list,
    // now also true of a dueDate edit specifically, not just reassignment.
    reminderMinutesBefore: z.number().int().positive().max(10_080).optional(),
  })
  .refine((data) => !data.reminderMinutesBefore || !!data.dueDate, {
    message: "reminderMinutesBefore requires a dueDate",
    path: ["reminderMinutesBefore"],
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

    await enqueueEmbeddingJob(tx, ctx.tenantId, "task", task.id); // AI RAG Phase C

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

    if (task.dueDate) {
      await enqueueReminders(tx, ctx.tenantId, "task", task.id, task.dueDate, input.reminderMinutesBefore, [assigneeId]);
    }

    return task;
  },
};

/**
 * Projects ecosystem review (2026-08-26) — the status vocabulary is now real.
 *
 * `Task.status` was free text with no server-side check: `in_review` was
 * accepted by the API and understood by nothing else (verified live). The UI
 * offered three values while the API took anything at all.
 *
 * `in_review` is deliberately absent from what `task.updateStatus` may SET —
 * a task enters review only through `task.submitForReview`, and leaves it
 * only through `task.review`. Without that, an assignee could mark their own
 * work reviewed, which is the whole thing this is meant to prevent.
 */
export const TASK_STATUSES = ["todo", "in_progress", "in_review", "done"] as const;
const SETTABLE_STATUSES = ["todo", "in_progress", "done"] as const;

const UpdateStatusInputSchema = z.object({
  id: z.string(),
  status: z.enum(SETTABLE_STATUSES),
});

export const taskUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "task.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "task:update",
  async resolve(input, ctx, tx) {
    const existing = await requireTaskInScope(tx, ctx, input.id);

    // Once submitted, only a reviewer decides. Holding task:update is exactly
    // what an assignee has, so without this the review step is bypassable by
    // the one person it exists to check.
    if (existing.status === "in_review") {
      throw new BadRequestException("This task is waiting on a review — a reviewer has to approve it or ask for changes.");
    }

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

const UpdateDueDateInputSchema = z.object({ id: z.string(), dueDate: z.string().nullable() });

// Analytics Phase G (Interactive Kanban & Gantt) — the first post-creation
// dueDate-editing mutation on Task (task.create's own doc comment above
// used to disclaim this as a real gap; the GanttChart widget's click-to-edit
// interaction is what finally needed it). `dueDate: null` explicitly clears
// it — same "row-scope only, no widening" reuse of requireTaskInScope as
// task.updateStatus/task.reassign above.
export const taskUpdateDueDateMutation: MutationDefinition<z.infer<typeof UpdateDueDateInputSchema>> = {
  name: "task.updateDueDate",
  inputSchema: UpdateDueDateInputSchema,
  requiredPermission: "task:update",
  async resolve(input, ctx, tx) {
    await requireTaskInScope(tx, ctx, input.id);
    return tx.task.update({ where: { id: input.id }, data: { dueDate: input.dueDate ? new Date(input.dueDate) : null } });
  },
};

const SubmitForReviewInputSchema = z.object({ id: z.string(), note: z.string().max(2000).optional() });

/**
 * Send finished work to whoever reviews it.
 *
 * ⚠️ No `requiredPermission`, and that is the point: submitting is an act of
 * ownership, not authority. Only the task's own assignee may submit it, which
 * a permission triple cannot express — every scope that would let a Lead
 * submit on someone's behalf would also let them submit their own work as if
 * it had been reviewed.
 *
 * Review is OPTIONAL. Nothing forces a task through here; a routine task still
 * goes straight to `done` via `task.updateStatus`. That is what keeps this
 * usable for an IT chore and meaningful for a student's coursework, using one
 * mechanism.
 */
export const taskSubmitForReviewMutation: MutationDefinition<z.infer<typeof SubmitForReviewInputSchema>> = {
  name: "task.submitForReview",
  inputSchema: SubmitForReviewInputSchema,
  async resolve(input, ctx, tx) {
    const existing = await tx.task.findFirst({ where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null } });
    if (!existing) throw new NotFoundException(`No task "${input.id}"`);
    if (existing.assigneeId !== ctx.userId) {
      throw new ForbiddenException("Only the person this task is assigned to can submit it for review.");
    }
    if (existing.status === "in_review") throw new BadRequestException("This task is already waiting on a review.");
    if (existing.status === "done") throw new BadRequestException("This task is already done.");

    const updated = await tx.task.update({
      where: { id: input.id },
      data: {
        status: "in_review",
        submittedById: ctx.userId,
        submittedAt: new Date(),
        reviewNote: input.note ?? null,
        // A resubmission after changes were requested must not still show the
        // previous decision.
        reviewedById: null,
        reviewedAt: null,
      },
    });
    return updated;
  },
};

const ReviewInputSchema = z.object({
  id: z.string(),
  decision: z.enum(["approve", "request_changes"]),
  note: z.string().max(2000).optional(),
});

/**
 * Decide on submitted work.
 *
 * Gated on `task:review` — deliberately NOT `task:update`, which is what the
 * assignee already holds. And the assignee is refused outright even when they
 * hold the grant: a Lead reviewing their own submission would satisfy every
 * permission check and defeat the purpose.
 *
 * `approve` finishes the task; `request_changes` returns it to `in_progress`
 * so the same person can act on the note and resubmit.
 */
export const taskReviewMutation: MutationDefinition<z.infer<typeof ReviewInputSchema>> = {
  name: "task.review",
  inputSchema: ReviewInputSchema,
  requiredPermission: "task:review",
  async resolve(input, ctx, tx) {
    const existing = await requireTaskInScope(tx, ctx, input.id, "review");
    if (existing.status !== "in_review") {
      throw new BadRequestException("This task hasn't been submitted for review.");
    }
    if (existing.assigneeId === ctx.userId || existing.submittedById === ctx.userId) {
      throw new ForbiddenException("You can't review your own work — someone else has to.");
    }

    const approved = input.decision === "approve";
    const updated = await tx.task.update({
      where: { id: input.id },
      data: {
        status: approved ? "done" : "in_progress",
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
        reviewNote: input.note ?? existing.reviewNote,
      },
    });

    const recipient = notificationRecipientFor(existing.assigneeId, ctx.userId);
    if (recipient) {
      await tx.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId: recipient,
          type: approved ? "task.approved" : "task.changes_requested",
          title: approved ? "Your work was approved" : "Changes requested",
          body: approved ? `"${updated.title}" was approved.` : `"${updated.title}" needs another look${input.note ? `: ${input.note}` : "."}`,
          data: { taskId: updated.id, projectId: updated.projectId },
        },
      });
    }

    return updated;
  },
};
