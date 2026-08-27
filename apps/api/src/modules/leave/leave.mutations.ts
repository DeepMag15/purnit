import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Scope } from "@purnit/manifest-schema";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";
import { resolveApprover } from "./resolve-approver";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

/** Only resolved when actually needed — see department-subtree.ts. Same
 * local-helper precedent as every other module's own `resolveSubtreeIds`. */
async function resolveSubtreeIds(tx: PrismaTx, ctx: MutationContext, scope: Scope | null): Promise<string[] | undefined> {
  return scope === "department-subtree" && ctx.userDepartmentId ? getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : undefined;
}

// Simple Mon-Fri business-day count, inclusive of both endpoints — no
// holiday calendar in v1 (a real, disclosed future enhancement; this
// codebase has no holiday-calendar concept anywhere to build on yet).
function countBusinessDays(start: Date, end: Date): number {
  let count = 0;
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= last) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/**
 * Shared dual-path authorization for approve/reject/cancel — one actor can
 * act on a request if EITHER (a) they are literally its `approverId` (the
 * direct-manager fast path, always allowed regardless of granted scope
 * width — `leave:approve:own` means "requests where I'm the assigned
 * approver," not row-ownership, same ARCHITECTURE.md §5.2 precedent as
 * `department:manage:own`), OR (b) their granted scope covers the
 * requester's department (the override-visibility safety valve — Department
 * Head/Executive/Company Admin can act even when they aren't the direct
 * manager). Exact dual-path shape `attendance.correct` already established,
 * adapted with the extra direct-approver fast path Attendance has no
 * equivalent of (Attendance has no "assigned approver" concept at all).
 */
async function assertCanActOnRequest(
  tx: PrismaTx,
  ctx: MutationContext,
  request: { userId: string; approverId: string | null },
): Promise<void> {
  if (request.approverId === ctx.userId) return;

  const scope = ctx.effective.has("leave", "approve");
  if (!scope || scope === "own") throw new ForbiddenException("Not allowed to act on this leave request");

  const requester = await tx.user.findFirst({ where: { id: request.userId, tenantId: ctx.tenantId, deletedAt: null }, select: { departmentId: true } });
  if (!requester) throw new NotFoundException(`No user "${request.userId}"`);

  const departmentSubtreeIds = await resolveSubtreeIds(tx, ctx, scope);
  const inScope = isRowInScope(
    scope,
    { ownerId: null, departmentId: requester.departmentId },
    { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds },
  );
  if (!inScope) throw new ForbiddenException("Not allowed to act on this leave request");
}

const CreateTypeInputSchema = z.object({ name: z.string().min(1).max(80), defaultAnnualDays: z.number().int().positive() });

export const leaveTypeCreateMutation: MutationDefinition<z.infer<typeof CreateTypeInputSchema>> = {
  name: "leaveType.create",
  inputSchema: CreateTypeInputSchema,
  requiredPermission: "leave:manageTypes",
  async resolve(input, ctx, tx) {
    return tx.leaveType.create({ data: { tenantId: ctx.tenantId, name: input.name, defaultAnnualDays: input.defaultAnnualDays } });
  },
};

const SubmitInputSchema = z
  .object({ leaveTypeId: z.string(), startDate: z.coerce.date(), endDate: z.coerce.date(), reason: z.string().max(500).optional() })
  .refine((data) => data.endDate >= data.startDate, { message: "endDate cannot be before startDate", path: ["endDate"] });

/**
 * Self-only creation — `userId` is always `ctx.userId`, never accepted as
 * input, same "no impersonation by input" discipline as `attendance.mark`.
 * Resolves `approverId` once here (resolve-approver.ts), validates against
 * the requester's own balance (lazily provisioned from `LeaveType.
 * defaultAnnualDays` if this is their first request against this type/year
 * — never batch-provisioned, no scheduled job), and notifies the approver
 * inline in this same transaction if one was resolved.
 */
