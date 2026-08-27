import type { ScalarMetricDefinition, BreakdownMetricDefinition } from "../../metrics/metric-registry.service";
import { meetingsWhere } from "./meetings.data-sources";

// No requiredPermission — mirrors meetings.list's own precedent exactly:
// visibility is entirely inside meetingsWhere's always-on participant floor,
// since meeting participation is closer to a personal invite than project
// authority (see meetings.data-sources.ts's own doc comment).
export const meetingsHeldThisWeekMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "meetings.heldThisWeek",
  module: "Meetings",
  label: "Meetings Held This Week",
  format: "count",
  async computeLive(ctx, tx, filters) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const where = await meetingsWhere(tx, ctx, {
      cancelledAt: null,
      scheduledStart: { gte: sevenDaysAgo, lte: now },
      ...(filters?.departmentId ? { departmentId: filters.departmentId } : {}),
    });
    return tx.meeting.count({ where });
  },
};

// Phase C (Visual & Widget-Type Depth) — feeds TimelineChart. No
// requiredPermission, same always-on-participant-floor precedent as
// meetingsHeldThisWeekMetric above.
export const meetingsTimelineMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "meetings.timeline",
  module: "Meetings",
  label: "Upcoming Meetings",
  nameKey: "label",
  valueKey: "start",
  async computeLive(ctx, tx, filters) {
    const now = new Date();
    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const where = await meetingsWhere(tx, ctx, {
      cancelledAt: null,
      scheduledStart: { gte: now, lte: in14Days },
      ...(filters?.departmentId ? { departmentId: filters.departmentId } : {}),
    });
    const meetings = await tx.meeting.findMany({ where, orderBy: { scheduledStart: "asc" }, take: 50 });
    return meetings.map((m) => ({ label: m.title, start: m.scheduledStart, end: m.scheduledEnd }));
  },
};
