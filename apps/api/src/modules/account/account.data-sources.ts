import { NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";

const ExportParamsSchema = z.object({});

/**
 * Go-Live, Phase 05 — a person exporting their own data.
 *
 * **No `requiredPermission`**, deliberately, and the reason is the same as
 * `account.deleteSelf`: every query below is filtered to the caller's own
 * `ctx.userId`, so ownership *is* the authorization. Gating it behind a
 * permission would let an admin block someone from exercising a data right.
 *
 * **Scope is deliberately narrow: this is "your own data", not "everything
 * you can see".** A Company Admin can read their whole tenant, and returning
 * all of it here would turn a data-subject export into a one-click tenant
 * dump — a far more dangerous thing to hand out. So every query keys on
 * authorship or assignment, never on a scope check.
 *
 * Runs inside the caller's own transaction like any other data source. The
 * queries are sequential `await`s rather than `Promise.all`, per this
 * codebase's standing rule about a shared interactive-transaction client
 * (CONTEXT.md §9) — the one place that rule is easy to forget is exactly a
 * function like this one, which is nothing but a list of independent reads.
 */
export const accountExportDataSource: DataSourceDefinition<z.infer<typeof ExportParamsSchema>> = {
  name: "account.export",
  paramsSchema: ExportParamsSchema,
  async resolve(_params, ctx, tx) {
    const user = await tx.user.findFirst({ where: { id: ctx.userId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!user) throw new NotFoundException("No account to export");

    const where = { tenantId: ctx.tenantId };

    const tasks = await tx.task.findMany({
      where: { ...where, assigneeId: ctx.userId, deletedAt: null },
      select: { id: true, title: true, description: true, status: true, priority: true, dueDate: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    const comments = await tx.comment.findMany({
      where: { ...where, authorId: ctx.userId, deletedAt: null },
      select: { id: true, body: true, entityType: true, entityId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    const messages = await tx.message.findMany({
      where: { ...where, authorId: ctx.userId, deletedAt: null },
      select: { id: true, body: true, conversationId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    const calendarEvents = await tx.calendarEvent.findMany({
      where: { ...where, authorId: ctx.userId, deletedAt: null },
      select: { id: true, title: true, description: true, startAt: true, endAt: true, isPrivate: true, createdAt: true },
      orderBy: { startAt: "desc" },
    });

    const attendance = await tx.attendanceRecord.findMany({
      where: { ...where, userId: ctx.userId },
      select: { id: true, date: true, status: true, note: true },
      orderBy: { date: "desc" },
    });

    const leaveRequests = await tx.leaveRequest.findMany({
      where: { ...where, userId: ctx.userId },
      select: { id: true, startDate: true, endDate: true, daysRequested: true, status: true, reason: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    const notifications = await tx.notification.findMany({
      where: { ...where, userId: ctx.userId },
      select: { id: true, type: true, title: true, body: true, readAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      // Bounded: notifications accumulate indefinitely and are the least
      // valuable thing in an export. Everything else is unbounded because
      // it is genuinely the person's own authored content.
      take: 500,
    });

    return {
      exportedAt: new Date().toISOString(),
      // Note what this is NOT: no password (we never hold one — Supabase Auth
      // does), no token, no API key, no other person's data.
      profile: {
        displayName: user.displayName,
        email: user.email,
        jobTitle: user.jobTitle,
        employmentStatus: user.employmentStatus,
        startDate: user.startDate,
        createdAt: user.createdAt,
      },
      tasks,
      comments,
      messages,
      calendarEvents,
      attendance,
      leaveRequests,
      notifications,
      counts: {
        tasks: tasks.length,
        comments: comments.length,
        messages: messages.length,
        calendarEvents: calendarEvents.length,
        attendance: attendance.length,
        leaveRequests: leaveRequests.length,
        notifications: notifications.length,
      },
    };
  },
};