export const leaveSubmitMutation: MutationDefinition<z.infer<typeof SubmitInputSchema>> = {
  name: "leave.submit",
  inputSchema: SubmitInputSchema,
  requiredPermission: "leave:create",
  async resolve(input, ctx, tx) {
    const leaveType = await tx.leaveType.findFirst({ where: { id: input.leaveTypeId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!leaveType) throw new NotFoundException(`No leave type "${input.leaveTypeId}"`);

    const daysRequested = countBusinessDays(input.startDate, input.endDate);
    if (daysRequested <= 0) throw new BadRequestException("Date range contains no business days");

    const year = input.startDate.getUTCFullYear();
    const balance = await tx.leaveBalance.upsert({
      where: { tenantId_userId_leaveTypeId_year: { tenantId: ctx.tenantId, userId: ctx.userId, leaveTypeId: leaveType.id, year } },
      create: { tenantId: ctx.tenantId, userId: ctx.userId, leaveTypeId: leaveType.id, year, allottedDays: leaveType.defaultAnnualDays },
      update: {},
    });
    if (balance.usedDays + daysRequested > balance.allottedDays) {
      throw new BadRequestException(`This request would exceed your remaining ${leaveType.name} balance (${balance.allottedDays - balance.usedDays} day(s) left)`);
    }

    const approverId = await resolveApprover(tx, ctx.tenantId, ctx.userId);

    const request = await tx.leaveRequest.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        leaveTypeId: leaveType.id,
        startDate: input.startDate,
        endDate: input.endDate,
        daysRequested,
        reason: input.reason,
        approverId,
      },
    });

    if (approverId) {
      await tx.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId: approverId,
          type: "leave.submitted",
          title: "New leave request to review",
          body: `${leaveType.name}, ${daysRequested} day(s)`,
          data: { leaveRequestId: request.id },
        },
      });
    }

    await enqueueEmbeddingJob(tx, ctx.tenantId, "leaveRequest", request.id); // AI RAG Phase C
    return request;
  },
};

const DecisionInputSchema = z.object({ id: z.string(), note: z.string().max(500).optional() });

async function decide(tx: PrismaTx, ctx: MutationContext, input: z.infer<typeof DecisionInputSchema>, status: "approved" | "rejected") {
  const request = await tx.leaveRequest.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
  if (!request) throw new NotFoundException(`No leave request "${input.id}"`);
  if (request.status !== "pending") throw new BadRequestException(`This request has already been ${request.status}`);

  await assertCanActOnRequest(tx, ctx, request);

  const updated = await tx.leaveRequest.update({
    where: { id: request.id },
    data: { status, decidedById: ctx.userId, decidedAt: new Date(), decisionNote: input.note },
  });

  if (status === "approved") {
    await tx.leaveBalance.update({
      where: { tenantId_userId_leaveTypeId_year: { tenantId: ctx.tenantId, userId: request.userId, leaveTypeId: request.leaveTypeId, year: request.startDate.getUTCFullYear() } },
      data: { usedDays: { increment: request.daysRequested } },
    });
  }

  await tx.notification.create({
    data: {
      tenantId: ctx.tenantId,
      userId: request.userId,
      type: status === "approved" ? "leave.approved" : "leave.rejected",
      title: status === "approved" ? "Your leave request was approved" : "Your leave request was rejected",
      body: input.note,
      data: { leaveRequestId: request.id },
    },
  });

  await enqueueEmbeddingJob(tx, ctx.tenantId, "leaveRequest", updated.id); // AI RAG Phase C
  return updated;
}

export const leaveApproveMutation: MutationDefinition<z.infer<typeof DecisionInputSchema>> = {
  name: "leave.approve",
  inputSchema: DecisionInputSchema,
  requiredPermission: "leave:approve",
  async resolve(input, ctx, tx) {
    return decide(tx, ctx, input, "approved");
  },
};

export const leaveRejectMutation: MutationDefinition<z.infer<typeof DecisionInputSchema>> = {
  name: "leave.reject",
  inputSchema: DecisionInputSchema,
  requiredPermission: "leave:approve",
  async resolve(input, ctx, tx) {
    return decide(tx, ctx, input, "rejected");
  },
};

const CancelInputSchema = z.object({ id: z.string() });

/** The requester themselves may always cancel their own request (pending or
 * already-approved); an approver may also cancel it on someone's behalf via
 * the same dual-path authorization approve/reject use. Decrements the
 * balance if the request had been approved — a no-op balance-wise if it was
 * still pending. */
export const leaveCancelMutation: MutationDefinition<z.infer<typeof CancelInputSchema>> = {
  name: "leave.cancel",
  inputSchema: CancelInputSchema,
  async resolve(input, ctx, tx) {
    const request = await tx.leaveRequest.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
    if (!request) throw new NotFoundException(`No leave request "${input.id}"`);
    if (request.status === "cancelled") throw new BadRequestException("This request is already cancelled");

    if (request.userId !== ctx.userId) {
      await assertCanActOnRequest(tx, ctx, request);
    }

    const wasApproved = request.status === "approved";
    const updated = await tx.leaveRequest.update({ where: { id: request.id }, data: { status: "cancelled" } });

    if (wasApproved) {
      await tx.leaveBalance.update({
        where: { tenantId_userId_leaveTypeId_year: { tenantId: ctx.tenantId, userId: request.userId, leaveTypeId: request.leaveTypeId, year: request.startDate.getUTCFullYear() } },
        data: { usedDays: { decrement: request.daysRequested } },
      });
    }

    await enqueueEmbeddingJob(tx, ctx.tenantId, "leaveRequest", updated.id); // AI RAG Phase C
    return updated;
  },
};
